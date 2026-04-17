import type { StructuralAssetSnapshot, StructuralMaterial, StructuralMesh, StructuralNode } from '$lib/server/connectors/gltf-structure/types';
import type {
	FooterChatPresentationContext,
	FooterChatViewerMode
} from '$lib/server/connectors/openai-chat/types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	VehicleSemanticGroup,
	VehicleSemanticMaterialSuggestion,
	VehicleSemanticOverlay,
	VehicleSemanticOverlayStatus,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';

export type SceneDagSelection = {
	selectedGroupId: string | null;
	selectedNodes: VehicleNodeSelection[];
	selectedNodeIds: string[];
	selectedMaterialIds: string[];
};

export type SceneDagPresentation = {
	activeIntentLabel?: string;
	highlightedTargets?: FooterChatPresentationContext['highlightedTargets'];
	materialTargets?: FooterChatPresentationContext['materialTargets'];
	hiddenTargets?: FooterChatPresentationContext['hiddenTargets'];
	viewerModes?: FooterChatViewerMode[];
};

export type SceneDag = {
	assetId: VehicleAssetId;
	structuralGeneratedAt: string;
	semanticOverlayStatus: VehicleSemanticOverlayStatus;
	structure: StructuralAssetSnapshot;
	structureIndex: {
		nodesById: Record<string, StructuralNode>;
		meshesById: Record<string, StructuralMesh>;
		materialsById: Record<string, StructuralMaterial>;
	};
	semanticOverlay: VehicleSemanticOverlay | null;
	semanticIndex: {
		groupsById: Record<string, VehicleSemanticGroup>;
		partsById: Record<string, VehicleSemanticPartUnit>;
		materialsById: Record<string, VehicleSemanticMaterialSuggestion>;
	};
	selection: SceneDagSelection;
	presentation?: SceneDagPresentation;
};
