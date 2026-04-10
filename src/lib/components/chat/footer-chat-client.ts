import { get } from 'svelte/store';
import { inspectorSidebarState } from '$lib/stores/inspector-sidebar';
import { footerActiveTool } from '$lib/stores/footer-active-tool';
import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
import { vehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import { vehiclePatchState } from '$lib/stores/vehicle-patches';
import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
import { requestGate } from '$lib/stores/request-gate';
import type {
	FooterChatPresentationContext,
	FooterChatSidebarState,
	FooterChatSupplementaryListState,
	FooterChatPresentationTarget,
	FooterChatResponse as ChatResponse,
	FooterChatViewerMode
} from '$lib/server/connectors/openai-chat/types';
import type {
	VehicleSemanticOverlaySnapshot,
	VehicleSemanticOverlayStatus
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

const BULK_MATERIAL_TARGET_THRESHOLD = 8;
const BULK_NODE_TARGET_THRESHOLD = 12;
const BULK_TOTAL_TARGET_THRESHOLD = 12;
const BULK_SELECTION_THRESHOLD = 12;
const SEMANTIC_BOOTSTRAP_REQUEST_PATTERN =
	/\b(semantic|semantics|overlay|group|grouping|highlight|isolate|paint|repaint|body color|body paint|glass|window|tint|headlight|headlights|taillight|taillights|wheel|wheels|rim|rims|door|doors|trim|interior|front face|body shell)\b/i;

type GateAwareFetch = typeof fetch;

export type AppLayerApprovalResult = {
	approved: boolean;
	blockedMessage?: string;
};

type SemanticOverlaySnapshotResponse = VehicleSemanticOverlaySnapshot & {
	commandStatus?: string;
	appliedCommand?: string;
};

function summarizeTargets(
	operations: VehicleInspectionPatchOperation[],
	includeOperation = false
): FooterChatPresentationTarget[] {
	const seenKeys: string[] = [];
	const targets: FooterChatPresentationTarget[] = [];

	for (const operation of operations) {
		const key = `${operation.targetType}:${operation.targetId}:${operation.op}`;
		if (seenKeys.includes(key)) {
			continue;
		}

		seenKeys.push(key);
		targets.push({
			targetId: operation.targetId,
			targetType:
				operation.targetType === 'node' || operation.targetType === 'material'
					? operation.targetType
					: undefined,
			targetName: operation.targetName,
			operation: includeOperation ? operation.op : undefined
		});
	}

	return targets;
}

export function getPresentationContext(
	assetId?: VehicleAssetId
): FooterChatPresentationContext | undefined {
	if (!assetId) {
		return undefined;
	}

	const patchState = get(vehiclePatchState);
	if (patchState.assetId !== assetId) {
		return undefined;
	}

	const viewerModes: FooterChatViewerMode[] = patchState.presentation.viewerOperations
		.filter(
			(operation) =>
				operation.op === 'set_enabled' &&
				operation.value === true &&
				(operation.targetId === 'wireframe' ||
					operation.targetId === 'xray' ||
					operation.targetId === 'uv_debug' ||
					operation.targetId === 'postprocess')
		)
		.map((operation) => operation.targetId as FooterChatViewerMode);

	const hiddenTargets = patchState.presentation.nodeVisibilityOperations.filter(
		(operation) => operation.op === 'set_visibility' && operation.value === false
	);

	const context: FooterChatPresentationContext = {
		activeIntentLabel: patchState.intentLabel ?? undefined,
		highlightedTargets: summarizeTargets(patchState.presentation.highlightOperations),
		materialTargets: summarizeTargets(patchState.presentation.materialOperations, true),
		hiddenTargets: summarizeTargets(hiddenTargets),
		viewerModes
	};

	if (
		!context.activeIntentLabel &&
		(context.highlightedTargets?.length ?? 0) === 0 &&
		(context.materialTargets?.length ?? 0) === 0 &&
		(context.hiddenTargets?.length ?? 0) === 0 &&
		(context.viewerModes?.length ?? 0) === 0
	) {
		return undefined;
	}

	return context;
}

export function getSelectedNodeContext(assetId?: VehicleAssetId) {
	const selectedNodes = get(vehicleNodeSelection).filter((selection) => selection.assetId === assetId);

	return {
		assetId,
		selectedNodeId: selectedNodes[0]?.nodeId,
		selectedNodeName: selectedNodes[0]?.nodeName,
		selectedNodePath: selectedNodes[0]?.nodePath,
		selectedNodes
	};
}

export function getSidebarContext(): FooterChatSidebarState {
	return inspectorSidebarState.getContext();
}

export function getSupplementaryListContext(): FooterChatSupplementaryListState {
	return footerSupplementaryList.getContext();
}

export function beginFooterResponseCycle(): void {
	footerActiveTool.reset();
	footerSupplementaryList.reset();
}

async function requestApproval(requestVariable: string): Promise<boolean> {
	try {
		return await requestGate.requestApproval({ requestVariable });
	} finally {
		requestGate.reset();
	}
}

function buildBulkRequestVariable(payload: ChatResponse): string | null {
	const operations = payload.vehiclePatchOperations ?? [];
	const materialTargetCount = new Set(
		operations
			.filter((operation) => operation.targetType === 'material')
			.map((operation) => operation.targetId)
	).size;
	const nodeTargetCount = new Set(
		operations
			.filter((operation) => operation.targetType === 'node')
			.map((operation) => operation.targetId)
	).size;
	const totalTargetCount = new Set(
		operations
			.filter(
				(operation) => operation.targetType === 'material' || operation.targetType === 'node'
			)
			.map((operation) => `${operation.targetType}:${operation.targetId}`)
	).size;
	const selectionTargetCount = payload.selectionUpdate?.selectedNodes.length ?? 0;

	const isBulkApply =
		materialTargetCount >= BULK_MATERIAL_TARGET_THRESHOLD ||
		nodeTargetCount >= BULK_NODE_TARGET_THRESHOLD ||
		totalTargetCount >= BULK_TOTAL_TARGET_THRESHOLD ||
		selectionTargetCount >= BULK_SELECTION_THRESHOLD;

	if (!isBulkApply) {
		return null;
	}

	if (selectionTargetCount >= BULK_SELECTION_THRESHOLD && totalTargetCount === 0) {
		return `Approve selection update for ${selectionTargetCount} nodes?`;
	}

	if (totalTargetCount > 0) {
		return `Approve changes across ${totalTargetCount} targets?`;
	}

	return 'Approve bulk request?';
}

export async function prepareSemanticBootstrapForRequest(
	message: string,
	assetId?: VehicleAssetId,
	fetchImpl: GateAwareFetch = fetch
): Promise<{ bootstrapApplied: boolean }> {
	if (!assetId || !SEMANTIC_BOOTSTRAP_REQUEST_PATTERN.test(message)) {
		return { bootstrapApplied: false };
	}

	const runtimeState = semanticRuntimeState.getAssetState(assetId);
	const overlayStatus: VehicleSemanticOverlayStatus = runtimeState.overlayStatus;
	if (overlayStatus !== 'missing' && overlayStatus !== 'stale') {
		return { bootstrapApplied: false };
	}

	const approved = await requestApproval(
		overlayStatus === 'stale'
			? 'Refresh semantic grouping before continuing?'
			: 'Create semantic grouping before continuing?'
	);
	if (!approved) {
		return { bootstrapApplied: false };
	}

	const response = await fetchImpl(`/api/vehicle-assets/${assetId}/semantic-overlay`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			force: overlayStatus === 'stale'
		})
	});
	const payload = (await response.json().catch(() => null)) as SemanticOverlaySnapshotResponse | null;

	if (!response.ok || !payload) {
		throw new Error(
			typeof payload === 'object' && payload && 'error' in payload && typeof payload.error === 'string'
				? payload.error
				: `Semantic grouping request failed with HTTP ${response.status}.`
		);
	}

	semanticRuntimeState.applyAssetState(assetId, {
		overlaySnapshot: {
			overlay: payload.overlay ?? null,
			overlayRevision: payload.overlayRevision ?? payload.overlay?.revision ?? null,
			overlayStatus: payload.overlayStatus
		}
	});

	return { bootstrapApplied: true };
}

