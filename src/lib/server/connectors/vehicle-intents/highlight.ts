import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	listSemanticGroupsByQuery,
	readVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';
import type { VehicleSemanticGroup } from '$lib/server/connectors/vehicle-semantic-overlay/types';
import { buildVehicleSemanticOverlayRuntimeIndex } from '$lib/semantic-overlay/runtime';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import {
	buildRenderableHighlightOperations,
	collectEntityMatchedNodeIds,
	collectEntityMatchedPaths
} from './patch-ops';
import { scoreSemanticEntityMatch } from './planner';
import { planVehiclePartIntent } from './part-intent';
import type { PlannedVehicleIntentResult } from './types';

const PRIMARY_HIGHLIGHT_FACTOR: [number, number, number, number] = [0.58, 0.54, 0.86, 1];
const GENERIC_CURRENT_GROUP_QUERIES = new Set([
	'again',
	'current',
	'current group',
	'current semantic group',
	'focus',
	'highlight',
	'it',
	'same',
	'selected',
	'selection',
	'this',
	'that',
	'the current group',
	'the active group'
]);

type HighlightPlanOptions = {
	selectedGroupId?: string;
};

type ResolvedSemanticGroupHighlight = {
	assetId: VehicleAssetId;
	partQuery: string;
	matchedGroupLabel: string;
	matchedPaths: string[];
	operations: SharedVehicleInspectionPatchOperation[];
};

function normalizeSemanticReference(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function semanticGroupMatchesQuery(group: VehicleSemanticGroup, query: string): boolean {
	const normalizedQuery = normalizeSemanticReference(query);
	if (!normalizedQuery) {
		return true;
	}

	if (GENERIC_CURRENT_GROUP_QUERIES.has(normalizedQuery)) {
		return true;
	}

	const queryTerms = normalizedQuery.split(' ').filter((term) => term.length > 0);
	if (
		queryTerms.length > 0 &&
		queryTerms.every((term) => GENERIC_CURRENT_GROUP_QUERIES.has(term))
	) {
		return true;
	}

	return [group.id, group.humanLabel, ...group.aliases].some((reference) => {
		const normalizedReference = normalizeSemanticReference(reference);
		return (
			normalizedReference === normalizedQuery ||
			normalizedReference.includes(normalizedQuery) ||
			normalizedQuery.includes(normalizedReference)
		);
	});
}

async function resolveSelectedSemanticGroupHighlight(
	assetId: VehicleAssetId,
	query: string,
	selectedGroupId?: string
): Promise<ResolvedSemanticGroupHighlight | null> {
	if (!selectedGroupId) {
		return null;
	}

	const overlay = await readVehicleSemanticOverlay(assetId);
	const group = overlay?.acceptedGroups.find((entry) => entry.id === selectedGroupId) ?? null;
	if (!group || !semanticGroupMatchesQuery(group, query)) {
		return null;
	}

	return resolveSemanticGroupHighlightFromGroup(assetId, query, group, overlay);
}

async function resolveSemanticGroupHighlightFromGroup(
	assetId: VehicleAssetId,
	query: string,
	group: VehicleSemanticGroup,
	overlay: Awaited<ReturnType<typeof readVehicleSemanticOverlay>>
): Promise<ResolvedSemanticGroupHighlight | null> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const structure = await deriveStructuralAssetSnapshot(assetId);
	const runtimeIndex = buildVehicleSemanticOverlayRuntimeIndex(overlay);
	const matchedEntities = [group, ...(runtimeIndex.partsByGroupId.get(group.id) ?? [])];
	const matchedNodeIds = collectEntityMatchedNodeIds(structure, matchedEntities);
	const matchedMaterialIds = Array.from(
		new Set(matchedEntities.flatMap((entity) => entity.materialIds))
	).sort((left, right) => left.localeCompare(right));
	const matchedPaths = collectEntityMatchedPaths(capabilities, matchedEntities);
	const operations = buildRenderableHighlightOperations(
		structure,
		capabilities,
		matchedNodeIds,
		matchedMaterialIds,
		group.humanLabel,
		PRIMARY_HIGHLIGHT_FACTOR
	);
	if (operations.length === 0) {
		return null;
	}

	return {
		assetId,
		partQuery: query,
		matchedGroupLabel: group.humanLabel,
		matchedPaths,
		operations
	};
}

async function resolveSemanticGroupHighlight(
	assetId: VehicleAssetId,
	query: string,
	selectedGroupId?: string
): Promise<ResolvedSemanticGroupHighlight | null> {
	const selectedGroupPlan = await resolveSelectedSemanticGroupHighlight(
		assetId,
		query,
		selectedGroupId
	);
	if (selectedGroupPlan) {
		return selectedGroupPlan;
	}

	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const matchedGroups = await listSemanticGroupsByQuery(
		assetId,
		capabilities.generatedAt,
		query,
		'highlight'
	);
	if (matchedGroups.length === 0) {
		return null;
	}

	const bestScore = Math.max(...matchedGroups.map((group) => scoreSemanticEntityMatch(group, query)));
	const bestGroup = matchedGroups.find((group) => scoreSemanticEntityMatch(group, query) === bestScore);
	if (!bestGroup) {
		return null;
	}

	const overlay = await readVehicleSemanticOverlay(assetId);
	return resolveSemanticGroupHighlightFromGroup(assetId, query, bestGroup, overlay);
}

async function validatePlannedOperations(
	assetId: VehicleAssetId,
	presetId: string,
	operations: SharedVehicleInspectionPatchOperation[]
): Promise<{ assetId: VehicleAssetId; operations: SharedVehicleInspectionPatchOperation[]; rejected: string[]; summary: string }> {
	const { validateVehicleInspectionPatchManifest } = await import('$lib/server/connectors/gltf-preprocess');
	const validation = await validateVehicleInspectionPatchManifest({
		assetId,
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

export async function planVehicleHighlightIntent(
	assetId: VehicleAssetId,
	query: string,
	options?: HighlightPlanOptions
): Promise<PlannedVehicleIntentResult & { matchedPaths: string[] }> {
	const normalizedQuery = query.trim();
	const semanticGroupPlan = await resolveSemanticGroupHighlight(
		assetId,
		normalizedQuery,
		options?.selectedGroupId
	);
	if (semanticGroupPlan) {
		const validation = await validatePlannedOperations(
			assetId,
			'vehicle-intent-highlight',
			semanticGroupPlan.operations
		);

		return {
			assetId,
			matchedPaths: semanticGroupPlan.matchedPaths,
			operations: validation.operations,
			rejected: validation.rejected,
			summary:
				validation.operations.length > 0
					? `Highlighted ${semanticGroupPlan.matchedGroupLabel}.`
					: 'No valid highlight targets were accepted.'
		};
	}

	const semanticPlan = await planVehiclePartIntent(assetId, normalizedQuery, 'highlight');
	const validation = await validatePlannedOperations(
		assetId,
		'vehicle-intent-highlight',
		semanticPlan.operations
	);

	return {
		assetId,
		matchedPaths: semanticPlan.matchedPaths,
		operations: validation.operations,
		rejected: validation.rejected,
		summary:
			validation.operations.length > 0
				? `Highlighted ${semanticPlan.matchedPaths.length} node(s).`
				: 'No valid highlight targets were accepted.'
	};
}
