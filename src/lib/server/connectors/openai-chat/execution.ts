import {
	buildPresentationRestoreFromInstruction,
	selectMatchingPresentationTargetIds
} from '$lib/contracts/footer-chat-restore';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import { readVehicleSemanticOverlay } from '$lib/server/connectors/vehicle-semantic-overlay';
import type { VehicleSemanticGroupAnnotation } from '$lib/server/connectors/vehicle-semantic-overlay/types';
import { buildVehicleSemanticOverlayRuntimeIndex } from '$lib/semantic-overlay/runtime';
import {
	planNormalizedVehiclePaintIntent,
	resolveVehicleIntent
} from '$lib/server/connectors/vehicle-intents';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import { OpenAIChatInputError } from './errors';
import {
	EDIT_VEHICLE_PRESENTATION_TOOL_NAME,
	EDIT_VEHICLE_SELECTION_TOOL_NAME,
	EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
	SET_ASSISTANT_UI_TOOL_NAME,
	type ExecutedToolResult,
	type ExpandVehicleSelectionToolArgs,
	type NormalizedFooterChatRequest,
	type SemanticOverlayPromptContext,
	type SemanticOverlayState,
	type SetVehicleViewModeToolArgs
} from './internal';
import {
	parseEditVehiclePresentationToolArgs,
	parseEditVehicleSelectionToolArgs,
	parseSetAssistantUiToolArgs,
	parseExpandVehicleSelectionToolArgs,
	parseGetVehicleToolCatalogToolArgs,
	parseSetIntentSidebarToolArgs,
	parseSetSupplementaryReferenceListToolArgs,
	parseSetVehicleViewModeToolArgs
} from './tool-args';
import { executeSemanticToolCall } from './semantic-execution';
import { buildVehicleToolCatalog } from './tool-definitions';
import {
	isSelectionExpansionRequest,
	isSemanticAnnotationRequest,
	isSemanticGroupDeletionRequest,
	isSemanticGroupPatchRequest,
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
import {
	getSelectionConstraintNodeIds,
	type VehicleNodeSelection
} from '$lib/stores/vehicle-node-selection';
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
	const overlay = await readVehicleSemanticOverlay(activeAssetId);
	const partById = new Map((overlay?.acceptedParts ?? []).map((part) => [part.id, part]));
	const selectedNodeIds = new Set(
		scopedSelections.flatMap((selection) => getSelectionConstraintNodeIds(selection))
	);
	const selectedMaterialIds = new Set<string>();

	for (const selection of scopedSelections) {
		if (selection.targetType === 'part' && selection.targetId) {
			const part = partById.get(selection.targetId);
			part?.materialIds.forEach((materialId) => selectedMaterialIds.add(materialId));
		}

		const node = getSelectionConstraintNodeIds(selection)
			.map((nodeId) => nodeById.get(nodeId))
			.find((candidate): candidate is NonNullable<typeof candidate> => !!candidate?.meshId);
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
	const isExplicitViewerModeRequest =
		/\b(wireframe|xray|x-ray|uv|uvs|uv debug|uv_debug|postprocess|post-processing|postprocessing|original)\b/i.test(
			input.message
		);

	if (!input.assetId || (!isExplicitViewerModeRequest && !shouldAttemptDirectVehicleEdit(input))) {
		return null;
	}

	const result = await resolveVehicleIntent(input.assetId, input.message, {
		presentation: input.presentation,
		...(input.selectedGroupId ? { selectedGroupId: input.selectedGroupId } : {}),
		selectedNodes: input.selectedNodes
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
	{ match: /\bfront\s+face\b|\bfront\s+end\b|\bnose\b|\bgrille\b/i, semanticGroup: 'front_face' },
	{ match: /\bglasshouse\b|\bwindows?\b|\bglass\b/i, semanticGroup: 'glasshouse' },
	{ match: /\bheadlights?\b/i, semanticGroup: 'headlights' },
	{ match: /\bfront\s+lights?\b|\bfront\s+lighting\b/i, semanticGroup: 'front_lighting' },
	{ match: /\btaillights?\b|\brear\s+lights?\b|\brear\s+lighting\b|\bbacklights?\b|\bbrake\s+lights?\b/i, semanticGroup: 'rear_lighting' },
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

function resolveDirectSemanticGroupDeletion(message: string): {
	semanticGroup?: string;
	category?: VehicleSemanticGroupAnnotation['category'];
	humanLabel?: string;
} | null {
	return isSemanticGroupDeletionRequest(message) ? resolveDirectSemanticGroup(message) : null;
}

function parseDirectSemanticGroupPatch(message: string): {
	semanticGroup?: string;
	category?: VehicleSemanticGroupAnnotation['category'];
	humanLabel?: string;
} | null {
	const normalizedMessage = message.trim();
	const renameMatch =
		normalizedMessage.match(
			/\b(?:rename|relabel|retitle|change\s+(?:the\s+)?(?:name|label)\s+of|update\s+(?:the\s+)?(?:name|label)\s+of)\b\s+(.*?)\s*(?:->|→|⇒|\bto\b|\bas\b|\binto\b)\s*(.+?)\s*$/i
		) ??
		normalizedMessage.match(
			/\b(?:rename|relabel|retitle|change\s+(?:the\s+)?(?:name|label)\s+of|update\s+(?:the\s+)?(?:name|label)\s+of)\b\s+(.*?)\s*(?:into)\s*(.+?)\s*$/i
		);
	if (!renameMatch) {
		return null;
	}

	const sourceReference = renameMatch[1]?.trim().replace(/^(?:the\s+)?(?:semantic\s+group|group)\s+/i, '');
	const targetLabel = renameMatch[2]?.trim().replace(/[.?!]+$/g, '');
	if (!sourceReference || !targetLabel) {
		return null;
	}

	const groupReference = resolveDirectSemanticGroup(sourceReference);
	if (!groupReference) {
		return null;
	}

	return {
		semanticGroup: groupReference.semanticGroup,
		category: groupReference.category,
		humanLabel: targetLabel
	};
}

export async function attemptDirectSemanticGroupPatch(
	input: NormalizedFooterChatRequest,
	model: string,
	executeTool: (
		toolCall: { id: string; function: { name: string; arguments: string } },
		activeAssetId?: VehicleAssetId,
		selectedNodes?: VehicleNodeSelection[],
		presentation?: FooterChatPresentationContext,
		selectedGroupId?: string
	) => Promise<ExecutedToolResult>
) {
	if (!isSemanticGroupPatchRequest(input.message)) {
		return null;
	}

	const patchReference = parseDirectSemanticGroupPatch(input.message);
	if (!patchReference) {
		return null;
	}

	const toolResult = await executeTool(
		{
			id: 'direct-semantic-group-patch',
			function: {
				name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
				arguments: JSON.stringify({
					action: 'patch_group',
					...(patchReference?.semanticGroup ? { semanticGroup: patchReference.semanticGroup } : {}),
					...(patchReference?.category ? { category: patchReference.category } : {}),
					...(patchReference?.humanLabel ? { humanLabel: patchReference.humanLabel } : {})
				})
			}
		},
		input.assetId,
		input.selectedNodes,
		input.presentation,
		input.selectedGroupId
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

	const sourceLabel = humanizeSemanticGroupLabel(
		patchReference?.semanticGroup ?? patchReference?.humanLabel
	);
	const targetLabel = patchReference?.humanLabel?.trim() || sourceLabel;

	return {
		model,
		message: {
			role: 'assistant' as const,
			content: `Renamed the ${sourceLabel} semantic group to ${targetLabel}.`
		},
		semanticOverlay: toolResult.semanticOverlay,
		semanticOverlayStatus: toolResult.semanticOverlay ? 'fresh' as const : 'unknown',
		trace: toolResult.trace,
		selectedGroupId:
			toolResult.selectedGroupId !== undefined
				? toolResult.selectedGroupId
				: input.selectedGroupId ?? null
	};
}

export async function attemptDirectSemanticGroupDelete(
	input: NormalizedFooterChatRequest,
	model: string,
	executeTool: (
		toolCall: { id: string; function: { name: string; arguments: string } },
		activeAssetId?: VehicleAssetId,
		selectedNodes?: VehicleNodeSelection[],
		presentation?: FooterChatPresentationContext,
		selectedGroupId?: string
	) => Promise<ExecutedToolResult>
) {
	if (!input.assetId || !isSemanticGroupDeletionRequest(input.message)) {
		return null;
	}

	const groupReference = resolveDirectSemanticGroupDeletion(input.message);
	const selectedGroupId = input.selectedGroupId?.trim();
	if (!groupReference && !selectedGroupId) {
		return null;
	}

	const toolResult = await executeTool(
		{
			id: 'direct-semantic-group-delete',
			function: {
				name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
				arguments: JSON.stringify({
					action: 'delete_group',
					...(groupReference?.semanticGroup ? { semanticGroup: groupReference.semanticGroup } : {}),
					...(groupReference?.category ? { category: groupReference.category } : {}),
					...(groupReference?.humanLabel ? { humanLabel: groupReference.humanLabel } : {}),
					...(groupReference ? {} : { groupId: selectedGroupId })
				})
			}
		},
		input.assetId,
		input.selectedNodes,
		input.presentation,
		input.selectedGroupId
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

	const groupLabel = humanizeSemanticGroupLabel(
		groupReference?.humanLabel ?? groupReference?.semanticGroup ?? selectedGroupId
	);

	return {
		model,
		message: {
			role: 'assistant' as const,
			content: `Removed the ${groupLabel} semantic group.`
		},
		semanticOverlay: toolResult.semanticOverlay,
		semanticOverlayStatus: 'fresh' as const,
		trace: toolResult.trace,
		selectedGroupId:
			toolResult.selectedGroupId !== undefined ? toolResult.selectedGroupId : input.selectedGroupId ?? null
	};
}

export async function attemptDirectSemanticEdit(
	input: NormalizedFooterChatRequest,
	model: string,
	executeTool: (
		toolCall: { id: string; function: { name: string; arguments: string } },
		activeAssetId?: VehicleAssetId,
		selectedNodes?: VehicleNodeSelection[],
		presentation?: FooterChatPresentationContext,
		selectedGroupId?: string
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
	const selectedGroupId = input.selectedGroupId?.trim();
	if (!groupReference && !selectedGroupId) {
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
						semanticGroup: groupReference?.semanticGroup ?? selectedGroupId,
						category: groupReference?.category,
						humanLabel: groupReference?.humanLabel
					})
				}
			},
		input.assetId,
		input.selectedNodes,
		input.presentation,
		input.selectedGroupId
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

	const resolvedGroupLabel = humanizeSemanticGroupLabel(
		groupReference?.humanLabel ?? groupReference?.semanticGroup ?? selectedGroupId
	);

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
								? `Added the highlighted material-backed member to ${resolvedGroupLabel}.`
								: intentDraft.targetScope === 'node'
									? `Added the highlighted node-backed member to ${resolvedGroupLabel}.`
									: `Added the highlighted target to ${resolvedGroupLabel}.`
						: intentDraft.operation === 'reassign'
							? hasScopedSelection
								? scopedSelectionCount === 1
									? `Reassigned the selected node to ${resolvedGroupLabel}.`
									: `Reassigned the selected nodes to ${resolvedGroupLabel}.`
								: intentDraft.targetScope === 'material'
									? `Reassigned the highlighted material-backed member to ${resolvedGroupLabel}.`
									: intentDraft.targetScope === 'node'
										? `Reassigned the highlighted node-backed member to ${resolvedGroupLabel}.`
										: `Reassigned the highlighted target to ${resolvedGroupLabel}.`
							: hasScopedSelection
								? scopedSelectionCount === 1
									? `Removed the selected node from ${resolvedGroupLabel}.`
									: `Removed the selected nodes from ${resolvedGroupLabel}.`
								: intentDraft.targetScope === 'material'
									? `Removed the highlighted material-backed member from ${resolvedGroupLabel}.`
									: intentDraft.targetScope === 'node'
										? `Removed the highlighted node-backed member from ${resolvedGroupLabel}.`
						: `Removed the highlighted target from ${resolvedGroupLabel}.`
			},
		presentationRestore: toolResult.presentationRestore,
		semanticOverlay: toolResult.semanticOverlay,
		semanticOverlayStatus: 'fresh' as const,
		trace: toolResult.trace,
		selectedGroupId:
			toolResult.selectedGroupId !== undefined ? toolResult.selectedGroupId : selectedGroupId ?? null
	};
}

function buildViewModeRequest(args: SetVehicleViewModeToolArgs): string {
	const modeLabel =
		args.mode === 'uv_debug' ? 'uv debug' : args.mode === 'postprocess' ? 'postprocess' : args.mode;
	return `${args.enabled ? 'enable' : 'disable'} ${modeLabel}`;
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
	const toNodeSelection = (nodeId: string): VehicleNodeSelection | null => {
		const node = nodeById.get(nodeId);
		if (!node) {
			return null;
		}

		return {
			assetId: activeAssetId,
			targetType: 'node',
			targetId: nodeId,
			targetName: node.name.trim() || nodeId,
			nodeIds: [nodeId],
			nodeId,
			nodeName: node.name.trim() || nodeId,
			nodePath: node.path
		};
	};

	if (args.target === 'node') {
		const expandedNodeSelections = Array.from(
			new Map(
				scopedSelections
					.flatMap((selection) => getSelectionConstraintNodeIds(selection))
					.map((nodeId) => toNodeSelection(nodeId))
					.filter((selection): selection is VehicleNodeSelection => selection !== null)
					.map((selection) => [selection.targetId ?? selection.nodeId, selection] as [string, VehicleNodeSelection])
			).values()
		);

		return {
			selectedNodes: expandedNodeSelections,
			label: 'Expanded selection to whole node.'
		};
	}

	const overlay = await readVehicleSemanticOverlay(activeAssetId);
	if (!overlay) {
		throw new OpenAIChatInputError('No semantic overlay is available to expand this selection.');
	}

	const selectedNodeIds = new Set(
		scopedSelections.flatMap((selection) => getSelectionConstraintNodeIds(selection))
	);
	const selectedMaterialIds = new Set<string>();
	for (const selection of scopedSelections) {
		if (selection.targetType === 'part' && selection.targetId) {
			const selectedPart = overlay.acceptedParts.find((part) => part.id === selection.targetId);
			selectedPart?.materialIds.forEach((materialId) => selectedMaterialIds.add(materialId));
		}

		const node = getSelectionConstraintNodeIds(selection)
			.map((nodeId) => nodeById.get(nodeId))
			.find((candidate): candidate is NonNullable<typeof candidate> => !!candidate?.meshId);
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
	if (args.target === 'part') {
		const bestPart = overlay.acceptedParts
			.filter((part) => {
				const matchesSelection =
					part.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)) ||
					part.materialIds.some((materialId) => selectedMaterialIds.has(materialId));
				if (!matchesSelection) {
					return false;
				}

				if (!query) {
					return true;
				}

				return `${part.id} ${part.humanLabel} ${part.aliases.join(' ')}`.toLowerCase().includes(query);
			})
			.sort((left, right) => {
				const leftCoverage = left.nodeIds.length * 10 + left.materialIds.length;
				const rightCoverage = right.nodeIds.length * 10 + right.materialIds.length;
				if (leftCoverage !== rightCoverage) {
					return rightCoverage - leftCoverage;
				}
				return right.confidence - left.confidence;
			})[0];

		if (!bestPart) {
			throw new OpenAIChatInputError('No semantic part matched the current selection.');
		}

		const anchorNodeId = bestPart.anchorNodeId ?? bestPart.nodeIds[0] ?? bestPart.id;
		const anchorNode = nodeById.get(anchorNodeId);
		return {
			selectedNodes: [
				{
					assetId: activeAssetId,
					targetType: 'part',
					targetId: bestPart.id,
					targetName: bestPart.humanLabel,
					nodeIds: [...bestPart.nodeIds],
					anchorNodeId: bestPart.anchorNodeId,
					nodeId: anchorNodeId,
					nodeName: anchorNode?.name.trim() || bestPart.humanLabel,
					nodePath: anchorNode?.path ?? scopedSelections[0]!.nodePath
				}
			],
			label: `Expanded selection to part ${bestPart.humanLabel}.`
		};
	}

	const bestGroup = overlay.acceptedGroups
		.filter((group) => {
			const matchesSelection =
				group.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)) ||
				group.materialIds.some((materialId) => selectedMaterialIds.has(materialId));
			if (!matchesSelection) {
				return false;
			}

			if (!query) {
				return true;
			}

			return `${group.id} ${group.humanLabel} ${group.aliases.join(' ')}`.toLowerCase().includes(query);
		})
		.sort((left, right) => {
			const leftCoverage = left.nodeIds.length * 10 + left.materialIds.length;
			const rightCoverage = right.nodeIds.length * 10 + right.materialIds.length;
			if (leftCoverage !== rightCoverage) {
				return rightCoverage - leftCoverage;
			}
			return right.confidence - left.confidence;
		})[0];

	if (!bestGroup) {
		throw new OpenAIChatInputError('No semantic group matched the current selection.');
	}

	const runtimeIndex = buildVehicleSemanticOverlayRuntimeIndex(overlay);
	const expandedSelections = Array.from(
		new Map(
			Array.from(
				new Set([
					...bestGroup.nodeIds,
					...(runtimeIndex.partsByGroupId.get(bestGroup.id) ?? []).flatMap((part) => part.nodeIds),
					...(runtimeIndex.uncoveredNodeIdsByGroupId.get(bestGroup.id) ?? [])
				])
			)
				.map((nodeId) => toNodeSelection(nodeId))
				.filter((selection): selection is VehicleNodeSelection => selection !== null)
				.map((selection) => [selection.targetId ?? selection.nodeId, selection] as [string, VehicleNodeSelection])
		).values()
	);

	if (expandedSelections.length === 0) {
		throw new OpenAIChatInputError('Expanded semantic selection did not resolve any runtime nodes.');
	}

	return {
		selectedNodes: expandedSelections,
		label: `Expanded selection to semantic group ${bestGroup.humanLabel}.`
	};
}