export async function approveBulkApplication(payload: ChatResponse): Promise<AppLayerApprovalResult> {
	const requestVariable = buildBulkRequestVariable(payload);
	if (!requestVariable) {
		return { approved: true };
	}

	const approved = await requestApproval(requestVariable);
	return approved
		? { approved: true }
		: {
				approved: false,
				blockedMessage: 'Approval declined. No changes were applied.'
			};
}

export function applyChatResponse(payload: ChatResponse, assetId?: VehicleAssetId): void {
	footerActiveTool.setFromToolCalls(payload.trace?.toolCalls ?? []);

	const semanticTargetAssetId = payload.semanticOverlay?.assetId ?? assetId;
	if (
		semanticTargetAssetId &&
		(payload.semanticOverlay !== undefined || payload.semanticOverlayStatus !== undefined)
	) {
		const snapshot: VehicleSemanticOverlaySnapshot = {
			overlay: payload.semanticOverlay ?? null,
			overlayRevision: payload.semanticOverlay?.revision ?? null,
			overlayStatus: payload.semanticOverlayStatus ?? (payload.semanticOverlay ? 'fresh' : 'unknown')
		};
		semanticRuntimeState.applyAssetState(semanticTargetAssetId, {
			overlaySnapshot: snapshot,
			ingressBindings:
				assetId && semanticTargetAssetId === assetId ? payload.semanticIngressBindings : undefined
		});
	} else if (assetId && payload.semanticIngressBindings) {
		semanticRuntimeState.applyAssetState(assetId, {
			ingressBindings: payload.semanticIngressBindings
		});
	}

	if (payload.historyAction === 'undo') {
		if (!vehiclePatchState.undo(assetId)) {
			throw new Error('There is no vehicle change to undo.');
		}
	}

	if (payload.historyAction === 'redo') {
		if (!vehiclePatchState.redo(assetId)) {
			throw new Error('There is no vehicle change to redo.');
		}
	}

	if (payload.historyAction === 'reset') {
		if (!vehiclePatchState.reset(assetId)) {
			throw new Error('There are no vehicle changes to reset.');
		}
	}

	if (payload.historyAction === 'clear_highlights') {
		if (
			!vehiclePatchState.apply(assetId, {
				kind: 'clear_highlights',
				intentLabel: 'clear highlights'
			})
		) {
			throw new Error('There are no highlight overlays to clear.');
		}
	}

	if (payload.vehiclePatchOperations && payload.vehiclePatchOperations.length > 0) {
		const targetAssetId = payload.vehiclePatchAssetId;

		if (targetAssetId && targetAssetId === assetId) {
			vehiclePatchState.apply(targetAssetId, {
				kind: 'operations',
				intentLabel: payload.vehiclePatchLabel ?? payload.message.content,
				operations: payload.vehiclePatchOperations
			});
		} else {
			throw new Error('Chat returned patch operations for a different vehicle asset.');
		}
	}

	if (payload.presentationRestore) {
		const didRestore = vehiclePatchState.apply(assetId, {
			kind: 'restore',
			intentLabel: payload.presentationRestore.label?.trim() || 'restore original view',
			restore: payload.presentationRestore
		});
		if (!didRestore && !payload.vehiclePatchOperations?.length) {
			throw new Error('No active vehicle presentation matched the restore request.');
		}
	}

	if (payload.selectionUpdate?.mode === 'replace') {
		if (!assetId) {
			throw new Error('No active vehicle asset is available for selection updates.');
		}

		vehicleNodeSelection.replace(assetId, payload.selectionUpdate.selectedNodes);
	}

	if (payload.sidebar) {
		inspectorSidebarState.set(payload.sidebar);
	}

	if (payload.supplementaryList) {
		footerSupplementaryList.set(payload.supplementaryList);
	} else {
		footerSupplementaryList.reset();
	}
}
