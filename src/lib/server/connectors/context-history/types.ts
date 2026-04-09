import type {
	FooterChatPresentationContext,
	FooterChatResponse,
	FooterChatSidebarState,
	FooterChatSupplementaryListState
} from '$lib/server/connectors/openai-chat/types';
import type { NormalizedFooterChatRequest } from '$lib/server/connectors/openai-chat/internal';
import type { VehicleSemanticOverlayStatus } from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type ContextHistoryStoreKind = 'dynamodb';

export type ContextHistoryConfig = {
	enabled: boolean;
	store: ContextHistoryStoreKind;
	region: string;
	tableName: string;
	endpoint?: string;
	eventTtlDays: number;
	tokenBudget: number;
	rawRetentionEnabled: boolean;
};

export type ContextHistorySelectionSummary = {
	nodeId: string;
	nodeName: string;
	nodePath: string;
	materialName?: string;
	materialIndex?: number;
};

export type UserAssetContextSnapshot = {
	userId: string;
	assetId: VehicleAssetId;
	selection: ContextHistorySelectionSummary[];
	presentation?: FooterChatPresentationContext;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
	semanticOverlayStatus?: VehicleSemanticOverlayStatus;
	semanticOverlayRevision?: number;
	recentAliases: string[];
	recentGoalSummary?: string;
	lastActionSummary?: string;
	updatedAt: string;
};

export type UserAssetContextEvent = {
	userId: string;
	assetId: VehicleAssetId;
	eventAt: string;
	messageSummary: string;
	resultSummary: string;
	semanticOverlayStatus?: VehicleSemanticOverlayStatus;
	semanticOverlayRevision?: number;
	selection: ContextHistorySelectionSummary[];
	presentation?: FooterChatPresentationContext;
	aliases: string[];
	rawUserMessage?: string;
};

export type UserGlobalContextSnapshot = {
	userId: string;
	recentAssetIds: VehicleAssetId[];
	stableAliases: string[];
	recentGoalSummaries: string[];
	workflowPreferences: string[];
	updatedAt: string;
};

export type HistorySourceUsed = 'current_asset' | 'user_global' | 'none';

export type ResolvedHistoryContext = {
	currentAssetSnapshot?: UserAssetContextSnapshot;
	currentAssetSummary?: string;
	userGlobalSummary?: string;
	historySourceOrder: string[];
	compactionApplied: boolean;
	sourceUsed: HistorySourceUsed;
};

export type ResolveContextHistoryInput = {
	userId?: string | null;
	assetId?: VehicleAssetId;
};

export type PersistContextHistoryInput = {
	userId?: string | null;
	request: NormalizedFooterChatRequest;
	response: FooterChatResponse;
	rawUserMessage?: string;
};

export type ContextHistoryReadPort = {
	getAssetSnapshot(userId: string, assetId: VehicleAssetId): Promise<UserAssetContextSnapshot | null>;
	listAssetEvents(userId: string, assetId: VehicleAssetId, limit: number): Promise<UserAssetContextEvent[]>;
	getUserGlobalSnapshot(userId: string): Promise<UserGlobalContextSnapshot | null>;
};

export type ContextHistoryWritePort = {
	putAssetSnapshot(snapshot: UserAssetContextSnapshot): Promise<void>;
	putAssetEvent(event: UserAssetContextEvent): Promise<void>;
	putUserGlobalSnapshot(snapshot: UserGlobalContextSnapshot): Promise<void>;
};

export type ContextHistoryPort = ContextHistoryReadPort & ContextHistoryWritePort;
