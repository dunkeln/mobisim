import {
	buildPresentationRestoreFromInstruction,
	selectMatchingPresentationTargetIds
} from '$lib/contracts/footer-chat-restore';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	getVehicleSemanticOverlayStatus,
	readVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';
import type { VehicleSemanticGroupAnnotation } from '$lib/server/connectors/vehicle-semantic-overlay/types';
import {
	planNormalizedVehiclePaintIntent,
	resolveVehicleIntent
} from '$lib/server/connectors/vehicle-intents';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import { OpenAIChatInputError } from './errors';
import {
	APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME,
	APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME,
	EDIT_VEHICLE_PRESENTATION_TOOL_NAME,
	EDIT_VEHICLE_SELECTION_TOOL_NAME,
	EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
	RESTORE_VEHICLE_PRESENTATION_TOOL_NAME,
	SET_ASSISTANT_UI_TOOL_NAME,
	type ApplyVehicleAppearanceIntentToolArgs,
	type ApplyVehicleFocusIntentToolArgs,
	type EditVehiclePresentationToolArgs,
	type EditVehicleSelectionToolArgs,
	type ExecutedToolResult,
	type ExpandVehicleSelectionToolArgs,
	type NormalizedFooterChatRequest,
	type RestoreVehiclePresentationToolArgs,
	type SemanticOverlayPromptContext,
	type SemanticOverlayState,
	type SetVehicleViewModeToolArgs,
	EXPAND_VEHICLE_SELECTION_TOOL_NAME,
	SET_INTENT_SIDEBAR_TOOL_NAME,
	SET_SUPPLEMENTARY_REFERENCE_LIST_TOOL_NAME,
	SET_VEHICLE_VIEW_MODE_TOOL_NAME
} from './internal';
import {
	parseApplyVehicleAppearanceIntentToolArgs,
	parseApplyVehicleFocusIntentToolArgs,
	parseEditVehiclePresentationToolArgs,
	parseEditVehicleSelectionToolArgs,
	parseSetAssistantUiToolArgs,
	parseExpandVehicleSelectionToolArgs,
	parseGetVehicleToolCatalogToolArgs,
	parseRestoreVehiclePresentationToolArgs,
	parseSetIntentSidebarToolArgs,
	parseSetSupplementaryReferenceListToolArgs,
	parseSetVehicleViewModeToolArgs
} from './tool-args';
import { executeSemanticToolCall } from './semantic-execution';
import { buildVehicleToolCatalog } from './tool-definitions';
import {
	isSelectionExpansionRequest,
	isSemanticAnnotationRequest,
	isSemanticRefreshRequest,
	requestNeedsSemanticGrounding,
	shouldAttemptDirectSelectionEdit,
	shouldAttemptDirectVehicleEdit
} from './routing';
import { resolveIntentDraft } from './intent-resolver';
import type {
	FooterChatPresentationContext,
	FooterChatPresentationTarget,
	FooterChatSidebarState,
	FooterChatSupplementaryListState,
	FooterChatTrace,
	FooterChatVehiclePatchOperation
} from './types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import { recordSpanError, withActiveSpan } from '$lib/server/telemetry';

export function mergePatchOperations(
	current: FooterChatVehiclePatchOperation[],
	incoming: FooterChatVehiclePatchOperation[]
): FooterChatVehiclePatchOperation[] {
	const merged = new Map(
		current.map((operation) => [`${operation.targetType}:${operation.targetId}:${operation.op}`, operation])
	);

	for (const operation of incoming) {
		merged.set(`${operation.targetType}:${operation.targetId}:${operation.op}`, operation);
	}

	return Array.from(merged.values());
}

