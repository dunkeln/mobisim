import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type {
	VehicleSemanticOverlay,
	VehicleSemanticOverlayStatus
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { HistorySourceUsed, ResolvedHistoryContext } from '$lib/server/connectors/context-history/types';

export type FooterChatRole = 'user' | 'assistant';

export type FooterChatMessage = {
	role: FooterChatRole;
	content: string;
};

export type FooterChatPresentationTarget = {
	targetId: string;
	targetType?: 'node' | 'material';
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
	entries: Record<string, string>;
};

export type FooterChatTrace = {
	route: 'presentation_restore' | 'direct_edit' | 'llm';
	semanticOverlayStatus: 'missing' | 'stale' | 'fresh' | 'unknown';
	toolCalls: string[];
	executedToolDomain?: 'presentation' | 'selection' | 'semantics' | 'assistant_ui';
	executedAction?: string;
	affectedTargetCount?: number;
	destructiveScope?: 'none' | 'group_delete' | 'overlay_delete' | 'broad_membership_mutation';
	approvalSummary?: string;
	sidebarAction: 'unchanged' | 'updated' | 'cleared';
	supplementaryListAction: 'unchanged' | 'updated' | 'cleared';
	historySourceUsed?: HistorySourceUsed;
	historyCompactionApplied?: boolean;
	plannerModel?: string;
	replyModel?: string;
	planningMode?: 'direct' | 'single_tool' | 'multi_tool' | 'clarification';
	toolRoundsUsed?: number;
	clarificationIssued?: boolean;
	composedToolChain?: boolean;
};

export type FooterChatRequest = {
	message: string;
	assetId?: VehicleAssetId;
	selectedGroupId?: string;
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
	selectedNodes?: VehicleNodeSelection[];
	presentation?: FooterChatPresentationContext;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
};

export type FooterChatExecutionContext = {
	userId?: string | null;
	resolvedHistoryContext?: ResolvedHistoryContext;
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
	semanticOverlayStatus?: VehicleSemanticOverlayStatus;
	semanticOverlay?: VehicleSemanticOverlay | null;
	selectedGroupId?: string | null;
	trace?: FooterChatTrace;
};

export type FooterChatAudioResponse = {
	transcript: string;
	audioBase64?: string;
	audioMimeType?: string;
	audioVoice?: string;
	chat: FooterChatResponse;
};

export type FooterChatAudioStreamEvent =
	| {
			type: 'started';
	  }
	| {
			type: 'transcribed';
			transcript: string;
	  }
	| {
			type: 'chat';
			chat: FooterChatResponse;
	  }
	| {
			type: 'audio';
			audioBase64: string;
			audioMimeType: string;
			audioVoice: string;
	  }
	| {
			type: 'complete';
	  }
	| {
			type: 'error';
			message: string;
	  };
