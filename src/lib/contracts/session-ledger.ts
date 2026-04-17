import type {
	FooterChatPresentationContext,
	FooterChatSidebarState,
	FooterChatSupplementaryListState
} from '$lib/server/connectors/openai-chat/types';
import type { VehicleSemanticOverlayStatus } from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type SessionLedgerSelection = {
	assetId: VehicleAssetId;
	targetType?: 'part' | 'node';
	targetId?: string;
	targetName?: string;
	nodeIds?: string[];
	anchorNodeId?: string;
	nodeId: string;
	nodeName: string;
	nodePath: string;
	materialName?: string;
	materialIndex?: number;
};

export type SessionLedger = {
	assetId: VehicleAssetId;
	structuralGeneratedAt?: string;
	semanticOverlayStatus?: VehicleSemanticOverlayStatus;
	semanticOverlayRevision?: number | null;
	selectedGroupId?: string | null;
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
	selectedNodes?: SessionLedgerSelection[];
	presentation?: FooterChatPresentationContext;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
	contextKey: string;
};

function normalizeString(value: string | null | undefined): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: number | null | undefined): number | null | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : value === null ? null : undefined;
}

function normalizeSelection(selection: SessionLedgerSelection): SessionLedgerSelection {
	return {
		assetId: selection.assetId,
		targetType: selection.targetType,
		targetId: normalizeString(selection.targetId),
		targetName: normalizeString(selection.targetName),
		nodeIds: selection.nodeIds ? [...selection.nodeIds].filter((entry) => !!normalizeString(entry)) : undefined,
		anchorNodeId: normalizeString(selection.anchorNodeId),
		nodeId: selection.nodeId,
		nodeName: selection.nodeName,
		nodePath: selection.nodePath,
		materialName: normalizeString(selection.materialName),
		materialIndex: normalizeNumber(selection.materialIndex)
	};
}

function normalizeTargets(
	targets:
		| FooterChatPresentationContext['highlightedTargets']
		| FooterChatPresentationContext['materialTargets']
		| FooterChatPresentationContext['hiddenTargets']
		| undefined
): Array<{
	targetId: string;
	targetType?: 'node' | 'material';
	targetName?: string;
	operation?: string;
}> | undefined {
	if (!targets || targets.length === 0) {
		return undefined;
	}

	return targets
		.map((target) => ({
			targetId: normalizeString(target.targetId) ?? target.targetId,
			targetType: target.targetType,
			targetName: normalizeString(target.targetName),
			operation: normalizeString(target.operation)
		}))
		.sort((left, right) =>
			`${left.targetType ?? ''}:${left.targetId}:${left.operation ?? ''}`.localeCompare(
				`${right.targetType ?? ''}:${right.targetId}:${right.operation ?? ''}`
			)
		);
}

function normalizePresentation(presentation: FooterChatPresentationContext | undefined) {
	if (!presentation) {
		return undefined;
	}

	const viewerModes = presentation.viewerModes ? [...presentation.viewerModes].sort() : undefined;
	const normalized = {
		activeIntentLabel: normalizeString(presentation.activeIntentLabel),
		highlightedTargets: normalizeTargets(presentation.highlightedTargets),
		materialTargets: normalizeTargets(presentation.materialTargets),
		hiddenTargets: normalizeTargets(presentation.hiddenTargets),
		viewerModes
	};

	return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function normalizeSidebar(sidebar: FooterChatSidebarState | undefined) {
	if (!sidebar) {
		return undefined;
	}

	const cards = sidebar.cards
		.map((card) => ({
			title: normalizeString(card.title) ?? card.title,
			entries: Object.fromEntries(
				Object.entries(card.entries)
					.map(([key, value]) => [normalizeString(key) ?? key, value] as const)
					.filter(([key]) => key.length > 0)
					.sort(([left], [right]) => left.localeCompare(right))
			)
		}))
		.sort((left, right) => left.title.localeCompare(right.title));

	return sidebar.active || cards.length > 0 ? { active: sidebar.active, cards } : undefined;
}

function normalizeSupplementaryList(
	supplementaryList: FooterChatSupplementaryListState | undefined
) {
	if (!supplementaryList) {
		return undefined;
	}

	const entries = Object.fromEntries(
		Object.entries(supplementaryList.entries)
			.map(([key, value]) => [normalizeString(key) ?? key, normalizeString(value) ?? value] as const)
			.filter(([key, value]) => key.length > 0 && value.length > 0)
			.sort(([left], [right]) => left.localeCompare(right))
	);

	return supplementaryList.active || Object.keys(entries).length > 0
		? { active: supplementaryList.active, entries }
		: undefined;
}

export function buildSessionLedger(input: Omit<SessionLedger, 'contextKey'>): SessionLedger {
	const normalized = {
		assetId: input.assetId,
		structuralGeneratedAt: normalizeString(input.structuralGeneratedAt),
		semanticOverlayStatus: input.semanticOverlayStatus ?? 'unknown',
		semanticOverlayRevision: normalizeNumber(input.semanticOverlayRevision) ?? null,
		selectedGroupId: normalizeString(input.selectedGroupId),
		selectedNodeId: normalizeString(input.selectedNodeId),
		selectedNodeName: normalizeString(input.selectedNodeName),
		selectedNodePath: normalizeString(input.selectedNodePath),
		selectedNodes: (input.selectedNodes ?? [])
			.map((selection) => normalizeSelection(selection))
			.sort((left, right) => {
				const leftKey = `${left.targetType ?? ''}:${left.targetId ?? left.nodeId}:${left.nodePath}`;
				const rightKey = `${right.targetType ?? ''}:${right.targetId ?? right.nodeId}:${right.nodePath}`;
				return leftKey.localeCompare(rightKey);
			}),
		presentation: normalizePresentation(input.presentation),
		sidebar: normalizeSidebar(input.sidebar),
		supplementaryList: normalizeSupplementaryList(input.supplementaryList)
	};
	const coreNormalized = {
		assetId: normalized.assetId,
		structuralGeneratedAt: normalized.structuralGeneratedAt,
		semanticOverlayStatus: normalized.semanticOverlayStatus,
		semanticOverlayRevision: normalized.semanticOverlayRevision,
		selectedGroupId: normalized.selectedGroupId,
		selectedNodeId: normalized.selectedNodeId,
		selectedNodeName: normalized.selectedNodeName,
		selectedNodePath: normalized.selectedNodePath,
		selectedNodes: normalized.selectedNodes,
		presentation: normalized.presentation
	};

	return {
		...normalized,
		contextKey: JSON.stringify(coreNormalized)
	};
}