async function restrictOperationsToSelection(
	activeAssetId: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[],
	operations: FooterChatVehiclePatchOperation[]
): Promise<FooterChatVehiclePatchOperation[]> {
	const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
	if (scopedSelections.length === 0) {
		return [];
	}

	const structure = await deriveStructuralAssetSnapshot(activeAssetId);
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));
	const selectedNodeIds = new Set(scopedSelections.map((selection) => selection.nodeId));
	const selectedMaterialIds = new Set<string>();

	for (const selection of scopedSelections) {
		const node = nodeById.get(selection.nodeId);
		if (!node?.meshId) {
			continue;
		}

		const mesh = meshById.get(node.meshId);
		if (!mesh) {
			continue;
		}

		if (
			typeof selection.materialIndex === 'number' &&
			selection.materialIndex >= 0 &&
			selection.materialIndex < mesh.materialIds.length
		) {
			selectedMaterialIds.add(mesh.materialIds[selection.materialIndex]!);
			continue;
		}

		if (selection.materialName) {
			mesh.materialIds.forEach((materialId, index) => {
				if (mesh.materialNames[index] === selection.materialName) {
					selectedMaterialIds.add(materialId);
				}
			});
			continue;
		}

		mesh.materialIds.forEach((materialId) => selectedMaterialIds.add(materialId));
	}

	return operations.filter((operation) => {
		if (operation.targetType === 'node') {
			return selectedNodeIds.has(operation.targetId);
		}
		if (operation.targetType === 'material') {
			return selectedMaterialIds.has(operation.targetId);
		}
		return false;
	});
}

export async function attemptDirectVehicleEdit(
	input: NormalizedFooterChatRequest,
	model: string
) {
	if (!input.assetId || !shouldAttemptDirectVehicleEdit(input)) {
		return null;
	}

	const result = await resolveVehicleIntent(input.assetId, input.message, {
		presentation: input.presentation
	});
	const shouldScopeToSelection = shouldAttemptDirectSelectionEdit(input);
	const plannedOperations = shouldScopeToSelection
		? await restrictOperationsToSelection(input.assetId, input.selectedNodes, result.operations)
		: result.operations;

	if (plannedOperations.length === 0) {
		return null;
	}

	const summary = shouldScopeToSelection ? `${result.summary} Scoped to selection.` : result.summary;

	return {
		model,
		message: {
			role: 'assistant' as const,
			content: summary
		},
		vehiclePatchAssetId: input.assetId,
		vehiclePatchLabel: summary,
		vehiclePatchOperations: plannedOperations
	};
}

const DIRECT_SEMANTIC_GROUP_PATTERNS: Array<{
	match: RegExp;
	semanticGroup?: string;
	category?: VehicleSemanticGroupAnnotation['category'];
	humanLabel?: string;
}> = [
	{ match: /\bbody(?:\s+shell)?\b/i, semanticGroup: 'body_shell' },
	{ match: /\bfront(?:\s+face)?\b/i, semanticGroup: 'front_face' },
	{ match: /\bglasshouse\b|\bwindows?\b|\bglass\b/i, semanticGroup: 'glasshouse' },
	{ match: /\bheadlights?\b/i, semanticGroup: 'headlights' },
	{ match: /\bfront\s+lighting\b/i, semanticGroup: 'front_lighting' },
	{ match: /\btaillights?\b|\brear\s+lighting\b/i, semanticGroup: 'rear_lighting' },
	{ match: /\bwheels?\b/i, semanticGroup: 'wheels', category: 'wheels', humanLabel: 'wheels' },
	{ match: /\bdoors?\b/i, semanticGroup: 'doors', category: 'doors', humanLabel: 'doors' },
	{ match: /\btrim\b/i, semanticGroup: 'trim' },
	{ match: /\binterior\b/i, semanticGroup: 'interior' }
];

function resolveDirectSemanticGroup(message: string): {
	semanticGroup?: string;
	category?: VehicleSemanticGroupAnnotation['category'];
	humanLabel?: string;
} | null {
	for (const candidate of DIRECT_SEMANTIC_GROUP_PATTERNS) {
		if (candidate.match.test(message)) {
			return {
				semanticGroup: candidate.semanticGroup,
				category: candidate.category,
				humanLabel: candidate.humanLabel
			};
		}
	}

	return null;
}

