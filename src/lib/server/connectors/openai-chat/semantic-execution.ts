import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	createSemanticGroupDefinition,
	deleteSemanticGroupDefinition,
	findSemanticGroupDefinition,
	patchSemanticGroupDefinition,
	resolveSemanticGroupDefinition
} from '$lib/server/connectors/semantic-groups';
import {
	deleteVehicleSemanticOverlay,
	generateVehicleSemanticOverlay,
	mutateVehicleSemanticAssignment,
	readVehicleSemanticOverlay,
	writeVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';
import { loadSceneDag } from '$lib/server/scene-dag';
import type {
	VehicleSemanticGroup,
	VehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import { buildVehicleSemanticOverlayRuntimeIndex } from '$lib/semantic-overlay/runtime';
import { selectMatchingPresentationTargetIds } from '$lib/contracts/footer-chat-restore';
import {
	getSelectionConstraintNodeIds,
	type VehicleNodeSelection
} from '$lib/stores/vehicle-node-selection';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import { OpenAIChatInputError } from './errors';
import {
	EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
	type ExecutedToolResult,
	type ManageVehicleSemanticGroupToolArgs,
	type MutateVehicleSemanticAssignmentToolArgs
} from './internal';
import {
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

const BROAD_SEMANTIC_MUTATION_TARGET_THRESHOLD = 12;

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

function countAffectedSemanticTargets(input: { nodeIds: string[]; materialIds: string[] }): number {
	return new Set([
		...input.nodeIds.map((nodeId) => `node:${nodeId}`),
		...input.materialIds.map((materialId) => `material:${materialId}`)
	]).size;
}

function buildSemanticMutationTrace(input: {
	action: 'assign' | 'reassign' | 'unassign';
	nodeIds: string[];
	materialIds: string[];
}) {
	const affectedTargetCount = countAffectedSemanticTargets(input);
	return {
		executedToolDomain: 'semantics' as const,
		executedAction: input.action,
		affectedTargetCount,
		destructiveScope:
			input.action === 'reassign' && affectedTargetCount > BROAD_SEMANTIC_MUTATION_TARGET_THRESHOLD
				? ('broad_membership_mutation' as const)
				: ('none' as const),
		approvalSummary:
			input.action === 'reassign' && affectedTargetCount > BROAD_SEMANTIC_MUTATION_TARGET_THRESHOLD
				? `Apply semantic reassignment across ${affectedTargetCount} targets?`
				: undefined
	};
}

function buildSemanticGroupTrace(input: {
	action: 'create' | 'patch' | 'delete' | 'get';
	affectedTargetCount?: number;
	destructiveScope?: 'none' | 'group_delete';
	approvalSummary?: string;
}) {
	return {
		executedToolDomain: 'semantics' as const,
		executedAction: `${input.action}_group`,
		affectedTargetCount: input.affectedTargetCount,
		destructiveScope: input.destructiveScope ?? 'none',
		approvalSummary: input.approvalSummary
	};
}

function isEmptySemanticLookup(value: string | undefined): boolean {
	return !value || normalizeSemanticLookupToken(value).length === 0;
}

function serializeSemanticGroup(group: VehicleSemanticGroup): VehicleSemanticGroup {
	return {
		...group,
		aliases: Array.isArray(group.aliases) ? [...group.aliases] : [],
		nodeIds: Array.isArray(group.nodeIds) ? [...group.nodeIds] : [],
		materialIds: Array.isArray(group.materialIds) ? [...group.materialIds] : [],
		supports: Array.isArray(group.supports) ? [...group.supports] : []
	};
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
	const overlay = await readVehicleSemanticOverlay(activeAssetId);
	const partById = new Map((overlay?.acceptedParts ?? []).map((part) => [part.id, part]));
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));
	const selectedMaterialIds = new Set<string>();

	for (const selection of selections) {
		if (selection.targetType === 'part' && selection.targetId) {
			partById.get(selection.targetId)?.materialIds.forEach((materialId) => {
				selectedMaterialIds.add(materialId);
			});
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
		const highlightedTargets = input.presentation?.highlightedTargets ?? [];
		const candidateTargets = input.query
			? (() => {
					const matchedIds = new Set(
						selectMatchingPresentationTargetIds(input.query, highlightedTargets)
					);
					const matchedTargets = highlightedTargets.filter((t) => matchedIds.has(t.targetId));
					return matchedTargets.length > 0 ? matchedTargets : highlightedTargets;
				})()
			: highlightedTargets;
		const nodeIds = dedupeSorted(
			candidateTargets.filter((t) => t.targetType === 'node').map((t) => t.targetId)
		);
		const materialIds = dedupeSorted(
			candidateTargets
				.filter((t) => !t.targetType || t.targetType === 'material')
				.map((t) => t.targetId)
		);
		return { nodeIds, materialIds };
	}

	if (effectiveScope === 'hidden') {
		const nodeIds = input.query
			? selectMatchingPresentationTargetIds(input.query, input.presentation?.hiddenTargets)
			: (input.presentation?.hiddenTargets ?? []).map((target) => target.targetId);
		return { nodeIds, materialIds: [] };
	}

	const filteredSelections =
		!isEmptySemanticLookup(input.query)
			? (() => {
					const matchedSelections = scopedSelections.filter((selection) =>
						normalizeSemanticLookupToken(
							`${selection.targetName ?? selection.nodeName} ${selection.targetId ?? selection.nodeId} ${selection.nodeName} ${selection.nodePath} ${selection.materialName ?? ''} ${getSelectionConstraintNodeIds(selection).join(' ')}`
						).includes(normalizeSemanticLookupToken(input.query ?? ''))
					);
					return matchedSelections.length > 0 ? matchedSelections : scopedSelections;
				})()
			: scopedSelections;

	return {
		nodeIds: dedupeSorted(
			filteredSelections.flatMap((selection) => getSelectionConstraintNodeIds(selection))
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
							.filter((selection) =>
							getSelectionConstraintNodeIds(selection).some((nodeId) =>
									explicitNodeIds.includes(nodeId)
								)
							)
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
							.filter((selection) =>
							getSelectionConstraintNodeIds(selection).some((nodeId) =>
									explicitNodeIds.includes(nodeId)
								)
							)
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
		const highlightedTargets = input.presentation?.highlightedTargets ?? [];
		const matchedHighlightIds =
			!isEmptySemanticLookup(input.args.query)
				? new Set(selectMatchingPresentationTargetIds(input.args.query!, highlightedTargets))
				: null;
		const effectiveHighlightedTargets =
			matchedHighlightIds && matchedHighlightIds.size > 0
				? highlightedTargets.filter((target) => matchedHighlightIds.has(target.targetId))
				: highlightedTargets;
		const highlightedNodeIds = dedupeSorted(
			selectPresentationTargetsByType(effectiveHighlightedTargets, 'node')
		);
		const highlightedMaterialIds = dedupeSorted(
			selectPresentationTargetsByType(effectiveHighlightedTargets, 'material')
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
		!isEmptySemanticLookup(input.args.query)
			? (() => {
					const matchedSelections = scopedSelections.filter((selection) =>
						normalizeSemanticLookupToken(
							`${selection.targetName ?? selection.nodeName} ${selection.targetId ?? selection.nodeId} ${selection.nodeName} ${selection.nodePath} ${selection.materialName ?? ''} ${getSelectionConstraintNodeIds(selection).join(' ')}`
						).includes(normalizeSemanticLookupToken(input.args.query ?? ''))
					);
					return matchedSelections.length > 0 ? matchedSelections : scopedSelections;
				})()
			: scopedSelections;
	const selectedNodeIds = dedupeSorted(
		filteredSelections.flatMap((selection) => getSelectionConstraintNodeIds(selection))
	);

	if (explicitTargetScope === 'node') {
		return {
			nodeIds: selectedNodeIds,
			materialIds: [],
			materialSelections: filteredSelections.map(toSelectionMaterialRef),
			scope: 'node'
		};
	}

	const selectedMaterialIds =
		explicitTargetScope === 'material' || explicitTargetScope === 'mixed'
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
	if (!overlay) return null;
	return writeVehicleSemanticOverlay({ ...overlay, generatedAt: new Date().toISOString() });
}

async function applySemanticAssignmentCommand(
	activeAssetId: VehicleAssetId,
	command: SemanticAssignmentCommand
): Promise<VehicleSemanticOverlay> {
	try {
		return await mutateVehicleSemanticAssignment(activeAssetId, {
			action: command.action,
			nodeIds: command.nodeIds,
			materialIds: command.materialIds,
			semanticGroup: command.semanticGroup,
			category: command.category,
			humanLabel: command.humanLabel,
			aliases: command.aliases,
			materialSelections: command.materialSelections
		});
	} catch (error) {
		throw new OpenAIChatInputError(
			error instanceof Error ? error.message : 'Semantic assignment failed.'
		);
	}
}

async function executeSemanticAssignmentMutation(
	toolCallId: string,
	activeAssetId: VehicleAssetId | undefined,
	args: MutateVehicleSemanticAssignmentToolArgs,
	selectedNodes: VehicleNodeSelection[],
	presentation?: FooterChatPresentationContext,
	selectedGroupId?: string
): Promise<ExecutedToolResult> {
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

	const definition = await resolveSemanticGroupDefinition({
		semanticGroup: args.semanticGroup,
		category: args.category,
		humanLabel: args.humanLabel,
		aliases: args.aliases
	});

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
	const sceneDag = await loadSceneDag({
		activeAssetId,
		semanticOverlay: overlay,
		selectedNodes,
		selectedGroupId: definition.id || selectedGroupId || null,
		presentation
	});

	return {
		message: {
			role: 'tool',
			tool_call_id: toolCallId,
			content: JSON.stringify({
				action: args.action,
				result: {
					sceneDag
				},
				query: args.query,
				semanticGroup: args.semanticGroup,
				category: args.category,
				targetScope: resolvedTargets.scope
			})
		},
		semanticOverlay: overlay,
		selectedGroupId: definition.id || selectedGroupId || null,
		trace: buildSemanticMutationTrace({
			action: args.action,
			nodeIds: resolvedTargets.nodeIds,
			materialIds: resolvedTargets.materialIds
		}),
		presentationRestore:
			effectiveScope === 'highlighted' &&
			(resolvedTargets.nodeIds.length > 0 || resolvedTargets.materialIds.length > 0)
				? {
						highlightedTargetIds: [...resolvedTargets.nodeIds, ...resolvedTargets.materialIds],
						label: 'restore original view'
					}
				: undefined
	};
}

async function executeSemanticGroupManagement(
	toolCallId: string,
	activeAssetId: VehicleAssetId | undefined,
	args: ManageVehicleSemanticGroupToolArgs,
	selectedNodes: VehicleNodeSelection[],
	presentation?: FooterChatPresentationContext,
	selectedGroupId?: string
): Promise<ExecutedToolResult> {
	const semanticGroupReference = args.semanticGroup ?? args.query ?? args.groupId;

	if (args.action === 'create') {
		if (!args.groupId && !semanticGroupReference && !args.humanLabel && !args.category) {
			throw new OpenAIChatInputError('A semantic group reference or label is required to create a semantic group.');
		}

		const existingDefinition =
			(await findSemanticGroupDefinition({
				id: args.groupId,
				semanticGroup: semanticGroupReference,
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
					tool_call_id: toolCallId,
					content: JSON.stringify({
						action: args.action,
						groupId: definition.id,
						humanLabel: definition.humanLabel,
						result: {
							definition: serializeSemanticGroup(definition),
							assignedTargetIds: []
						}
					})
				},
				selectedGroupId: definition.id,
				trace: buildSemanticGroupTrace({
					action: 'create',
					affectedTargetCount: 0
				})
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
					tool_call_id: toolCallId,
					content: JSON.stringify({
						action: args.action,
						groupId: definition.id,
						humanLabel: definition.humanLabel,
						result: {
							definition: serializeSemanticGroup(definition),
							assignedTargetIds: []
						}
					})
				},
				selectedGroupId: definition.id,
				trace: buildSemanticGroupTrace({
					action: 'create',
					affectedTargetCount: 0
				})
			};
		}

		const overlay = await applySemanticAssignmentCommand(activeAssetId, {
			action: 'assign',
			nodeIds: scopedTargets.nodeIds,
			materialIds: scopedTargets.materialIds,
			semanticGroup: definition.id,
			materialSelections: scopedTargets.materialSelections
		});
		const sceneDag = await loadSceneDag({
			activeAssetId,
			semanticOverlay: overlay,
			selectedNodes,
			selectedGroupId: definition.id,
			presentation
		});

		return {
			message: {
				role: 'tool',
				tool_call_id: toolCallId,
				content: JSON.stringify({
					action: args.action,
					groupId: definition.id,
					humanLabel: definition.humanLabel,
					result: {
						sceneDag,
						definition: serializeSemanticGroup(definition),
						assignedTargetIds: [...scopedTargets.nodeIds, ...scopedTargets.materialIds]
					}
				})
			},
			semanticOverlay: overlay,
			selectedGroupId: definition.id,
			trace: buildSemanticGroupTrace({
				action: 'create',
				affectedTargetCount: countAffectedSemanticTargets(scopedTargets)
			})
		};
	}

	if (args.action === 'patch') {
		const definition = await patchSemanticGroupDefinition({
			id: args.groupId,
			semanticGroup: semanticGroupReference,
			category: args.category,
			humanLabel: args.humanLabel,
			aliases: args.aliases,
			supports: args.supports,
			assignmentMode: args.assignmentMode,
			exclusiveFamily: args.exclusiveFamily
		});
		const overlay = activeAssetId ? await persistMaterializedSemanticOverlay(activeAssetId) : null;
		const sceneDag =
			activeAssetId && overlay
				? await loadSceneDag({
						activeAssetId,
						semanticOverlay: overlay,
						selectedNodes,
						selectedGroupId: definition.id,
						presentation
				  })
				: null;
		return {
			message: {
				role: 'tool',
				tool_call_id: toolCallId,
				content: JSON.stringify({
					action: args.action,
					groupId: definition.id,
					humanLabel: definition.humanLabel,
					category: definition.category,
					result: {
						sceneDag,
						definition: serializeSemanticGroup(definition)
					}
				})
			},
			semanticOverlay: overlay,
			selectedGroupId: definition.id,
			trace: buildSemanticGroupTrace({
				action: 'patch',
				affectedTargetCount: 1
			})
		};
	}

	if (args.action === 'delete') {
		if (!activeAssetId) {
			const definition = await deleteSemanticGroupDefinition({
				id: args.groupId,
				semanticGroup: semanticGroupReference,
				category: args.category
			});
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCallId,
					content: JSON.stringify({
						action: args.action,
						deletedDefinitionId: definition.id,
						result: {
							deletedDefinition: serializeSemanticGroup(definition)
						}
					})
				},
				selectedGroupId: selectedGroupId && selectedGroupId === definition.id ? null : undefined,
				trace: buildSemanticGroupTrace({
					action: 'delete',
					affectedTargetCount: 1,
					destructiveScope: 'group_delete',
					approvalSummary: `Delete semantic group "${definition.humanLabel}"?`
				})
			};
		}

		const overlay = await readVehicleSemanticOverlay(activeAssetId);
		if (!overlay) {
			throw new OpenAIChatInputError('No semantic overlay is available for semantic group deletion.');
		}

		const matchedGroupReference = semanticGroupReference ?? selectedGroupId;
		const matchedGroups = overlay.acceptedGroups.filter((group) => {
			const matchesGroupId = args.groupId ? group.id === args.groupId : false;
			const matchesCategory = args.category ? group.category === args.category : false;
			const matchesReference = matchedGroupReference
				? semanticGroupMatchesReference(group, matchedGroupReference)
				: false;
			return matchesGroupId || matchesCategory || matchesReference;
		});

		if (matchedGroups.length === 0) {
			throw new OpenAIChatInputError('No semantic group matched the current delete request.');
		}

		// Remove matched groups from the overlay
		const matchedGroupIds = new Set(matchedGroups.map((g) => g.id));
		const updatedOverlay: VehicleSemanticOverlay = {
			...overlay,
			acceptedGroups: overlay.acceptedGroups.filter((g) => !matchedGroupIds.has(g.id))
		};

		const nextOverlay = await writeVehicleSemanticOverlay(updatedOverlay);
		const nextSelectedGroupId =
			selectedGroupId && matchedGroups.some((group) => group.id === selectedGroupId)
				? null
				: selectedGroupId ?? null;
		const sceneDag = await loadSceneDag({
			activeAssetId,
			semanticOverlay: nextOverlay,
			selectedNodes,
			selectedGroupId: nextSelectedGroupId,
			presentation
		});

		return {
			message: {
				role: 'tool',
				tool_call_id: toolCallId,
				content: JSON.stringify({
					action: args.action,
					result: {
						sceneDag,
						deletedGroups: matchedGroups.map(serializeSemanticGroup)
					}
				})
			},
			semanticOverlay: nextOverlay,
			selectedGroupId: nextSelectedGroupId,
			trace: buildSemanticGroupTrace({
				action: 'delete',
				affectedTargetCount: matchedGroups.length,
				destructiveScope: 'group_delete',
				approvalSummary:
					matchedGroups.length === 1
						? `Delete semantic group "${matchedGroups[0]?.humanLabel ?? matchedGroups[0]?.id}"?`
						: 'Delete semantic group?'
			})
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
		const sceneDag = await loadSceneDag({
			activeAssetId,
			semanticOverlay: null,
			selectedNodes,
			selectedGroupId: selectedGroupId ?? null,
			presentation
		});
		return {
			message: {
				role: 'tool',
				tool_call_id: toolCallId,
				content: JSON.stringify({
					action: args.action,
					targetType: args.targetType,
					nodeId: targetNode.id,
					nodeName: targetNode.name,
					result: {
						sceneDag,
						targetNode: {
							...targetNode
						},
						mesh: mesh ? { ...mesh } : null
					}
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
		(semanticGroupReference
			? overlay.acceptedGroups.find((entry) => semanticGroupMatchesReference(entry, semanticGroupReference))
			: undefined);

	if (!group) {
		throw new OpenAIChatInputError('No semantic group matched the current request.');
	}

	const runtimeIndex = buildVehicleSemanticOverlayRuntimeIndex(overlay);
	const partCount = (runtimeIndex.partsByGroupId.get(group.id) ?? []).length;
	const sceneDag = await loadSceneDag({
		activeAssetId,
		semanticOverlay: overlay,
		selectedNodes,
		selectedGroupId: selectedGroupId ?? null,
		presentation
	});

	return {
		message: {
			role: 'tool',
			tool_call_id: toolCallId,
			content: JSON.stringify({
				action: args.action,
				targetType: args.targetType,
				groupId: group.id,
				humanLabel: group.humanLabel,
				result: {
					sceneDag,
					group: serializeSemanticGroup(group),
					partCount
				}
			})
		},
		trace: buildSemanticGroupTrace({
			action: 'get',
			affectedTargetCount: 1
		})
	};
}

async function executeSemanticRefresh(
	toolCallId: string,
	activeAssetId: VehicleAssetId | undefined,
	args: { force?: boolean },
	selectedNodes: VehicleNodeSelection[],
	presentation?: FooterChatPresentationContext,
	selectedGroupId?: string | null
): Promise<ExecutedToolResult> {
	if (!activeAssetId) {
		throw new OpenAIChatInputError('No active vehicle asset is available for semantic refresh.');
	}
	const overlay = await generateVehicleSemanticOverlay(activeAssetId, {
		force: args.force === true
	});
	const sceneDag = await loadSceneDag({
		activeAssetId,
		semanticOverlay: overlay,
		selectedNodes,
		selectedGroupId,
		presentation
	});
	return {
		message: {
			role: 'tool',
			tool_call_id: toolCallId,
			content: JSON.stringify({
				assetId: overlay.assetId,
				generatedAt: overlay.generatedAt,
				structuralGeneratedAt: overlay.structuralGeneratedAt,
				result: {
					sceneDag
				}
			})
		},
		semanticOverlay: overlay,
		trace: {
			executedToolDomain: 'semantics',
			executedAction: 'refresh',
			destructiveScope: 'none'
		}
	};
}

export async function executeSemanticToolCall(
	toolCall: ToolCall,
	activeAssetId?: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[] = [],
	presentation?: FooterChatPresentationContext,
	selectedGroupId?: string
): Promise<ExecutedToolResult | null> {
	try {
		if (toolCall.function.name === EDIT_VEHICLE_SEMANTICS_TOOL_NAME) {
			const parsed = JSON.parse(toolCall.function.arguments) as { action?: unknown };
			if (
				parsed.action === 'assign' ||
				parsed.action === 'reassign' ||
				parsed.action === 'unassign'
			) {
				return executeSemanticAssignmentMutation(
					toolCall.id,
					activeAssetId,
					parseMutateVehicleSemanticAssignmentToolArgs(toolCall.function.arguments),
					selectedNodes,
					presentation,
					selectedGroupId
				);
			}

			if (
				parsed.action === 'create_group' ||
				parsed.action === 'patch_group' ||
				parsed.action === 'delete_group' ||
				parsed.action === 'get_group'
			) {
				return executeSemanticGroupManagement(
					toolCall.id,
					activeAssetId,
					parseManageVehicleSemanticGroupToolArgs(toolCall.function.arguments),
					selectedNodes,
					presentation,
					selectedGroupId
				);
			}

			if (parsed.action === 'refresh') {
				return executeSemanticRefresh(
					toolCall.id,
					activeAssetId,
					parseRefreshVehicleSemanticsToolArgs(toolCall.function.arguments),
					selectedNodes,
					presentation,
					selectedGroupId
				);
			}

			if (parsed.action === 'delete_overlay') {
				if (!activeAssetId) {
					throw new OpenAIChatInputError(
						'No active vehicle asset is available for semantic overlay deletion.'
					);
				}

				await deleteVehicleSemanticOverlay(activeAssetId);
				return {
					message: {
						role: 'tool',
						tool_call_id: toolCall.id,
						content: JSON.stringify({
							action: 'delete_overlay',
							deletedOverlay: true,
							overlayStatus: 'missing'
						})
					},
					semanticOverlay: null,
					trace: {
						executedToolDomain: 'semantics',
						executedAction: 'delete_overlay',
						destructiveScope: 'overlay_delete',
						approvalSummary: 'Delete semantic overlay for this asset?'
					}
				};
			}

			throw new OpenAIChatInputError('Unsupported semantic action.');
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
