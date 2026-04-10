import type { VehicleAssetId } from '$lib/vehicles/catalog';

export const VEHICLE_SEMANTIC_TAGS = [
	'body_paint_candidate',
	'glass_candidate',
	'left_headlight',
	'right_headlight',
	'front_grille',
	'wheel_outer_face'
] as const;

export type VehicleSemanticTag = (typeof VEHICLE_SEMANTIC_TAGS)[number];

export type VehicleSemanticMaterialSuggestion = {
	targetType: 'material';
	targetId: string;
	targetName: string;
	humanLabel: string;
	aliases: string[];
	semanticTags: VehicleSemanticTag[];
	confidence: number;
};

export const VEHICLE_SEMANTIC_PART_CATEGORIES = [
	'body',
	'wheel',
	'light',
	'glass',
	'grille',
	'door',
	'interior',
	'trim',
	'other'
] as const;

export type VehicleSemanticPartCategory = (typeof VEHICLE_SEMANTIC_PART_CATEGORIES)[number];
export type VehicleSemanticPartSide = 'left' | 'right' | 'center';
export type VehicleSemanticPartRegion = 'front' | 'rear' | 'mid' | 'roof' | 'full';
export type VehicleSemanticActionSupport =
	| 'highlight'
	| 'focus'
	| 'isolate'
	| 'paint'
	| 'tint';

export type VehicleSemanticPartUnit = {
	id: string;
	humanLabel: string;
	aliases: string[];
	confidence: number;
	category: VehicleSemanticPartCategory;
	nodeIds: string[];
	meshIds: string[];
	materialIds: string[];
	anchorNodeId?: string;
	side?: VehicleSemanticPartSide;
	region?: VehicleSemanticPartRegion;
};

export type VehicleSemanticGroup = {
	id: string;
	humanLabel: string;
	aliases: string[];
	confidence: number;
	category:
		| 'wheels'
		| 'doors'
		| 'front_lighting'
		| 'rear_lighting'
		| 'glasshouse'
		| 'body_shell'
		| 'front_face'
		| 'trim'
		| 'interior'
		| 'other';
	supports: VehicleSemanticActionSupport[];
	nodeIds: string[];
	meshIds: string[];
	materialIds: string[];
	author: 'agent' | 'user';
};

export type VehicleSemanticOverlayDiscard = {
	kind: 'material' | 'part' | 'group';
	payload: VehicleSemanticMaterialSuggestion | VehicleSemanticPartUnit | VehicleSemanticGroup;
	reason: string;
};

export type VehicleSemanticOverlayStatus = 'missing' | 'stale' | 'fresh' | 'unknown';

export type VehicleSemanticOverlay = {
	assetId: VehicleAssetId;
	revision: number;
	structuralGeneratedAt: string;
	generatedAt: string;
	model: string;
	minAcceptedConfidence: number;
	acceptedMaterials: VehicleSemanticMaterialSuggestion[];
	acceptedParts: VehicleSemanticPartUnit[];
	acceptedGroups: VehicleSemanticGroup[];
	discardedSuggestions: VehicleSemanticOverlayDiscard[];
};

export type SemanticCommand =
	| { type: 'assign'; assetId: VehicleAssetId }
	| { type: 'reassign'; assetId: VehicleAssetId }
	| { type: 'unassign'; assetId: VehicleAssetId }
	| { type: 'create_group'; assetId: VehicleAssetId }
	| { type: 'patch_group'; assetId: VehicleAssetId }
	| { type: 'delete_group'; assetId: VehicleAssetId }
	| { type: 'refresh_overlay'; assetId: VehicleAssetId }
	| { type: 'assign_ingress'; assetId: VehicleAssetId };

export type SemanticCommandResult = {
	commandStatus: 'succeeded' | 'failed';
	appliedCommand?: SemanticCommand['type'];
	overlay: VehicleSemanticOverlay | null;
	overlayRevision: number | null;
	overlayStatus: VehicleSemanticOverlayStatus;
};