function humanizeSemanticGroupLabel(input: string | undefined): string {
	if (!input) {
		return 'the requested semantic group';
	}

	return input.replaceAll('_', ' ');
}

export async function attemptDirectSemanticEdit(
	input: NormalizedFooterChatRequest,
	model: string,
	executeTool: (
		toolCall: { id: string; function: { name: string; arguments: string } },
		activeAssetId?: VehicleAssetId,
		selectedNodes?: VehicleNodeSelection[],
		presentation?: FooterChatPresentationContext
	) => Promise<ExecutedToolResult>
) {
	if (!input.assetId) {
		return null;
	}

	const intentDraft = resolveIntentDraft(input);
	if (!['assign', 'reassign', 'unassign'].includes(intentDraft.operation)) {
		return null;
	}

	if (intentDraft.domain !== 'semantics') {
		return null;
	}

	const hasScopedSelection = input.selectedNodes.some((entry) => entry.assetId === input.assetId);
	const hasHighlight = (input.presentation?.highlightedTargets?.length ?? 0) > 0;
	const scopedSelectionCount = input.selectedNodes.filter((entry) => entry.assetId === input.assetId).length;
	if (!hasScopedSelection && !hasHighlight) {
		return null;
	}

	const groupReference = resolveDirectSemanticGroup(input.message);
	if (!groupReference) {
		return null;
	}

	const toolResult = await executeTool(
		{
			id: 'direct-semantic-edit',
			function: {
				name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
				arguments: JSON.stringify({
					action: intentDraft.operation,
					scope: hasScopedSelection ? 'selected' : 'highlighted',
					targetScope:
						intentDraft.targetScope === 'node' ||
						intentDraft.targetScope === 'material' ||
						intentDraft.targetScope === 'mixed'
							? intentDraft.targetScope
							: undefined,
					semanticGroup: groupReference.semanticGroup,
					category: groupReference.category,
					humanLabel: groupReference.humanLabel
				})
			}
		},
		input.assetId,
		input.selectedNodes,
		input.presentation
	);

	const errorMessage =
		typeof toolResult.message.content === 'string'
			? (() => {
					try {
						const payload = JSON.parse(toolResult.message.content) as { error?: string };
						return payload.error;
					} catch {
						return undefined;
					}
				})()
			: undefined;
	if (errorMessage) {
		return null;
	}

	return {
		model,
		message: {
			role: 'assistant' as const,
			content:
				intentDraft.operation === 'assign'
					? hasScopedSelection
						? scopedSelectionCount === 1
							? 'Updated the semantic grouping for the selected node.'
							: 'Updated the semantic grouping for the selected nodes.'
						: intentDraft.targetScope === 'material'
							? `Added the highlighted material-backed member to ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
							: intentDraft.targetScope === 'node'
								? `Added the highlighted node-backed member to ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
								: `Added the highlighted target to ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
					: intentDraft.operation === 'reassign'
						? hasScopedSelection
							? scopedSelectionCount === 1
								? `Reassigned the selected node to ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
								: `Reassigned the selected nodes to ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
							: intentDraft.targetScope === 'material'
								? `Reassigned the highlighted material-backed member to ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
								: intentDraft.targetScope === 'node'
									? `Reassigned the highlighted node-backed member to ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
									: `Reassigned the highlighted target to ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
						: hasScopedSelection
							? scopedSelectionCount === 1
								? `Removed the selected node from ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
								: `Removed the selected nodes from ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
							: intentDraft.targetScope === 'material'
								? `Removed the highlighted material-backed member from ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
								: intentDraft.targetScope === 'node'
									? `Removed the highlighted node-backed member from ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
									: `Removed the highlighted target from ${humanizeSemanticGroupLabel(groupReference.humanLabel ?? groupReference.semanticGroup)}.`
		},
		semanticOverlay: toolResult.semanticOverlay,
		semanticOverlayStatus: 'fresh' as const
	};
}

