import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	assignSemanticIngress,
	listSemanticIngressBindings
} from '$lib/server/connectors/semantic-ingress';
import {
	createSemanticGroupDefinition,
	deleteSemanticGroupDefinition,
	findSemanticGroupDefinition,
	patchSemanticGroupDefinition
} from '$lib/server/connectors/semantic-groups';
import { removeReviewedAssetSemanticAssignments } from '$lib/server/connectors/asset-semantic-assignments';
import {
	generateVehicleSemanticOverlay,
	mutateVehicleSemanticAssignment,
	readVehicleSemanticOverlay,
	writeVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';
import type {
	VehicleSemanticGroup,
	VehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import { selectMatchingPresentationTargetIds } from '$lib/contracts/footer-chat-restore';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import { OpenAIChatInputError } from './errors';
import {
	ASSIGN_SEMANTIC_INGRESS_TOOL_NAME,
	EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
	MANAGE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME,
	MUTATE_VEHICLE_SEMANTIC_ASSIGNMENT_TOOL_NAME,
	REFRESH_VEHICLE_SEMANTICS_TOOL_NAME,
	type EditVehicleSemanticsToolArgs,
	type ExecutedToolResult,
	type ManageVehicleSemanticGroupToolArgs,
	type MutateVehicleSemanticAssignmentToolArgs
} from './internal';
import {
	parseAssignSemanticIngressToolArgs,
	parseEditVehicleSemanticsToolArgs,
	parseManageVehicleSemanticGroupToolArgs,
	parseMutateVehicleSemanticAssignmentToolArgs,
	parseRefreshVehicleSemanticsToolArgs
} from './tool-args';
import type {
	FooterChatPresentationContext,
	FooterChatPresentationTarget
} from './types';
import { recordSpanError } from '$lib/server/telemetry';

type ToolCall = { id: string; function: { name: string; arguments: string } };

type ScopedMaterialSelection = {
	nodeId: string;
	materialIndex?: number;
	materialName?: string;
};

type TypedSemanticResolution = {
	nodeIds: string[];
	materialIds: string[];
	materialSelections?: ScopedMaterialSelection[];
	scope: 'node' | 'material' | 'mixed';
};

type SemanticAssignmentCommand = {
	action: 'assign' | 'reassign' | 'unassign';
	nodeIds: string[];
	materialIds: string[];
	semanticGroup?: string;
	category?: MutateVehicleSemanticAssignmentToolArgs['category'];
	humanLabel?: string;
	aliases?: string[];
	materialSelections?: ScopedMaterialSelection[];
};

type InferredSemanticScope = 'selected' | 'highlighted' | 'material_targets' | 'hidden';

function normalizeSemanticLookupToken(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function semanticGroupMatchesReference(
	group: VehicleSemanticGroup,
	reference: string
): boolean {
	const normalizedReference = normalizeSemanticLookupToken(reference);
	if (!normalizedReference) {
		return false;
	}

	return [group.id, group.humanLabel, group.category, ...group.aliases]
		.map((value) => normalizeSemanticLookupToken(value))
		.some(
			(value) =>
				value === normalizedReference ||
				value.includes(normalizedReference) ||
				normalizedReference.includes(value)
		);
}

function nodeMatchesReference(
	node: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>['nodes'][number],
	reference: string
): boolean {
	const normalizedReference = normalizeSemanticLookupToken(reference);
	if (!normalizedReference) {
		return false;
	}

	return [node.id, node.name, node.path]
		.map((value) => normalizeSemanticLookupToken(value))
		.some(
			(value) =>
				value === normalizedReference ||
				value.includes(normalizedReference) ||
				normalizedReference.includes(value)
		);
}

function dedupeSorted(values: string[]): string[] {
	return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function isMaterialSpecificSelection(selection: VehicleNodeSelection): boolean {
	return typeof selection.materialIndex === 'number' || !!selection.materialName;
}

function toSelectionMaterialRef(selection: VehicleNodeSelection): ScopedMaterialSelection {
	return {
		nodeId: selection.nodeId,
		materialIndex: selection.materialIndex,
		materialName: selection.materialName
	};
}

function selectPresentationTargetsByType(
	targets: FooterChatPresentationTarget[] | undefined,
	targetType: 'node' | 'material',
	query?: string
): string[] {
	const candidateTargets =
		targets?.filter((target) =>
			target.targetType ? target.targetType === targetType : targetType === 'material'
		) ?? [];
	return query
		? selectMatchingPresentationTargetIds(query, candidateTargets)
		: candidateTargets.map((target) => target.targetId);
}

async function deriveSelectedMaterialIds(
	activeAssetId: VehicleAssetId,
	selections: VehicleNodeSelection[]
): Promise<string[]> {
	if (selections.length === 0) {
		return [];
	}

	const structure = await deriveStructuralAssetSnapshot(activeAssetId);
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));
	const selectedMaterialIds = new Set<string>();

	for (const selection of selections) {
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

	return Array.from(selectedMaterialIds).sort((left, right) => left.localeCompare(right));
}

function resolveScopedSemanticTargets(input: {
	activeAssetId: VehicleAssetId;
	scope?: ManageVehicleSemanticGroupToolArgs['scope'];
	selectedNodes: VehicleNodeSelection[];
	presentation?: FooterChatPresentationContext;
	query?: string;
}): {
	nodeIds: string[];
	materialIds: string[];
	materialSelections?: ScopedMaterialSelection[];
} {
	const scopedSelections = input.selectedNodes.filter(
		(selection) => selection.assetId === input.activeAssetId
	);
	const effectiveScope: InferredSemanticScope =
		input.scope ??
		(scopedSelections.length > 0
			? 'selected'
			: (input.presentation?.highlightedTargets?.length ?? 0) > 0
				? 'highlighted'
				: 'selected');

	if (effectiveScope === 'highlighted') {
		const materialIds = input.query
			? selectMatchingPresentationTargetIds(input.query, input.presentation?.highlightedTargets)
			: (input.presentation?.highlightedTargets ?? []).map((target) => target.targetId);
		return { nodeIds: [], materialIds };
	}

	if (effectiveScope === 'hidden') {
		const nodeIds = input.query
			? selectMatchingPresentationTargetIds(input.query, input.presentation?.hiddenTargets)
			: (input.presentation?.hiddenTargets ?? []).map((target) => target.targetId);
		return { nodeIds, materialIds: [] };
	}

	const filteredSelections =
		input.query && input.query.trim().length > 0
			? scopedSelections.filter((selection) =>
					normalizeSemanticLookupToken(
						`${selection.nodeName} ${selection.nodePath} ${selection.materialName ?? ''} ${selection.nodeId}`
					).includes(normalizeSemanticLookupToken(input.query ?? ''))
				)
			: scopedSelections;

	return {
		nodeIds: Array.from(new Set(filteredSelections.map((selection) => selection.nodeId))).sort((left, right) =>
			left.localeCompare(right)
		),
		materialIds: [],
		materialSelections: filteredSelections.map((selection) => ({
			nodeId: selection.nodeId,
			materialIndex: selection.materialIndex,
			materialName: selection.materialName
		}))
	};
}

async function resolveTypedSemanticMutationTargets(input: {
	activeAssetId: VehicleAssetId;
	args: MutateVehicleSemanticAssignmentToolArgs;
	selectedNodes: VehicleNodeSelection[];
	presentation?: FooterChatPresentationContext;
}): Promise<TypedSemanticResolution> {
	const scopedSelections = input.selectedNodes.filter(
		(selection) => selection.assetId === input.activeAssetId
	);
	const explicitNodeIds = dedupeSorted(input.args.nodeIds ?? []);
	const explicitMaterialIds = dedupeSorted(input.args.materialIds ?? []);
	const explicitTargetScope = input.args.targetScope;
	const effectiveScope: InferredSemanticScope =
		input.args.scope ??
		(scopedSelections.length > 0
			? 'selected'
			: (input.presentation?.highlightedTargets?.length ?? 0) > 0
				? 'highlighted'
				: 'selected');

	if (explicitNodeIds.length > 0 && explicitMaterialIds.length === 0) {
		return {
			nodeIds: explicitNodeIds,
			materialIds: [],
			materialSelections:
				scopedSelections.length > 0
					? scopedSelections
							.filter((selection) => explicitNodeIds.includes(selection.nodeId))
							.map(toSelectionMaterialRef)
					: undefined,
			scope: explicitTargetScope === 'material' ? 'material' : 'node'
		};
	}

	if (explicitMaterialIds.length > 0 && explicitNodeIds.length === 0) {
		return {
			nodeIds: [],
			materialIds: explicitMaterialIds,
			scope: explicitTargetScope === 'node' ? 'node' : 'material'
		};
	}

	if (explicitNodeIds.length > 0 || explicitMaterialIds.length > 0) {
		return {
			nodeIds: explicitTargetScope === 'material' ? [] : explicitNodeIds,
			materialIds: explicitTargetScope === 'node' ? [] : explicitMaterialIds,
			materialSelections:
				explicitTargetScope !== 'material' && scopedSelections.length > 0
					? scopedSelections
							.filter((selection) => explicitNodeIds.includes(selection.nodeId))
							.map(toSelectionMaterialRef)
					: undefined,
			scope: explicitTargetScope ?? 'mixed'
		};
	}

	if (effectiveScope === 'hidden') {
		const nodeIds = input.args.query
			? selectMatchingPresentationTargetIds(input.args.query, input.presentation?.hiddenTargets)
			: (input.presentation?.hiddenTargets ?? []).map((target) => target.targetId);
		return {
			nodeIds: dedupeSorted(nodeIds),
			materialIds: [],
			scope: 'node'
		};
	}

	if (effectiveScope === 'material_targets') {
		const materialIds = input.args.query
			? selectMatchingPresentationTargetIds(input.args.query, input.presentation?.materialTargets)
			: (input.presentation?.materialTargets ?? []).map((target) => target.targetId);
		return {
			nodeIds: [],
			materialIds: dedupeSorted(materialIds),
			scope: 'material'
		};
	}

	if (effectiveScope === 'highlighted') {
		const highlightedNodeIds = dedupeSorted(
			selectPresentationTargetsByType(input.presentation?.highlightedTargets, 'node', input.args.query)
		);
		const highlightedMaterialIds = dedupeSorted(
			selectPresentationTargetsByType(input.presentation?.highlightedTargets, 'material', input.args.query)
		);

		if (explicitTargetScope === 'node') {
			return { nodeIds: highlightedNodeIds, materialIds: [], scope: 'node' };
		}

		if (explicitTargetScope === 'material') {
			return { nodeIds: [], materialIds: highlightedMaterialIds, scope: 'material' };
		}

		if (explicitTargetScope === 'mixed') {
			return {
				nodeIds: highlightedNodeIds,
				materialIds: highlightedMaterialIds,
				scope: 'mixed'
			};
		}

		if (highlightedNodeIds.length > 0 && highlightedMaterialIds.length > 0) {
			throw new OpenAIChatInputError(
				'The current highlight could mean either the node-backed member or the material-backed member. Ask whether the user wants the node, the material region, or the whole mixed group.'
			);
		}

		if (highlightedNodeIds.length > 0) {
			return { nodeIds: highlightedNodeIds, materialIds: [], scope: 'node' };
		}

		return { nodeIds: [], materialIds: highlightedMaterialIds, scope: 'material' };
	}

	const filteredSelections =
		input.args.query && input.args.query.trim().length > 0
			? scopedSelections.filter((selection) =>
					normalizeSemanticLookupToken(
						`${selection.nodeName} ${selection.nodePath} ${selection.materialName ?? ''} ${selection.nodeId}`
					).includes(normalizeSemanticLookupToken(input.args.query ?? ''))
				)
			: scopedSelections;
	const hasMaterialSpecificSelection = filteredSelections.some(isMaterialSpecificSelection);
	const selectedNodeIds = dedupeSorted(filteredSelections.map((selection) => selection.nodeId));

	if (explicitTargetScope === 'node') {
		return {
			nodeIds: selectedNodeIds,
			materialIds: [],
			materialSelections: filteredSelections.map(toSelectionMaterialRef),
			scope: 'node'
		};
	}

	const selectedMaterialIds =
		explicitTargetScope === 'material' || explicitTargetScope === 'mixed' || hasMaterialSpecificSelection
			? dedupeSorted(await deriveSelectedMaterialIds(input.activeAssetId, filteredSelections))
			: [];

	if (explicitTargetScope === 'material') {
		return {
			nodeIds: [],
			materialIds: selectedMaterialIds,
			scope: 'material'
		};
	}

	if (explicitTargetScope === 'mixed') {
		return {
			nodeIds: selectedNodeIds,
			materialIds: selectedMaterialIds,
			materialSelections: filteredSelections.map(toSelectionMaterialRef),
			scope: 'mixed'
		};
	}

	if (hasMaterialSpecificSelection && selectedNodeIds.length > 0 && selectedMaterialIds.length > 0) {
		throw new OpenAIChatInputError(
			'The current selection could mean either the node-backed member or the material-backed member. Ask whether the user wants the node, the material region, or the whole mixed group.'
		);
	}

	return {
		nodeIds: selectedNodeIds,
		materialIds: [],
		materialSelections: filteredSelections.map(toSelectionMaterialRef),
		scope: 'node'
	};
}

async function persistMaterializedSemanticOverlay(
	activeAssetId: VehicleAssetId
): Promise<VehicleSemanticOverlay | null> {
	const overlay = await readVehicleSemanticOverlay(activeAssetId);
	if (!overlay) {
		return null;
	}

	return writeVehicleSemanticOverlay({
		...overlay,
		generatedAt: new Date().toISOString()
	});
}

async function applySemanticAssignmentCommand(
	activeAssetId: VehicleAssetId,
	command: SemanticAssignmentCommand
): Promise<VehicleSemanticOverlay> {
	return mutateVehicleSemanticAssignment(activeAssetId, {
		action: command.action,
		nodeIds: command.nodeIds,
		materialIds: command.materialIds,
		semanticGroup: command.semanticGroup,
		category: command.category,
		humanLabel: command.humanLabel,
		aliases: command.aliases,
		materialSelections: command.materialSelections
	});
}

async function executeSemanticAssignmentMutation(
	toolCall: ToolCall,
	activeAssetId: VehicleAssetId | undefined,
	selectedNodes: VehicleNodeSelection[],
	presentation?: FooterChatPresentationContext
): Promise<ExecutedToolResult> {
	const args = parseMutateVehicleSemanticAssignmentToolArgs(toolCall.function.arguments);
	if (!activeAssetId) {
		throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
	}

	const effectiveScope: InferredSemanticScope =
		args.scope ??
		(selectedNodes.some((selection) => selection.assetId === activeAssetId)
			? 'selected'
			: (presentation?.highlightedTargets?.length ?? 0) > 0
				? 'highlighted'
				: 'selected');

	const resolvedTargets = await resolveTypedSemanticMutationTargets({
		activeAssetId,
		args,
		selectedNodes,
		presentation
	});

	if (resolvedTargets.nodeIds.length === 0 && resolvedTargets.materialIds.length === 0) {
		throw new OpenAIChatInputError(
			'No selected, highlighted, hidden, or described runtime targets were available for semantic mutation.'
		);
	}

	const overlay = await applySemanticAssignmentCommand(activeAssetId, {
		action: args.action,
		nodeIds: resolvedTargets.nodeIds,
		materialIds: resolvedTargets.materialIds,
		semanticGroup: args.semanticGroup,
		category: args.category,
		humanLabel: args.humanLabel,
		aliases: args.aliases,
		materialSelections: resolvedTargets.materialSelections
	});

	return {
		message: {
			role: 'tool',
			tool_call_id: toolCall.id,
			content: JSON.stringify({
				action: args.action,
				targetScope: resolvedTargets.scope,
				nodeIds: resolvedTargets.nodeIds,
				materialIds: resolvedTargets.materialIds,
				query: args.query,
				semanticGroup: args.semanticGroup,
				category: args.category,
				acceptedGroupCount: overlay.acceptedGroups.length
			})
		},
			semanticOverlay: overlay,
			presentationRestore:
				args.action === 'unassign' &&
				effectiveScope === 'highlighted' &&
				resolvedTargets.materialIds.length > 0
					? {
							highlightedTargetIds: resolvedTargets.materialIds,
							label: 'restore original view'
						}
					: undefined
		};
}

async function executeSemanticGroupManagement(
	toolCall: ToolCall,
	activeAssetId: VehicleAssetId | undefined,
	selectedNodes: VehicleNodeSelection[],
	presentation?: FooterChatPresentationContext
): Promise<ExecutedToolResult> {
	const args = parseManageVehicleSemanticGroupToolArgs(toolCall.function.arguments);

	if (args.action === 'create') {
		if (!args.groupId && !args.query && !args.humanLabel && !args.category) {
			throw new OpenAIChatInputError('A semantic group reference or label is required to create a semantic group.');
		}

		const existingDefinition =
			(await findSemanticGroupDefinition({
				id: args.groupId,
				semanticGroup: args.query,
				category: args.category
			})) ?? null;
		const definition =
			existingDefinition ??
			(await createSemanticGroupDefinition({
				id: args.groupId,
				humanLabel:
					args.humanLabel ?? args.query ?? args.groupId ?? args.category?.replaceAll('_', ' ') ?? '',
				aliases: args.aliases,
				category: args.category ?? 'other',
				supports: args.supports,
				assignmentMode: args.assignmentMode,
				exclusiveFamily:
					typeof args.exclusiveFamily === 'string' ? args.exclusiveFamily : undefined
			}));

		if (!activeAssetId) {
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						action: args.action,
						groupId: definition.id,
						humanLabel: definition.humanLabel,
						assignedTargetCount: 0
					})
				}
			};
		}

			const scopedTargets = resolveScopedSemanticTargets({
				activeAssetId,
				scope: args.scope,
				selectedNodes,
				presentation,
				query: args.query
			});

		if (scopedTargets.nodeIds.length === 0 && scopedTargets.materialIds.length === 0) {
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						action: args.action,
						groupId: definition.id,
						humanLabel: definition.humanLabel,
						assignedTargetCount: 0
					})
				}
			};
		}

		const overlay = await applySemanticAssignmentCommand(activeAssetId, {
			action: 'assign',
			nodeIds: scopedTargets.nodeIds,
			materialIds: scopedTargets.materialIds,
			semanticGroup: definition.id,
			materialSelections: scopedTargets.materialSelections
		});

		return {
			message: {
				role: 'tool',
				tool_call_id: toolCall.id,
				content: JSON.stringify({
					action: args.action,
					groupId: definition.id,
					humanLabel: definition.humanLabel,
					assignedTargetCount: scopedTargets.nodeIds.length + scopedTargets.materialIds.length,
					acceptedGroupCount: overlay.acceptedGroups.length
				})
			},
			semanticOverlay: overlay
		};
	}

	if (args.action === 'patch') {
		const definition = await patchSemanticGroupDefinition({
			id: args.groupId,
			semanticGroup: args.query,
			category: args.category,
			humanLabel: args.humanLabel,
			aliases: args.aliases,
			supports: args.supports,
			assignmentMode: args.assignmentMode,
			exclusiveFamily: args.exclusiveFamily
		});
		const overlay = activeAssetId ? await persistMaterializedSemanticOverlay(activeAssetId) : null;
		return {
			message: {
				role: 'tool',
				tool_call_id: toolCall.id,
				content: JSON.stringify({
					action: args.action,
					groupId: definition.id,
					humanLabel: definition.humanLabel,
					category: definition.category,
					acceptedGroupCount: overlay?.acceptedGroups.length
				})
			},
			semanticOverlay: overlay
		};
	}

	if (args.action === 'delete') {
		if (!activeAssetId) {
			const definition = await deleteSemanticGroupDefinition({
				id: args.groupId,
				semanticGroup: args.query,
				category: args.category
			});
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						action: args.action,
						deletedDefinitionId: definition.id
					})
				}
			};
		}

		const overlay = await readVehicleSemanticOverlay(activeAssetId);
		if (!overlay) {
			throw new OpenAIChatInputError('No semantic overlay is available for semantic group deletion.');
		}

		const matchedGroups = overlay.acceptedGroups.filter((group) => {
			if (args.groupId) {
				return group.id === args.groupId;
			}

			if (args.category) {
				return group.category === args.category;
			}

			return args.query ? semanticGroupMatchesReference(group, args.query) : false;
		});

		if (matchedGroups.length === 0) {
			throw new OpenAIChatInputError('No semantic group matched the current delete request.');
		}

		for (const group of matchedGroups) {
			await removeReviewedAssetSemanticAssignments({
				assetId: activeAssetId,
				structuralGeneratedAt: overlay.structuralGeneratedAt,
				nodeIds: group.nodeIds,
				materialIds: group.materialIds,
				semanticGroupId: group.id
			});
		}

		const nextOverlay = await persistMaterializedSemanticOverlay(activeAssetId);

		return {
			message: {
				role: 'tool',
				tool_call_id: toolCall.id,
				content: JSON.stringify({
					action: args.action,
					deletedGroupIds: matchedGroups.map((group) => group.id)
				})
			},
			semanticOverlay: nextOverlay
		};
	}

	if (!activeAssetId) {
		throw new OpenAIChatInputError('No active vehicle asset is available for semantic get.');
	}

	const structure = await deriveStructuralAssetSnapshot(activeAssetId);
	if (args.targetType === 'semantic_node') {
		const targetNode =
			(args.nodeId ? structure.nodes.find((node) => node.id === args.nodeId) : undefined) ??
			(args.query ? structure.nodes.find((node) => nodeMatchesReference(node, args.query!)) : undefined);
		if (!targetNode) {
			throw new OpenAIChatInputError('No semantic node matched the current request.');
		}

		const mesh = targetNode.meshId
			? structure.meshes.find((entry) => entry.id === targetNode.meshId)
			: undefined;
		return {
			message: {
				role: 'tool',
				tool_call_id: toolCall.id,
				content: JSON.stringify({
					action: args.action,
					targetType: args.targetType,
					nodeId: targetNode.id,
					nodeName: targetNode.name,
					materialCount: mesh?.materialIds.length ?? 0
				})
			}
		};
	}

	const overlay = await readVehicleSemanticOverlay(activeAssetId);
	if (!overlay) {
		throw new OpenAIChatInputError('No semantic overlay is available for semantic group lookup.');
	}
	const group =
		(args.groupId ? overlay.acceptedGroups.find((entry) => entry.id === args.groupId) : undefined) ??
		(args.category ? overlay.acceptedGroups.find((entry) => entry.category === args.category) : undefined) ??
		(args.query
			? overlay.acceptedGroups.find((entry) => semanticGroupMatchesReference(entry, args.query!))
			: undefined);

	if (!group) {
		throw new OpenAIChatInputError('No semantic group matched the current request.');
	}

	const groupMaterialIds = Array.from(
		new Set(
			group.materialIds.length > 0
				? group.materialIds
				: group.nodeIds.flatMap((nodeId) => {
						const node = structure.nodes.find((entry) => entry.id === nodeId);
						const mesh = node?.meshId
							? structure.meshes.find((entry) => entry.id === node.meshId)
							: undefined;
						return mesh?.materialIds ?? [];
					})
		)
	);

	return {
		message: {
			role: 'tool',
			tool_call_id: toolCall.id,
			content: JSON.stringify({
				action: args.action,
				targetType: args.targetType,
				groupId: group.id,
				humanLabel: group.humanLabel,
				materialCount: groupMaterialIds.length,
				nodeCount: group.nodeIds.length
			})
		}
	};
}

