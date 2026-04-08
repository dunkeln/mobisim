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

export type FooterChatSidebarCard = {
	title: string;
	entries: Record<string, string | number | boolean | null>;
};

export type FooterChatSidebarState = {
	active: boolean;
	cards: FooterChatSidebarCard[];
};

export type FooterChatSupplementaryListState = {
	active: boolean;
	items: string[];
};

export type FooterChatTrace = {
	route: 'presentation_restore' | 'direct_edit' | 'llm';
	semanticOverlayStatus: 'missing' | 'stale' | 'fresh' | 'unknown';
	toolCalls: string[];
	sidebarAction: 'unchanged' | 'updated' | 'cleared';
	supplementaryListAction: 'unchanged' | 'updated' | 'cleared';
};

export type FooterChatRequest = {
	message: string;
	assetId?: VehicleAssetId;
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
	selectedNodes?: VehicleNodeSelection[];
	presentation?: FooterChatPresentationContext;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
};

export type FooterChatVehiclePatchOperation = VehicleInspectionPatchOperation;

export type FooterChatSelectionUpdate = {
	mode: 'replace';
	selectedNodes: VehicleNodeSelection[];
	label?: string;
};

export type FooterChatHistoryAction = 'undo' | 'redo' | 'reset' | 'clear_highlights';

export type FooterChatResponse = {
	message: FooterChatMessage;
	model: string;
	historyAction?: FooterChatHistoryAction;
	vehiclePatchAssetId?: VehicleAssetId;
	vehiclePatchLabel?: string;
	vehiclePatchOperations?: FooterChatVehiclePatchOperation[];
	presentationRestore?: FooterChatPresentationRestore;
	selectionUpdate?: FooterChatSelectionUpdate;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
	trace?: FooterChatTrace;
};

export type FooterChatAudioResponse = {
	transcript: string;
	audioBase64?: string;
	audioMimeType?: string;
	audioVoice?: string;
	chat: FooterChatResponse;
};