function buildViewModeRequest(args: SetVehicleViewModeToolArgs): string {
	const modeLabel =
		args.mode === 'uv_debug' ? 'uv debug' : args.mode === 'postprocess' ? 'postprocess' : args.mode;
	return `${args.enabled ? 'enable' : 'disable'} ${modeLabel}`;
}

function toLegacyPresentationToolCall(
	toolCall: { id: string; function: { name: string; arguments: string } },
	args: EditVehiclePresentationToolArgs
) {
	if (args.action === 'appearance') {
		return {
			id: toolCall.id,
			function: {
				name: APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME,
				arguments: JSON.stringify({
					request: args.request,
					colorFamily: args.colorFamily,
					shade: args.shade,
					saturation: args.saturation,
					finish: args.finish,
					hex: args.hex,
					scope: args.scope
				})
			}
		};
	}

	if (args.action === 'focus') {
		return {
			id: toolCall.id,
			function: {
				name: APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME,
				arguments: JSON.stringify({
					request: args.request,
					scope: args.scope
				})
			}
		};
	}

	if (args.action === 'restore') {
		return {
			id: toolCall.id,
			function: {
				name: RESTORE_VEHICLE_PRESENTATION_TOOL_NAME,
				arguments: JSON.stringify({
					kind: args.kind,
					scope: args.scope,
					query: args.query
				})
			}
		};
	}

	return {
		id: toolCall.id,
		function: {
			name: SET_VEHICLE_VIEW_MODE_TOOL_NAME,
			arguments: JSON.stringify({
				mode: args.mode,
				enabled: args.enabled
			})
		}
	};
}

function toLegacySelectionToolCall(
	toolCall: { id: string; function: { name: string; arguments: string } },
	args: EditVehicleSelectionToolArgs
) {
	return {
		id: toolCall.id,
		function: {
			name: EXPAND_VEHICLE_SELECTION_TOOL_NAME,
			arguments: JSON.stringify({
				target: args.target,
				query: args.query
			})
		}
	};
}