async function executeSemanticRefresh(
	toolCall: ToolCall,
	activeAssetId: VehicleAssetId | undefined
): Promise<ExecutedToolResult> {
	const args = parseRefreshVehicleSemanticsToolArgs(toolCall.function.arguments);
	if (!activeAssetId) {
		throw new OpenAIChatInputError('No active vehicle asset is available for semantic refresh.');
	}
	const overlay = await generateVehicleSemanticOverlay(activeAssetId, {
		force: args.force === true
	});
	return {
		message: {
			role: 'tool',
			tool_call_id: toolCall.id,
			content: JSON.stringify({
				assetId: overlay.assetId,
				generatedAt: overlay.generatedAt,
				structuralGeneratedAt: overlay.structuralGeneratedAt,
				acceptedMaterialCount: overlay.acceptedMaterials.length,
				discardedSuggestionCount: overlay.discardedSuggestions.length
			})
		},
		semanticOverlay: overlay
	};
}

async function executeSemanticIngressAssignment(
	toolCall: ToolCall,
	activeAssetId: VehicleAssetId | undefined
): Promise<ExecutedToolResult> {
	if (!activeAssetId) {
		throw new OpenAIChatInputError('No active vehicle asset is available for semantic ingress.');
	}

	const args = parseAssignSemanticIngressToolArgs(toolCall.function.arguments);
	const binding = await assignSemanticIngress({
		assetId: activeAssetId,
		targetType: args.targetType,
		targetId: args.targetId,
		targetLabel: args.targetLabel,
		transport: args.transport,
		assignedBy: 'model'
	});

	return {
		message: {
			role: 'tool',
			tool_call_id: toolCall.id,
			content: JSON.stringify(binding)
		},
		semanticIngressBindings: (await listSemanticIngressBindings(activeAssetId)).bindings
	};
}