export type VehicleSemanticOverlaySnapshot = {
	overlay: VehicleSemanticOverlay | null;
	overlayRevision: number | null;
	overlayStatus: VehicleSemanticOverlayStatus;
	commandStatus?: SemanticCommandResult['commandStatus'];
	appliedCommand?: SemanticCommandResult['appliedCommand'];
};

export type GenerateVehicleSemanticOverlayOptions = {
	force?: boolean;
	minAcceptedConfidence?: number;
};

export type VehicleSemanticGroupAnnotation = {
	nodeIds: string[];
	category?: VehicleSemanticGroup['category'];
	semanticGroup?: string;
	humanLabel?: string;
	aliases?: string[];
	materialSelections?: Array<{
		nodeId: string;
		materialIndex?: number;
		materialName?: string;
	}>;
};

export function partMatchesGroup(
	part: VehicleSemanticPartUnit,
	group: VehicleSemanticGroup
): boolean {
	if (group.nodeIds.some((nodeId) => part.nodeIds.includes(nodeId))) {
		return true;
	}

	if (group.materialIds.some((materialId) => part.materialIds.includes(materialId))) {
		return true;
	}

	return false;
}

export type VehicleSemanticOverlayRuntimeIndex = {
	partsById: Map<string, VehicleSemanticPartUnit>;
	partsByNodeId: Map<string, VehicleSemanticPartUnit[]>;
	partsByMaterialId: Map<string, VehicleSemanticPartUnit[]>;
	partsByGroupId: Map<string, VehicleSemanticPartUnit[]>;
	uncoveredNodeIdsByGroupId: Map<string, string[]>;
};

export function buildVehicleSemanticOverlayRuntimeIndex(
	overlay: VehicleSemanticOverlay | null | undefined
): VehicleSemanticOverlayRuntimeIndex {
	const partsById = new Map<string, VehicleSemanticPartUnit>();
	const partsByNodeId = new Map<string, VehicleSemanticPartUnit[]>();
	const partsByMaterialId = new Map<string, VehicleSemanticPartUnit[]>();
	const partsByGroupId = new Map<string, VehicleSemanticPartUnit[]>();
	const uncoveredNodeIdsByGroupId = new Map<string, string[]>();

	if (!overlay) {
		return {
			partsById,
			partsByNodeId,
			partsByMaterialId,
			partsByGroupId,
			uncoveredNodeIdsByGroupId
		};
	}

	for (const part of overlay.acceptedParts) {
		partsById.set(part.id, part);
		for (const nodeId of part.nodeIds) {
			partsByNodeId.set(nodeId, [...(partsByNodeId.get(nodeId) ?? []), part]);
		}

		for (const materialId of part.materialIds) {
			partsByMaterialId.set(materialId, [...(partsByMaterialId.get(materialId) ?? []), part]);
		}
	}

	for (const group of overlay.acceptedGroups) {
		const matchedParts = overlay.acceptedParts
			.filter((part) => partMatchesGroup(part, group))
			.slice()
			.sort((left, right) => right.confidence - left.confidence);
		partsByGroupId.set(group.id, matchedParts);

		const coveredNodeIds = new Set(matchedParts.flatMap((part) => part.nodeIds));
		const uncoveredNodeIds = group.nodeIds.filter((nodeId) => !coveredNodeIds.has(nodeId));
		uncoveredNodeIdsByGroupId.set(group.id, uncoveredNodeIds);
	}

	return {
		partsById,
		partsByNodeId,
		partsByMaterialId,
		partsByGroupId,
		uncoveredNodeIdsByGroupId
	};
}

export type VehicleSemanticAssignmentMutation = {
	action: 'assign' | 'reassign' | 'unassign';
	nodeIds: string[];
	materialIds?: string[];
	category?: VehicleSemanticGroup['category'];
	semanticGroup?: string;
	humanLabel?: string;
	aliases?: string[];
	materialSelections?: Array<{
		nodeId: string;
		materialIndex?: number;
		materialName?: string;
	}>;
};