async function expandVehicleSelection(
	activeAssetId: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[],
	args: ExpandVehicleSelectionToolArgs
): Promise<{ selectedNodes: VehicleNodeSelection[]; label: string }> {
	const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
	if (scopedSelections.length === 0) {
		throw new OpenAIChatInputError('No selected runtime nodes are available to expand.');
	}

	const structure = await deriveStructuralAssetSnapshot(activeAssetId);
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));

	if (args.target === 'node') {
		return {
			selectedNodes: scopedSelections.map((selection) => ({
				assetId: activeAssetId,
				nodeId: selection.nodeId,
				nodeName: selection.nodeName,
				nodePath: selection.nodePath
			})),
			label: 'Expanded selection to whole node.'
		};
	}

	const overlay = await readVehicleSemanticOverlay(activeAssetId);
	if (!overlay) {
		throw new OpenAIChatInputError('No semantic overlay is available to expand this selection.');
	}

	const selectedNodeIds = new Set(scopedSelections.map((selection) => selection.nodeId));
	const selectedMaterialIds = new Set<string>();
	for (const selection of scopedSelections) {
		const node = nodeById.get(selection.nodeId);
		if (!node?.meshId) {
			continue;
		}
		const mesh = meshById.get(node.meshId);
		if (!mesh) {
			continue;
		}
		if (
			typeof selection.materialIndex === 'number' &&
			selection.materialIndex >= 0 &&
			selection.materialIndex < mesh.materialIds.length
		) {
			selectedMaterialIds.add(mesh.materialIds[selection.materialIndex]!);
			continue;
		}
		if (selection.materialName) {
			mesh.materialIds.forEach((materialId, index) => {
				if (mesh.materialNames[index] === selection.materialName) {
					selectedMaterialIds.add(materialId);
				}
			});
		}
	}

	const query = args.query?.toLowerCase();
	const candidateEntities =
		args.target === 'part'
			? overlay.acceptedParts.filter((part) => {
					const matchesSelection =
						part.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)) ||
						part.materialIds.some((materialId) => selectedMaterialIds.has(materialId));
					if (!matchesSelection) return false;
					if (!query) return true;
					return `${part.id} ${part.humanLabel} ${part.aliases.join(' ')}`
						.toLowerCase()
						.includes(query);
			  })
			: overlay.acceptedGroups.filter((group) => {
					const matchesSelection =
						group.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)) ||
						group.materialIds.some((materialId) => selectedMaterialIds.has(materialId));
					if (!matchesSelection) return false;
					if (!query) return true;
					return `${group.id} ${group.humanLabel} ${group.aliases.join(' ')}`
						.toLowerCase()
						.includes(query);
			  });

	const bestEntity = candidateEntities.sort((left, right) => {
		const leftCoverage = left.nodeIds.length * 10 + left.materialIds.length;
		const rightCoverage = right.nodeIds.length * 10 + right.materialIds.length;
		if (leftCoverage !== rightCoverage) {
			return rightCoverage - leftCoverage;
		}
		return right.confidence - left.confidence;
	})[0];

	if (!bestEntity) {
		throw new OpenAIChatInputError(
			args.target === 'part'
				? 'No semantic part matched the current selection.'
				: 'No semantic group matched the current selection.'
		);
	}

	const expandedNodeIds = Array.from(
		new Set([
			...bestEntity.nodeIds,
			...bestEntity.materialIds.flatMap(
				(materialId) => structure.materials.find((material) => material.id === materialId)?.nodeIds ?? []
			)
		])
	);

	const expandedSelections = expandedNodeIds
		.map((nodeId) => {
			const node = nodeById.get(nodeId);
			if (!node) {
				return null;
			}
			return {
				assetId: activeAssetId,
				nodeId,
				nodeName: node.name.trim() || nodeId,
				nodePath: node.path
			};
		})
		.filter((entry): entry is VehicleNodeSelection => entry !== null);

	if (expandedSelections.length === 0) {
		throw new OpenAIChatInputError('Expanded semantic selection did not resolve any runtime nodes.');
	}

	return {
		selectedNodes: expandedSelections,
		label:
			args.target === 'part'
				? `Expanded selection to part ${bestEntity.humanLabel}.`
				: `Expanded selection to semantic group ${bestEntity.humanLabel}.`
	};
}