export async function executeSemanticToolCall(
	toolCall: ToolCall,
	activeAssetId?: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[] = [],
	presentation?: FooterChatPresentationContext
): Promise<ExecutedToolResult | null> {
	try {
		if (toolCall.function.name === EDIT_VEHICLE_SEMANTICS_TOOL_NAME) {
			const args = parseEditVehicleSemanticsToolArgs(toolCall.function.arguments);
			let legacyName: string;
			let legacyArgs: Record<string, unknown>;

			if (args.action === 'assign' || args.action === 'reassign' || args.action === 'unassign') {
				legacyName = MUTATE_VEHICLE_SEMANTIC_ASSIGNMENT_TOOL_NAME;
				legacyArgs = {
					action: args.action,
					scope: args.scope,
					targetScope: args.targetScope,
					nodeIds: args.nodeIds,
					materialIds: args.materialIds,
					query: args.query,
					semanticGroup: args.semanticGroup,
					category: args.category,
					humanLabel: args.humanLabel,
					aliases: args.aliases
				};
			} else if (
				args.action === 'create_group' ||
				args.action === 'patch_group' ||
				args.action === 'delete_group' ||
				args.action === 'get_group' ||
				args.action === 'get_node'
			) {
				legacyName = MANAGE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME;
				legacyArgs = {
					action:
						args.action === 'create_group'
							? 'create'
							: args.action === 'patch_group'
								? 'patch'
								: args.action === 'delete_group'
									? 'delete'
									: 'get',
					targetType: args.action === 'get_node' ? 'semantic_node' : 'semantic_group',
					scope: args.scope,
					query: args.query,
					groupId: args.groupId,
					nodeId: args.nodeId,
					nodeIds: args.nodeIds,
					humanLabel: args.humanLabel,
					aliases: args.aliases,
					category: args.category,
					supports: args.supports,
					assignmentMode: args.assignmentMode,
					exclusiveFamily: args.exclusiveFamily
				};
			} else if (args.action === 'refresh') {
				legacyName = REFRESH_VEHICLE_SEMANTICS_TOOL_NAME;
				legacyArgs = { force: args.force };
			} else if (args.action === 'assign_ingress') {
				legacyName = ASSIGN_SEMANTIC_INGRESS_TOOL_NAME;
				legacyArgs = {
					targetType: args.targetType,
					targetId: args.targetId,
					targetLabel: args.targetLabel,
					transport: args.transport
				};
			} else {
				throw new OpenAIChatInputError('Unsupported semantic action.');
			}

			return executeSemanticToolCall(
				{
					id: toolCall.id,
					function: {
						name: legacyName,
						arguments: JSON.stringify(legacyArgs)
					}
				},
				activeAssetId,
				selectedNodes,
				presentation
			);
		}

		if (toolCall.function.name === MUTATE_VEHICLE_SEMANTIC_ASSIGNMENT_TOOL_NAME) {
			return await executeSemanticAssignmentMutation(
				toolCall,
				activeAssetId,
				selectedNodes,
				presentation
			);
		}

		if (toolCall.function.name === MANAGE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME) {
			return await executeSemanticGroupManagement(
				toolCall,
				activeAssetId,
				selectedNodes,
				presentation
			);
		}

		if (toolCall.function.name === REFRESH_VEHICLE_SEMANTICS_TOOL_NAME) {
			return await executeSemanticRefresh(toolCall, activeAssetId);
		}

		if (toolCall.function.name === ASSIGN_SEMANTIC_INGRESS_TOOL_NAME) {
			return await executeSemanticIngressAssignment(toolCall, activeAssetId);
		}

		return null;
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
