import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';

export type FooterChatRole = 'user' | 'assistant';

export type FooterChatMessage = {
	role: FooterChatRole;
	content: string;
};

export type FooterChatPresentationTarget = {
	targetId: string;
	targetName?: string;
	operation?: VehicleInspectionPatchOperation['op'];
};

export type FooterChatViewerMode = 'wireframe' | 'xray' | 'uv_debug' | 'postprocess';

export type FooterChatPresentationContext = {
	activeIntentLabel?: string;
	highlightedTargets?: FooterChatPresentationTarget[];
	materialTargets?: FooterChatPresentationTarget[];
	hiddenTargets?: FooterChatPresentationTarget[];
	viewerModes?: FooterChatViewerMode[];
};

export type FooterChatPresentationRestore = {
	restoreAll?: boolean;
	highlightedTargetIds?: string[];
	materialTargetIds?: string[];
	hiddenTargetIds?: string[];
	viewerModes?: FooterChatViewerMode[];
	label?: string;
};

export type FooterChatRequest = {
	message: string;
	assetId?: VehicleAssetId;
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
	selectedNodes?: VehicleNodeSelection[];
	presentation?: FooterChatPresentationContext;
};

export type FooterChatVehiclePatchOperation = VehicleInspectionPatchOperation;

export type FooterChatSelectionUpdate = {
	mode: 'replace';
	selectedNodes: VehicleNodeSelection[];
	label?: string;
};

export type FooterChatResponse = {
	message: FooterChatMessage;
	model: string;
	vehiclePatchAssetId?: VehicleAssetId;
	vehiclePatchLabel?: string;
	vehiclePatchOperations?: FooterChatVehiclePatchOperation[];
	presentationRestore?: FooterChatPresentationRestore;
	selectionUpdate?: FooterChatSelectionUpdate;
};
