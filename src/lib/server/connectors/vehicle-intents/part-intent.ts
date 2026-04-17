import {
	deriveVehicleInspectionCapabilities,
	planVehicleBodyPaint
} from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	listSemanticGroupsByQuery,
	listSemanticPartsByQuery
} from '$lib/server/connectors/vehicle-semantic-overlay';
import type {
	VehicleSemanticGroup,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import {
	getSelectionConstraintNodeIds,
	type VehicleNodeSelection
} from '$lib/stores/vehicle-node-selection';
import {
	ISOLATE_CONTEXT_ALPHA,
	REMOVE_PART_ALPHA
} from './constants';
import type {
	PlannedVehiclePartIntentResult,
	VehiclePartIntentMode,
	PlannedVehicleSetLogicIntentResult,
	VehicleIntentPresentationContext,
	VehiclePlannerTargetExpression
} from './types';
import {
	normalizePartQuery,
	requestNeedsHighlightedIntersection,
	requestPreservesCurrentPaint
} from './classifiers';
import {
	mapIntentModeToActionSupport,
	buildRenderableHighlightOperations,
	collectEntityMatchedNodeIds,
	collectEntityMatchedPaths,
	collectNodeTargetsFromMaterials,
	mergePatchOperations
} from './patch-ops';
import {
	scoreSemanticEntityMatch,
	flattenSemanticQueries,
	buildPlannerUnionExpression
} from './planner';

function selectTopScoringEntities<T extends VehicleSemanticGroup | VehicleSemanticPartUnit>(
	entities: T[],
	query: string
): T[] {
	if (entities.length <= 1) {
		return entities;
	}

	const scored = entities.map((entity) => ({
		entity,
		score: scoreSemanticEntityMatch(entity, query)
	}));
	const bestScore = Math.max(...scored.map((entry) => entry.score));

	return scored
		.filter((entry) => entry.score === bestScore)
		.map((entry) => entry.entity);
}

async function validatePlannedOperations(
	assetId: VehicleAssetId,
	presetId: string,
	operations: SharedVehicleInspectionPatchOperation[],
	baseGeneratedAt?: string
): Promise<{ assetId: VehicleAssetId; operations: SharedVehicleInspectionPatchOperation[]; rejected: string[]; summary: string }> {
	// Import the actual validation function from gltf-preprocess when needed
	const { validateVehicleInspectionPatchManifest } = await import('$lib/server/connectors/gltf-preprocess');
	const validation = await validateVehicleInspectionPatchManifest({
		assetId,
		baseGeneratedAt,
		userId: 'vehicle-intent',
		presetId,
		operations
	});

	return {
		assetId,
		operations: validation.accepted as SharedVehicleInspectionPatchOperation[],
		rejected: validation.rejected.map((item) => item.reason),
		summary:
			validation.accepted.length > 0
				? `Planned ${validation.accepted.length} patch operation(s).`
				: 'No valid patch operations were accepted.'
	};
}

export async function planVehiclePartIntent(
	assetId: VehicleAssetId,
	partQuery: string,
	mode: VehiclePartIntentMode = 'highlight',
	options?: {
		selectedNodes?: VehicleNodeSelection[];
		presentation?: VehicleIntentPresentationContext;
	}
): Promise<PlannedVehiclePartIntentResult> {
	const normalizedQuery = normalizePartQuery(partQuery);
	if (mode === 'remove' && (options?.selectedNodes?.length ?? 0) > 0) {
		const scopedSelectedNodes = options.selectedNodes!.filter((selection) => selection.assetId === assetId);
		const removalNodeIds = Array.from(
			new Set(scopedSelectedNodes.flatMap((selection) => getSelectionConstraintNodeIds(selection)))
		).sort((left, right) => left.localeCompare(right));
		if (removalNodeIds.length > 0) {
			return {
				assetId,
				mode,
				partQuery: normalizedQuery,
				matchedPartIds: scopedSelectedNodes
					.filter((selection) => selection.targetType === 'part' && selection.targetId)
					.map((selection) => selection.targetId!)
					.sort((left, right) => left.localeCompare(right)),
				matchedPartLabels: scopedSelectedNodes
					.map((selection) => selection.targetName ?? selection.nodeName)
					.sort((left, right) => left.localeCompare(right)),
				matchedNodeIds: removalNodeIds,
				matchedMaterialIds: [],
				matchedPaths: scopedSelectedNodes.map((selection) => selection.nodePath),
				matchedMaterialNames: [],
				operations: removalNodeIds.map((nodeId) => ({
					targetType: 'node' as const,
					targetId: nodeId,
					targetName: scopedSelectedNodes.find((selection) =>
						getSelectionConstraintNodeIds(selection).includes(nodeId)
					)?.targetName ?? scopedSelectedNodes[0]!.nodeName,
					op: 'set_alpha' as const,
					value: REMOVE_PART_ALPHA
				})),
				summary: `Removed selected target${removalNodeIds.length === 1 ? '' : 's'}.`
			};
		}
	}

	if (mode === 'remove' && (options?.presentation?.highlightedTargets?.length ?? 0) > 0) {
		const highlightedTargets = options?.presentation?.highlightedTargets ?? [];
		const highlightedNodeOperations = highlightedTargets
			.filter((target) => !target.targetType || target.targetType === 'node')
			.map((target) => ({
				targetType: 'node' as const,
				targetId: target.targetId,
				targetName: target.targetName ?? target.targetId,
				op: 'set_alpha' as const,
				value: REMOVE_PART_ALPHA
			}));
		const highlightedMaterialOperations = highlightedTargets
			.filter((target) => target.targetType === 'material')
			.map((target) => ({
				targetType: 'material' as const,
				targetId: target.targetId,
				targetName: target.targetName ?? target.targetId,
				op: 'set_alpha' as const,
				value: REMOVE_PART_ALPHA
			}));
		const highlightedRemovalOperations = [...highlightedNodeOperations, ...highlightedMaterialOperations];
		if (highlightedRemovalOperations.length > 0) {
			return {
				assetId,
				mode,
				partQuery: normalizedQuery,
				matchedPartIds: [],
				matchedPartLabels: highlightedTargets
					.map((target) => target.targetName ?? target.targetId)
					.sort((left, right) => left.localeCompare(right)),
				matchedNodeIds: highlightedTargets.map((target) => target.targetId).sort((left, right) =>
					left.localeCompare(right)
				),
				matchedMaterialIds: highlightedTargets
					.filter((target) => target.targetType === 'material')
					.map((target) => target.targetId)
					.sort((left, right) => left.localeCompare(right)),
				matchedPaths: [],
				matchedMaterialNames: [],
				operations: highlightedRemovalOperations,
				summary: `Removed highlighted target${highlightedRemovalOperations.length === 1 ? '' : 's'}.`
			};
		}
	}

	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const structure = await deriveStructuralAssetSnapshot(assetId);
	const matchedGroups = await listSemanticGroupsByQuery(
		assetId,
		capabilities.generatedAt,
		normalizedQuery,
		mapIntentModeToActionSupport(mode)
	);
	const matchedParts = await listSemanticPartsByQuery(
		assetId,
		capabilities.generatedAt,
		normalizedQuery
	);
	const bestGroupScore = matchedGroups.length
		? Math.max(...matchedGroups.map((group) => scoreSemanticEntityMatch(group, normalizedQuery)))
		: Number.NEGATIVE_INFINITY;
	const bestPartScore = matchedParts.length
		? Math.max(...matchedParts.map((part) => scoreSemanticEntityMatch(part, normalizedQuery)))
		: Number.NEGATIVE_INFINITY;
	const matchedEntities: Array<VehicleSemanticGroup | VehicleSemanticPartUnit> =
		matchedParts.length > 0 && bestPartScore >= bestGroupScore
			? selectTopScoringEntities(matchedParts, normalizedQuery)
			: matchedGroups.length > 0
				? selectTopScoringEntities(matchedGroups, normalizedQuery)
				: matchedParts;

	const semanticNodeIds = Array.from(
		new Set(collectEntityMatchedNodeIds(structure, matchedEntities))
	).sort((left, right) => left.localeCompare(right));

	const matchedNodeIds = semanticNodeIds;

	if (matchedEntities.length === 0 && matchedNodeIds.length === 0) {
		return {
			assetId,
			mode,
			partQuery: normalizedQuery,
			matchedPartIds: [],
			matchedPartLabels: [],
			matchedNodeIds: [],
			matchedMaterialIds: [],
			matchedPaths: [],
			matchedMaterialNames: [],
			operations: [],
			summary: `No semantic part units matched "${normalizedQuery}".`
		};
	}
	const matchedMaterialIds = Array.from(
		new Set(matchedEntities.flatMap((entity) => entity.materialIds))
	).sort((left, right) => left.localeCompare(right));
	const matchedMaterialNames = capabilities.materials
		.filter((material) => matchedMaterialIds.includes(material.id))
		.map((material) => material.name)
		.sort((left, right) => left.localeCompare(right));
	const matchedPartLabels = matchedEntities
		.map((entity) => entity.humanLabel)
		.sort((left, right) => left.localeCompare(right));
	let operations: SharedVehicleInspectionPatchOperation[] = [];

	if (mode === 'highlight') {
		operations = buildRenderableHighlightOperations(
			structure,
			capabilities,
			matchedNodeIds,
			matchedMaterialIds,
			matchedPartLabels.join(', '),
			[0.58, 0.54, 0.86, 1] as [number, number, number, number]
		);
	}

	if (mode === 'isolate') {
		if (matchedNodeIds.length === 0) {
			// No nodes resolved — do not fade out the entire scene. Return early with
			// an honest summary so the model can report the failure rather than silently
			// nuking the viewport.
			return {
				assetId,
				mode,
				partQuery: normalizedQuery,
				matchedPartIds: [],
				matchedPartLabels: [],
				matchedNodeIds: [],
				matchedMaterialIds: [],
				matchedPaths: [],
				matchedMaterialNames: [],
				operations: [],
				summary: `Could not isolate "${normalizedQuery}" — no matching nodes were found.`
			};
		}

		const matchedNodeIdSet = new Set(matchedNodeIds);
		operations = [
			...capabilities.controlCandidates
				.filter((candidate) => !matchedNodeIdSet.has(candidate.nodeId) && candidate.meshId !== null)
				.map((candidate) => ({
					targetType: 'node' as const,
					targetId: candidate.nodeId,
					targetName: candidate.name,
					op: 'set_alpha' as const,
					value: ISOLATE_CONTEXT_ALPHA
				})),
			...buildRenderableHighlightOperations(
				structure,
				capabilities,
				matchedNodeIds,
				matchedMaterialIds,
				matchedPartLabels.join(', '),
				[0.58, 0.54, 0.86, 1] as [number, number, number, number]
			)
		];
	}

	if (mode === 'remove') {
		operations = matchedNodeIds.map((nodeId) => ({
			targetType: 'node' as const,
			targetId: nodeId,
			targetName: matchedPartLabels.join(', '),
			op: 'set_alpha' as const,
			value: REMOVE_PART_ALPHA
		}));
	}

	return {
		assetId,
		mode,
		partQuery: normalizedQuery,
		matchedPartIds: matchedEntities
			.map((entity) => entity.id)
			.sort((left, right) => left.localeCompare(right)),
		matchedPartLabels,
		matchedNodeIds,
		matchedMaterialIds,
		matchedPaths: collectEntityMatchedPaths(capabilities, matchedEntities),
		matchedMaterialNames,
		operations,
		summary: (() => {
			const label = matchedPartLabels.length > 0 ? matchedPartLabels.join(', ') : `"${normalizedQuery}"`;
			if (mode === 'highlight') return `Highlighted ${label}.`;
			if (mode === 'isolate') return `Isolated ${label}.`;
			if (mode === 'remove') return `Removed ${label}.`;
			return `Matched ${label} for ${mode}.`;
		})()
	};
}

export async function planVehicleSetLogicIntent(
	assetId: VehicleAssetId,
	request: string,
	options?: {
		presentation?: VehicleIntentPresentationContext;
	}
): Promise<PlannedVehicleSetLogicIntentResult | null> {
	const extractRemoveAllExceptExpression = (await import('./planner')).extractRemoveAllExceptExpression;
	const keepExpression = extractRemoveAllExceptExpression(request);
	if (!keepExpression) {
		return null;
	}
	const keepExpressionWithContext = requestNeedsHighlightedIntersection(request)
		? ({
				kind: 'intersect',
				left: keepExpression,
				right: { kind: 'highlighted_materials' }
			} as VehiclePlannerTargetExpression)
		: keepExpression;
	const plannerQueries = flattenSemanticQueries(keepExpressionWithContext);

	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const structure = await deriveStructuralAssetSnapshot(assetId);
	const materialIdsByMeshId = new Map<string, string[]>();
	for (const material of capabilities.materials) {
		for (const meshId of material.meshIds) {
			const existing = materialIdsByMeshId.get(meshId) ?? [];
			existing.push(material.id);
			materialIdsByMeshId.set(meshId, existing);
		}
	}
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	async function resolveExpression(
		expression: VehiclePlannerTargetExpression
	): Promise<{ materialIds: Set<string>; labels: Set<string> }> {
		if (expression.kind === 'semantic_query') {
			const matchedGroups = await listSemanticGroupsByQuery(
				assetId,
				capabilities.generatedAt,
				expression.query,
				'isolate'
			);
			const matchedParts = await listSemanticPartsByQuery(
				assetId,
				capabilities.generatedAt,
				expression.query
			);
			const bestGroupScore = matchedGroups.length
				? Math.max(...matchedGroups.map((group) => scoreSemanticEntityMatch(group, expression.query)))
				: Number.NEGATIVE_INFINITY;
			const bestPartScore = matchedParts.length
				? Math.max(...matchedParts.map((part) => scoreSemanticEntityMatch(part, expression.query)))
				: Number.NEGATIVE_INFINITY;
			const matchedEntities: Array<VehicleSemanticGroup | VehicleSemanticPartUnit> =
				matchedParts.length > 0 && bestPartScore >= bestGroupScore
					? selectTopScoringEntities(matchedParts, expression.query)
					: matchedGroups.length > 0
						? selectTopScoringEntities(matchedGroups, expression.query)
						: matchedParts;
			const materialIds = new Set<string>();
			const labels = new Set<string>();
			for (const entity of matchedEntities) {
				labels.add(entity.humanLabel);
				for (const materialId of entity.materialIds) {
					materialIds.add(materialId);
				}
				for (const meshId of entity.meshIds) {
					for (const materialId of materialIdsByMeshId.get(meshId) ?? []) {
						materialIds.add(materialId);
					}
				}
				for (const nodeId of entity.nodeIds) {
					const meshId = nodeById.get(nodeId)?.meshId;
					if (!meshId) {
						continue;
					}
					for (const materialId of materialIdsByMeshId.get(meshId) ?? []) {
						materialIds.add(materialId);
			}
		}
	}
			return { materialIds, labels };
		}

		if (expression.kind === 'highlighted_materials') {
			const materialIds = new Set(
				(options?.presentation?.highlightedTargets ?? [])
					.filter((target) => target.targetType === 'material')
					.map((target) => target.targetId)
			);
			return {
				materialIds,
				labels: new Set<string>(materialIds.size > 0 ? ['highlighted materials'] : [])
			};
		}

		if (expression.kind === 'union') {
			const materialIds = new Set<string>();
			const labels = new Set<string>();
			for (const item of expression.items) {
				const resolved = await resolveExpression(item);
				for (const materialId of resolved.materialIds) {
					materialIds.add(materialId);
				}
				for (const label of resolved.labels) {
					labels.add(label);
				}
			}
			return { materialIds, labels };
		}

		const left = await resolveExpression(expression.left);
		const right = await resolveExpression(expression.right);

		if (expression.kind === 'subtract') {
			const materialIds = new Set<string>(left.materialIds);
			for (const materialId of right.materialIds) {
				materialIds.delete(materialId);
			}
			return {
				materialIds,
				labels: left.labels
			};
		}

		const materialIds = new Set<string>();
		for (const materialId of left.materialIds) {
			if (right.materialIds.has(materialId)) {
				materialIds.add(materialId);
			}
		}
		return {
			materialIds,
			labels: left.labels
		};
	}

	const resolvedKeepExpression = await resolveExpression(keepExpressionWithContext);
	const keepMaterialIdsSet = resolvedKeepExpression.materialIds;
	const keepLabelsSet = resolvedKeepExpression.labels;

	for (const keepQuery of plannerQueries) {
		const matchedGroups = await listSemanticGroupsByQuery(
			assetId,
			capabilities.generatedAt,
			keepQuery,
			'isolate'
		);
		const matchedParts = await listSemanticPartsByQuery(assetId, capabilities.generatedAt, keepQuery);
		const bestGroupScore = matchedGroups.length
			? Math.max(...matchedGroups.map((group) => scoreSemanticEntityMatch(group, keepQuery)))
			: Number.NEGATIVE_INFINITY;
		const bestPartScore = matchedParts.length
			? Math.max(...matchedParts.map((part) => scoreSemanticEntityMatch(part, keepQuery)))
			: Number.NEGATIVE_INFINITY;
		const matchedEntities: Array<VehicleSemanticGroup | VehicleSemanticPartUnit> =
			matchedParts.length > 0 && bestPartScore >= bestGroupScore
				? selectTopScoringEntities(matchedParts, keepQuery)
				: matchedGroups.length > 0
					? selectTopScoringEntities(matchedGroups, keepQuery)
					: matchedParts;

		for (const entity of matchedEntities) {
			keepLabelsSet.add(entity.humanLabel);
		}
	}

	const keepMaterialIds = Array.from(keepMaterialIdsSet).sort((left, right) => left.localeCompare(right));
	const keepLabels = Array.from(keepLabelsSet).sort((left, right) => left.localeCompare(right));

	if (keepMaterialIds.length === 0) {
		return {
			assetId,
			operations: [],
			rejected: [],
			summary: `I could not resolve which materials should be kept for "${plannerQueries.join(', ')}".`,
			plannerJob: {
				intent: 'remove_all_except',
				assetId,
				keep: [keepExpressionWithContext],
				steps: [
					...plannerQueries.map((query) => ({ kind: 'resolve_keep_targets' as const, query })),
					...(requestNeedsHighlightedIntersection(request)
						? ([{ kind: 'read_highlighted_materials' as const }] as const)
						: []),
					{ kind: 'enumerate_all_materials' },
					{ kind: 'subtract_keep_targets' },
					{ kind: 'apply_remove_material_alpha', alpha: REMOVE_PART_ALPHA }
				],
				constraints: requestPreservesCurrentPaint(request)
					? [{ kind: 'preserve_current_paint' }]
					: undefined
			},
			verification: {
				preservedMaterialIds: [],
				mutatedMaterialIds: [],
				verificationPassed: false
			}
		};
	}

	const mutatedMaterialIds = capabilities.materials
		.map((material) => material.id)
		.filter((materialId) => !keepMaterialIds.includes(materialId))
		.sort((left, right) => left.localeCompare(right));

	const operations: SharedVehicleInspectionPatchOperation[] = collectNodeTargetsFromMaterials(
		capabilities,
		capabilities.materials.filter((material) => mutatedMaterialIds.includes(material.id))
	).map((target) => ({
		targetType: 'node' as const,
		targetId: target.nodeId,
		targetName: target.targetName,
		op: 'set_alpha' as const,
		value: REMOVE_PART_ALPHA
	}));

	const validation = await validatePlannedOperations(
		assetId,
		'vehicle-intent-remove-all-except',
		operations,
		capabilities.generatedAt
	);
	const acceptedMutatedMaterialIds = mutatedMaterialIds;

	return {
		assetId,
		operations: validation.operations,
		rejected: validation.rejected,
		summary:
			validation.operations.length > 0
				? `Removed everything except ${keepLabels.join(', ')} by reducing non-target material alpha.`
				: `Nothing outside ${keepLabels.join(', ')} could be removed.`,
		plannerJob: {
			intent: 'remove_all_except',
			assetId,
			keep: [keepExpressionWithContext],
			steps: [
				...plannerQueries.map((query) => ({ kind: 'resolve_keep_targets' as const, query })),
				...(requestNeedsHighlightedIntersection(request)
					? ([{ kind: 'read_highlighted_materials' as const }] as const)
					: []),
				{ kind: 'enumerate_all_materials' },
				{ kind: 'subtract_keep_targets' },
				{ kind: 'apply_remove_material_alpha', alpha: REMOVE_PART_ALPHA }
			],
			constraints: requestPreservesCurrentPaint(request)
				? [{ kind: 'preserve_current_paint' }]
				: undefined
		},
		verification: {
			preservedMaterialIds: keepMaterialIds,
			mutatedMaterialIds: acceptedMutatedMaterialIds,
			verificationPassed: acceptedMutatedMaterialIds.every((materialId) => !keepMaterialIds.includes(materialId))
		}
	};
}
