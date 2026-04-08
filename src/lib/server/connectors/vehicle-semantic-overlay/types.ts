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
	derivedFrom?: Array<'llm' | 'synthetic' | 'materials' | 'parts' | 'user'>;
};

export type VehicleSemanticOverlayDiscard = {
	kind: 'material' | 'part' | 'group';
	payload: VehicleSemanticMaterialSuggestion | VehicleSemanticPartUnit | VehicleSemanticGroup;
	reason: string;
};

export type VehicleSemanticOverlayStatus = 'missing' | 'stale' | 'fresh' | 'unknown';

export type VehicleSemanticOverlay = {
	assetId: VehicleAssetId;
	structuralGeneratedAt: string;
	generatedAt: string;
	model: string;
	minAcceptedConfidence: number;
	acceptedMaterials: VehicleSemanticMaterialSuggestion[];
	acceptedParts: VehicleSemanticPartUnit[];
	acceptedGroups: VehicleSemanticGroup[];
	discardedSuggestions: VehicleSemanticOverlayDiscard[];
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
