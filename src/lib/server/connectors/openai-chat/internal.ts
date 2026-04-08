import type { NormalizedVehiclePaintIntent } from '$lib/server/connectors/vehicle-intents';
import type {
	FooterChatPresentationContext,
	FooterChatPresentationRestore,
	FooterChatPresentationTarget,
	FooterChatRequest,
	FooterChatSidebarCard,
	FooterChatSidebarState,
	FooterChatSupplementaryListState,
	FooterChatTrace,
	FooterChatVehiclePatchOperation
} from './types';
import type {
	VehicleSemanticGroupAnnotation,
	VehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export const DEFAULT_MODEL = 'gpt-5.2';
export const MAX_TOOL_ROUNDS = 2;

export const APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME = 'apply_vehicle_appearance_intent';
export const APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME = 'apply_vehicle_focus_intent';
export const SET_VEHICLE_VIEW_MODE_TOOL_NAME = 'set_vehicle_view_mode';
export const GET_VEHICLE_TOOL_CATALOG_TOOL_NAME = 'get_vehicle_tool_catalog';
export const RESTORE_VEHICLE_PRESENTATION_TOOL_NAME = 'restore_vehicle_presentation';
export const EXPAND_VEHICLE_SELECTION_TOOL_NAME = 'expand_vehicle_selection';
export const ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME = 'annotate_vehicle_semantic_group';
export const MUTATE_VEHICLE_SEMANTIC_ASSIGNMENT_TOOL_NAME = 'mutate_vehicle_semantic_assignment';
export const REFRESH_VEHICLE_SEMANTICS_TOOL_NAME = 'refresh_vehicle_semantics';
export const SET_INTENT_SIDEBAR_TOOL_NAME = 'set_intent_sidebar';
export const SET_SUPPLEMENTARY_REFERENCE_LIST_TOOL_NAME = 'set_supplementary_reference_list';
export const ASSIGN_SEMANTIC_INGRESS_TOOL_NAME = 'assign_semantic_ingress';

export type NormalizedFooterChatRequest = {
	message: string;
	assetId?: VehicleAssetId;
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
	selectedNodes: VehicleNodeSelection[];
	presentation?: FooterChatPresentationContext;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
};

export type SemanticOverlayState = 'missing' | 'stale' | 'fresh' | 'unknown';

export type SemanticOverlayPromptContext = {
	status: SemanticOverlayState;
	overlay?: VehicleSemanticOverlay;
	sidebarCadence: 'stable' | 'caution' | 'summary';
};

export type FooterChatExecutionRoute = FooterChatTrace['route'];

export type ApplyVehicleAppearanceIntentToolArgs = Partial<NormalizedVehiclePaintIntent> & {
	request?: string;
	scope?: 'asset' | 'selection';
};

export type ApplyVehicleFocusIntentToolArgs = {
	request: string;
	scope?: 'asset' | 'selection';
};

export type SetVehicleViewModeToolArgs = {
	mode: 'wireframe' | 'xray' | 'uv_debug' | 'postprocess';
	enabled: boolean;
};

export type GetVehicleToolCatalogToolArgs = {
	goal?: string;
	includeExamples?: boolean;
};

export type RestoreVehiclePresentationToolArgs = {
	kind: 'highlights' | 'hidden' | 'viewer_modes' | 'materials' | 'all';
	scope?: 'all' | 'matching';
	query?: string;
};

export type ExpandVehicleSelectionToolArgs = {
	target: 'node' | 'part' | 'semantic_group';
	query?: string;
};

export type AnnotateVehicleSemanticGroupToolArgs = VehicleSemanticGroupAnnotation;

export type MutateVehicleSemanticAssignmentToolArgs = {
	action: 'assign' | 'reassign' | 'unassign';
	scope?: 'selected' | 'highlighted' | 'material_targets' | 'hidden';
	nodeIds?: string[];
	query?: string;
	semanticGroup?: string;
	category?: VehicleSemanticGroupAnnotation['category'];
	humanLabel?: string;
	aliases?: string[];
};

export type RefreshVehicleSemanticsToolArgs = {
	force?: boolean;
};

export type SetIntentSidebarToolArgs = {
	active: boolean;
	cards: FooterChatSidebarCard[];
};

export type SetSupplementaryReferenceListToolArgs = {
	active: boolean;
	items: string[];
};

export type AssignSemanticIngressToolArgs = {
	targetType: 'semantic_group' | 'semantic_node';
	targetId: string;
	targetLabel?: string;
	transport: 'rest_sse' | 'stream';
};

export type ExecutedToolResult = {
	message: ChatCompletionMessageParam;
	plannedOperations?: FooterChatVehiclePatchOperation[];
	intentLabel?: string;
	presentationRestore?: FooterChatPresentationRestore;
	selectionUpdate?: VehicleNodeSelection[];
	selectionUpdateLabel?: string;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
};

export type PromptBuilderInput = {
	input: NormalizedFooterChatRequest;
	semanticOverlay: SemanticOverlayPromptContext;
	describePresentationTargets: (
		label: string,
		targets: FooterChatPresentationTarget[] | undefined
	) => string | null;
};

export type NormalizeSidebarCardFn = (
	input: FooterChatSidebarCard | null | undefined
) => FooterChatSidebarCard | null;

export type NormalizeSidebarStateFn = (
	input: FooterChatSidebarState | null | undefined
) => FooterChatSidebarState | undefined;

export type NormalizeSupplementaryListStateFn = (
	input: FooterChatSupplementaryListState | null | undefined
) => FooterChatSupplementaryListState | undefined;

export type FooterChatPromptMessages = ChatCompletionMessageParam[];
