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
	VehicleSemanticOverlay,
	VehicleSemanticActionSupport
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { SceneDag } from '$lib/server/scene-dag/types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ResolvedHistoryContext } from '$lib/server/connectors/context-history/types';

export const DEFAULT_MODEL = 'gpt-5.2';
export const MAX_TOOL_ROUNDS = 3;

export const GET_VEHICLE_TOOL_CATALOG_TOOL_NAME = 'get_vehicle_tool_catalog';
export const EDIT_VEHICLE_PRESENTATION_TOOL_NAME = 'edit_vehicle_presentation';
export const EDIT_VEHICLE_SELECTION_TOOL_NAME = 'edit_vehicle_selection';
export const EDIT_VEHICLE_SEMANTICS_TOOL_NAME = 'edit_vehicle_semantics';
export const SET_ASSISTANT_UI_TOOL_NAME = 'set_assistant_ui';

export type NormalizedFooterChatRequest = {
	message: string;
	assetId?: VehicleAssetId;
	selectedGroupId?: string;
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

export type SetOperationMode = 'replace' | 'add' | 'subtract' | 'intersect' | 'union';

export type ApplyVehicleFocusIntentToolArgs = {
	request: string;
	scope?: 'asset' | 'selection';
	setOperation?: SetOperationMode;
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
	setOperation?: SetOperationMode;
};

export type ExpandVehicleSelectionToolArgs = {
	target: 'node' | 'part' | 'semantic_group';
	query?: string;
};

export type MutateVehicleSemanticAssignmentToolArgs = {
	action: 'assign' | 'reassign' | 'unassign';
	scope?: 'selected' | 'highlighted' | 'material_targets' | 'hidden';
	targetScope?: 'node' | 'material' | 'mixed';
	nodeIds?: string[];
	materialIds?: string[];
	query?: string;
	semanticGroup?: string;
	category?: VehicleSemanticGroupAnnotation['category'];
	humanLabel?: string;
	aliases?: string[];
	setOperation?: SetOperationMode;
};

export type ManageVehicleSemanticGroupToolArgs = {
	action: 'create' | 'patch' | 'delete' | 'get';
	scope?: 'selected' | 'highlighted' | 'hidden';
	query?: string;
	semanticGroup?: string;
	groupId?: string;
	nodeIds?: string[];
	humanLabel?: string;
	aliases?: string[];
	category?: VehicleSemanticGroupAnnotation['category'];
	supports?: VehicleSemanticActionSupport[];
	assignmentMode?: 'exclusive' | 'overlay';
	exclusiveFamily?: string | null;
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
	entries: Record<string, string>;
};

export type EditVehiclePresentationToolArgs =
	| ({
			action: 'appearance';
	  } & ApplyVehicleAppearanceIntentToolArgs)
	| ({
			action: 'focus';
	  } & ApplyVehicleFocusIntentToolArgs)
	| ({
			action: 'restore';
	  } & RestoreVehiclePresentationToolArgs)
	| ({
			action: 'view_mode';
	  } & SetVehicleViewModeToolArgs);

export type EditVehicleSelectionToolArgs = {
	action: 'expand';
	target: ExpandVehicleSelectionToolArgs['target'];
	query?: string;
};

export type SetAssistantUiToolArgs =
	| ({
			action: 'sidebar';
	  } & SetIntentSidebarToolArgs)
	| ({
			action: 'supplementary_list';
	  } & SetSupplementaryReferenceListToolArgs);

export type ExecutedToolResult = {
	message: ChatCompletionMessageParam;
	plannedOperations?: FooterChatVehiclePatchOperation[];
	intentLabel?: string;
	presentationRestore?: FooterChatPresentationRestore;
	selectionUpdate?: VehicleNodeSelection[];
	selectionUpdateLabel?: string;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
	semanticOverlay?: VehicleSemanticOverlay | null;
	sceneDag?: SceneDag | null;
	selectedGroupId?: string | null;
	trace?: Pick<
		FooterChatTrace,
		'executedToolDomain' | 'executedAction' | 'affectedTargetCount' | 'destructiveScope' | 'approvalSummary'
	>;
};

export type PromptBuilderInput = {
	input: NormalizedFooterChatRequest;
	semanticOverlay: SemanticOverlayPromptContext;
	sceneDag: SceneDag | null;
	historyContext: ResolvedHistoryContext;
	policySummary: string;
	intentSummary: string;
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