export async function executeToolCall(
	toolCall: { id: string; function: { name: string; arguments: string } },
	activeAssetId?: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[] = [],
	presentation?: FooterChatPresentationContext
): Promise<ExecutedToolResult> {
	return withActiveSpan(
		'mobisim.chat',
		`tool.${toolCall.function.name}`,
		{
			attributes: {
				'mobisim.chat.tool_name': toolCall.function.name,
				'mobisim.chat.asset_id': activeAssetId ?? 'none',
				'mobisim.chat.selected_node_count': selectedNodes.filter(
					(selection) => selection.assetId === activeAssetId
				).length,
				'mobisim.chat.has_presentation_context': presentation !== undefined
			}
		},
		async () => {
	if (toolCall.function.name === GET_VEHICLE_TOOL_CATALOG_TOOL_NAME) {
		try {
			const args = parseGetVehicleToolCatalogToolArgs(toolCall.function.arguments);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify(
						buildVehicleToolCatalog(args, activeAssetId, selectedNodes, presentation)
					)
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === EDIT_VEHICLE_PRESENTATION_TOOL_NAME) {
		try {
			const args = parseEditVehiclePresentationToolArgs(toolCall.function.arguments);
			return executeToolCall(
				toLegacyPresentationToolCall(toolCall, args),
				activeAssetId,
				selectedNodes,
				presentation
			);
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === EDIT_VEHICLE_SELECTION_TOOL_NAME) {
		try {
			const args = parseEditVehicleSelectionToolArgs(toolCall.function.arguments);
			return executeToolCall(
				toLegacySelectionToolCall(toolCall, args),
				activeAssetId,
				selectedNodes,
				presentation
			);
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === SET_ASSISTANT_UI_TOOL_NAME) {
		try {
			const args = parseSetAssistantUiToolArgs(toolCall.function.arguments);
			if (args.action === 'sidebar') {
				return {
					message: {
						role: 'tool',
						tool_call_id: toolCall.id,
						content: JSON.stringify({ active: args.active, cardCount: args.cards.length })
					},
					sidebar: {
						active: args.active,
						cards: args.cards
					}
				};
			}

			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ active: args.active, entryCount: Object.keys(args.entries).length })
				},
				supplementaryList: {
					active: args.active,
					entries: args.entries
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME) {
		try {
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}
			const args = parseApplyVehicleAppearanceIntentToolArgs(toolCall.function.arguments);
			if (args.colorFamily && !args.request) {
				const result = await planNormalizedVehiclePaintIntent(activeAssetId, {
					colorFamily: args.colorFamily,
					shade: args.shade,
					saturation: args.saturation,
					finish: args.finish,
					hex: args.hex
				});
				const plannedOperations =
					args.scope === 'selection'
						? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
						: result.operations;
				return {
					message: {
						role: 'tool',
						tool_call_id: toolCall.id,
						content: JSON.stringify({ ...result, operations: plannedOperations, scope: args.scope })
					},
					plannedOperations,
					intentLabel:
						args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
				};
			}
			if (!args.request) {
				throw new OpenAIChatInputError(
					'A freeform appearance request or normalized paint fields are required.'
				);
			}
			const result = await resolveVehicleIntent(activeAssetId, args.request, {
				presentation
			});
			const plannedOperations =
				args.scope === 'selection'
					? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
					: result.operations;
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ ...result, operations: plannedOperations, scope: args.scope })
				},
				plannedOperations,
				intentLabel:
					args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME) {
		try {
			const args = parseApplyVehicleFocusIntentToolArgs(toolCall.function.arguments);
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}
			const result = await resolveVehicleIntent(activeAssetId, args.request, {
				presentation
			});
			const plannedOperations =
				args.scope === 'selection'
					? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
					: result.operations;
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ ...result, operations: plannedOperations, scope: args.scope })
				},
				plannedOperations,
				intentLabel:
					args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === RESTORE_VEHICLE_PRESENTATION_TOOL_NAME) {
		try {
			const args = parseRestoreVehiclePresentationToolArgs(toolCall.function.arguments);
			const restore = buildPresentationRestoreFromInstruction(args, presentation);
			if (!restore) {
				throw new OpenAIChatInputError(
					'No matching active presentation state was available to restore.'
				);
			}

			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						kind: args.kind,
						scope: args.scope,
						query: args.query,
						restore
					})
				},
				presentationRestore: restore
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === SET_VEHICLE_VIEW_MODE_TOOL_NAME) {
		try {
			const args = parseSetVehicleViewModeToolArgs(toolCall.function.arguments);
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}
			const result = await resolveVehicleIntent(activeAssetId, buildViewModeRequest(args), {
				presentation
			});
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ ...result, mode: args.mode, enabled: args.enabled })
				},
				plannedOperations: result.operations,
				intentLabel: result.summary
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === EXPAND_VEHICLE_SELECTION_TOOL_NAME) {
		try {
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for selection expansion.');
			}
			const args = parseExpandVehicleSelectionToolArgs(toolCall.function.arguments);
			const expansion = await expandVehicleSelection(activeAssetId, selectedNodes, args);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						target: args.target,
						query: args.query,
						selectedNodeCount: expansion.selectedNodes.length,
						label: expansion.label
					})
				},
				selectionUpdate: expansion.selectedNodes,
				selectionUpdateLabel: expansion.label
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	const semanticResult = await executeSemanticToolCall(
		toolCall,
		activeAssetId,
		selectedNodes,
		presentation
	);
	if (semanticResult) {
		return semanticResult;
	}

	if (toolCall.function.name === SET_INTENT_SIDEBAR_TOOL_NAME) {
		try {
			const args = parseSetIntentSidebarToolArgs(toolCall.function.arguments);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ active: args.active, cardCount: args.cards.length })
				},
				sidebar: {
					active: args.active,
					cards: args.cards
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === SET_SUPPLEMENTARY_REFERENCE_LIST_TOOL_NAME) {
		try {
			const args = parseSetSupplementaryReferenceListToolArgs(toolCall.function.arguments);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ active: args.active, entryCount: Object.keys(args.entries).length })
				},
				supplementaryList: {
					active: args.active,
					entries: args.entries
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	return {
		message: {
			role: 'tool',
			tool_call_id: toolCall.id,
			content: JSON.stringify({ error: `Unsupported tool: ${toolCall.function.name}` })
		}
	};
		}
	);
}

