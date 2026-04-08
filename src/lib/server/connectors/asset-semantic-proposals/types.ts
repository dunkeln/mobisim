import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type AssetSemanticProposalStatus = 'pending' | 'accepted' | 'rejected';

export type AssetSemanticProposal = {
	nodeId: string;
	semanticGroupId: string;
	status: AssetSemanticProposalStatus;
	source: 'llm';
	confidence: number;
	proposedAt: string;
};

export type AssetSemanticProposalsStore = {
	assetId: VehicleAssetId;
	structuralGeneratedAt: string;
	proposals: AssetSemanticProposal[];
};