export async function executeToolCall(
	toolCall: { id: string; function: { name: string; arguments: string } },
	activeAssetId?: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[] = [],
	presentation?: FooterChatPresentationContext,
	selectedGroupId?: string
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
				if (args.action === 'appearance') {
					if (!activeAssetId) {
						throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
					}
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
					const result = await resolveVehicleIntent(
						activeAssetId,
						args.request,
						selectedGroupId
							? { presentation, selectedGroupId, selectedNodes }
							: { presentation, selectedNodes }
					);
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
				if (args.action === 'focus') {
					if (!activeAssetId) {
						throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
					}
					const result = await resolveVehicleIntent(
						activeAssetId,
						args.request,
						selectedGroupId
							? { presentation, selectedGroupId, selectedNodes }
							: { presentation, selectedNodes }
					);
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
				if (args.action === 'restore') {
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
				}

				if (!activeAssetId) {
					throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
				}
				const result = await resolveVehicleIntent(
					activeAssetId,
					buildViewModeRequest(args),
					selectedGroupId
						? { presentation, selectedGroupId, selectedNodes }
						: { presentation, selectedNodes }
				);
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

		if (toolCall.function.name === EDIT_VEHICLE_SELECTION_TOOL_NAME) {
			try {
				const args = parseEditVehicleSelectionToolArgs(toolCall.function.arguments);
				if (!activeAssetId) {
					throw new OpenAIChatInputError('No active vehicle asset is available for selection expansion.');
				}
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

		const semanticResult = await executeSemanticToolCall(
			toolCall,
			activeAssetId,
			selectedNodes,
			presentation,
			selectedGroupId
		);
		if (semanticResult) {
			return semanticResult;
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

export function resolveSemanticSidebarCadence(
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
