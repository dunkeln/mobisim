import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type StructuralSceneSummary = {
	id: string;
	name: string;
	rootNodeNames: string[];
	bounds: {
		min: [number, number, number];
		max: [number, number, number];
	};
};

export type StructuralNode = {
	id: string;
	name: string;
	path: string;
	parentId: string | null;
	childIds: string[];
	childCount: number;
	meshId: string | null;
	bounds?: {
		min: [number, number, number];
		max: [number, number, number];
		center: [number, number, number];
	};
	translation: [number, number, number];
	worldTranslation: [number, number, number];
	rotation: [number, number, number, number];
	scale: [number, number, number];
};

export type StructuralMesh = {
	id: string;
	name: string;
	primitiveCount: number;
	attributeSemantics: string[];
	materialIds: string[];
	materialNames: string[];
	hasTexcoord0: boolean;
	hasTexcoord1: boolean;
};

export type StructuralMaterial = {
	id: string;
	name: string;
	alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
	doubleSided: boolean;
	textureSlots: string[];
	meshIds: string[];
	meshNames: string[];
	meshMaterialSlots: Array<{
		meshId: string;
		slotIndices: number[];
	}>;
	nodeIds: string[];
	nodePaths: string[];
};

export type StructuralAssetSnapshot = {
	assetId: VehicleAssetId;
	assetPath: string;
	generatedAt: string;
	scenes: StructuralSceneSummary[];
	nodes: StructuralNode[];
	meshes: StructuralMesh[];
	materials: StructuralMaterial[];
};
