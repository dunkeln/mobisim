import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type SemanticIngressTargetType = 'semantic_group' | 'semantic_node';
export type SemanticIngressTransport = 'rest_sse' | 'stream';

export type SemanticIngressBinding = {
	ingressId: string;
	assetId: VehicleAssetId;
	structuralGeneratedAt: string;
	scope: 'global' | 'user';
	scopeKey?: string;
	targetType: SemanticIngressTargetType;
	targetId: string;
	targetLabel?: string;
	transport: SemanticIngressTransport;
	assignedAt: string;
	assignedBy: 'model' | 'user';
	restPath?: string;
	ssePath?: string;
	streamPath?: string;
};

export type SemanticIngressNumericSample = {
	timestamp: string;
	value: number;
	metric?: string;
	unit?: string;
	source?: string;
};

export type SemanticIngressStore = {
	assetId: VehicleAssetId;
	structuralGeneratedAt: string;
	bindings: SemanticIngressBinding[];
	samplesByIngress?: Record<string, SemanticIngressNumericSample[]>;
};

export type AssignSemanticIngressInput = {
	assetId: VehicleAssetId;
	targetType: SemanticIngressTargetType;
	targetId: string;
	targetLabel?: string;
	transport: SemanticIngressTransport;
	assignedBy?: 'model' | 'user';
	userId?: string | null;
};

export type IngestSemanticIngressSamplesInput = {
	assetId: VehicleAssetId;
	ingressId: string;
	samples: SemanticIngressNumericSample[];
};

export type SemanticIngressSnapshot = {
	binding: SemanticIngressBinding;
	samples: SemanticIngressNumericSample[];
};

export type ListSemanticIngressBindingsOptions = {
	userId?: string | null;
	targetType?: SemanticIngressTargetType;
	targetId?: string;
};
