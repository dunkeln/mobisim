import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';

export type VehicleInspectionSceneSummary = {
	id: string;
	name: string;
	rootNodeNames: string[];
	bounds: {
		min: [number, number, number];
		max: [number, number, number];
	};
};

export type VehicleInspectionControlCandidate = {
	nodeId: string;
	name: string;
	path: string;
	meshId: string | null;
	availableControls: Array<'translation' | 'rotation' | 'scale' | 'visibility'>;
};

export type VehicleInspectionDebugMesh = {
	meshId: string;
	name: string;
	attributeSemantics: string[];
	materialNames: string[];
};

export type VehicleInspectionMaterialSummary = {
	id: string;
	name: string;
	alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
	doubleSided: boolean;
	textureSlots: string[];
};

export type VehicleInspectionCapabilities = {
	assetId: VehicleAssetId;
	generatedAt: string;
	sceneCount: number;
	nodeCount: number;
	meshCount: number;
	materialCount: number;
	scenes: VehicleInspectionSceneSummary[];
	controlCandidates: VehicleInspectionControlCandidate[];
	wireframeMeshes: VehicleInspectionDebugMesh[];
	uvDebugMeshes: VehicleInspectionDebugMesh[];
	materials: VehicleInspectionMaterialSummary[];
};

export type VehicleInspectionPatchManifest = {
	assetId: VehicleAssetId;
	baseGeneratedAt?: string;
	userId: string;
	presetId: string;
	operations: VehicleInspectionPatchOperation[];
};

export type VehicleInspectionPatchRejection = {
	index: number;
	reason: string;
	operation: VehicleInspectionPatchOperation;
};

export type VehicleInspectionPatchValidationResult = {
	assetId: VehicleAssetId;
	presetId: string;
	userId: string;
	accepted: VehicleInspectionPatchOperation[];
	rejected: VehicleInspectionPatchRejection[];
};

export type VehiclePartHighlightPlan = {
	assetId: VehicleAssetId;
	partQuery: string;
	matchedPaths: string[];
	matchedMaterialNames: string[];
	operations: VehicleInspectionPatchOperation[];
};

export type VehicleBodyPaintPlan = {
	assetId: VehicleAssetId;
	color: [number, number, number, number];
	matchedMaterialNames: string[];
	operations: VehicleInspectionPatchOperation[];
};

export type VehicleWindowTintPlan = {
	assetId: VehicleAssetId;
	resolvedLabel: string;
	color: [number, number, number, number];
	matchedMaterialNames: string[];
	operations: VehicleInspectionPatchOperation[];
};
