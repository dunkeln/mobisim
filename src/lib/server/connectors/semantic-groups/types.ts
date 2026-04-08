import type {
	VehicleSemanticActionSupport,
	VehicleSemanticGroup
} from '$lib/server/connectors/vehicle-semantic-overlay/types';

export type SemanticGroupAssignmentMode = 'exclusive' | 'overlay';

export type SemanticGroupDefinition = {
	id: string;
	humanLabel: string;
	aliases: string[];
	category: VehicleSemanticGroup['category'];
	supports: VehicleSemanticActionSupport[];
	assignmentMode: SemanticGroupAssignmentMode;
	exclusiveFamily?: string;
};

export type SemanticGroupDefinitionsStore = {
	definitions: SemanticGroupDefinition[];
};
