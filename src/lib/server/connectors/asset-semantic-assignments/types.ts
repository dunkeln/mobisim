import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type ReviewedAssetSemanticAssignment = {
	nodeId?: string;
	materialId?: string;
	semanticGroupId: string;
	status: 'reviewed';
	reviewer: 'user' | 'system';
	reviewedAt: string;
	confidence: 1;
};

export type AssetSemanticAssignmentsStore = {
	assetId: VehicleAssetId;
	structuralGeneratedAt: string;
	assignments: ReviewedAssetSemanticAssignment[];
};

export type ReviewedSemanticGroupExample = {
	semanticGroupId: string;
	assetId: VehicleAssetId;
	nodeNames: string[];
	pathHints: string[];
	meshNames: string[];
	materialNames: string[];
};