function resolveSemanticSidebarCadence(
	input: NormalizedFooterChatRequest,
	status: SemanticOverlayState,
	overlay?: SemanticOverlayPromptContext['overlay']
): SemanticOverlayPromptContext['sidebarCadence'] {
	const semanticsMatter =
		isSemanticRefreshRequest(input.message) ||
		requestNeedsSemanticGrounding(input.message) ||
		isSelectionExpansionRequest(input.message) ||
		isSemanticAnnotationRequest(input.message);

	if (!semanticsMatter) {
		return 'stable';
	}
	if (status === 'missing' || status === 'stale') {
		return 'caution';
	}
	if (status === 'fresh' && overlay) {
		return 'summary';
	}
	return 'stable';
}

export async function resolveSemanticOverlayPromptContext(
	input: NormalizedFooterChatRequest
): Promise<SemanticOverlayPromptContext> {
	if (!input.assetId) {
		return { status: 'unknown', sidebarCadence: 'stable' };
	}

	const capabilities = await deriveVehicleInspectionCapabilities(input.assetId);
	const status = await getVehicleSemanticOverlayStatus(input.assetId, capabilities.generatedAt);
	const overlay =
		status === 'fresh' || status === 'stale' ? await readVehicleSemanticOverlay(input.assetId) : undefined;

	return {
		status,
		overlay: overlay ?? undefined,
		sidebarCadence: resolveSemanticSidebarCadence(input, status, overlay ?? undefined)
	};
}

export function resolveSidebarAction(
	previousSidebar: FooterChatSidebarState | undefined,
	nextSidebar: FooterChatSidebarState | undefined
): FooterChatTrace['sidebarAction'] {
	const previousActive = previousSidebar?.active === true && (previousSidebar.cards.length ?? 0) > 0;
	const nextActive = nextSidebar?.active === true && (nextSidebar.cards.length ?? 0) > 0;

	if (previousActive && !nextActive) {
		return 'cleared';
	}
	if (JSON.stringify(previousSidebar ?? null) !== JSON.stringify(nextSidebar ?? null)) {
		return 'updated';
	}
	return 'unchanged';
}

export function resolveSupplementaryListAction(
	previousList: FooterChatSupplementaryListState | undefined,
	nextList: FooterChatSupplementaryListState | undefined
): FooterChatTrace['supplementaryListAction'] {
	const previousActive =
		previousList?.active === true && Object.keys(previousList.entries ?? {}).length > 0;
	const nextActive = nextList?.active === true && Object.keys(nextList.entries ?? {}).length > 0;

	if (previousActive && !nextActive) {
		return 'cleared';
	}
	if (JSON.stringify(previousList ?? null) !== JSON.stringify(nextList ?? null)) {
		return 'updated';
	}
	return 'unchanged';
}
