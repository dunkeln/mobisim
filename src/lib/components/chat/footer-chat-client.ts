import { get } from 'svelte/store';
import { inspectorSidebarState } from '$lib/stores/inspector-sidebar';
import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
import { vehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import { vehiclePatchState } from '$lib/stores/vehicle-patches';
import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
import { requestGate } from '$lib/stores/request-gate';
import { summarizeRestoreInstruction } from '$lib/contracts/footer-chat-restore';
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
import type { VehiclePresentationState } from '$lib/stores/vehicle-patches';

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

export function getAppliedChatResponseMessage(payload: ChatResponse): string {
	if (payload.historyAction === 'reset') {
		return 'All active drift was cleared back to the original GLB state.';
	}

	if (payload.historyAction === 'clear_highlights') {
		return 'Active highlight overlays were cleared.';
	}

	if (payload.historyAction === 'redo') {
		return 'The most recent reverted change was reapplied.';
	}

	if (payload.historyAction === 'undo') {
		return 'The most recent change was reverted.';
	}

	if (payload.presentationRestore) {
		return summarizeRestoreInstruction(payload.presentationRestore);
	}

	return payload.message.content;
}

function summarizeVerifiedRestore(input: {
	before: VehiclePresentationState;
	restore: NonNullable<ChatResponse['presentationRestore']>;
}): string {
	if (input.restore.restoreAll) {
		return input.before.materialOperations.some(
			(operation) =>
				operation.op === 'set_base_color_factor' ||
				operation.op === 'set_metalness_factor' ||
				operation.op === 'set_roughness_factor' ||
				operation.op === 'set_env_map_intensity'
		)
			? 'Restored the vehicle to its original view while preserving paint and finish edits.'
			: 'Restored the vehicle to its original rendered state.';
	}

	const beforeHighlightedIds = new Set(
		input.before.highlightOperations.map((operation) => operation.targetId)
	);
	const beforeMaterialIds = new Set(
		input.before.materialOperations.map((operation) => operation.targetId)
	);
	const beforeHiddenIds = new Set(
		input.before.nodeVisibilityOperations.map((operation) => operation.targetId)
	);
	const beforeViewerModes = new Set(
		input.before.viewerOperations
			.filter(
				(operation) =>
					operation.op === 'set_enabled' &&
					operation.value === true &&
					(operation.targetId === 'wireframe' ||
						operation.targetId === 'xray' ||
						operation.targetId === 'uv_debug' ||
						operation.targetId === 'postprocess')
			)
			.map((operation) => operation.targetId)
	);

	const restored = {
		highlightedTargetIds: (input.restore.highlightedTargetIds ?? []).filter((targetId) =>
			beforeHighlightedIds.has(targetId)
		),
		hiddenTargetIds: (input.restore.hiddenTargetIds ?? []).filter((targetId) =>
			beforeHiddenIds.has(targetId)
		),
		materialTargetIds: (input.restore.materialTargetIds ?? []).filter((targetId) =>
			beforeMaterialIds.has(targetId)
		),
		viewerModes: (input.restore.viewerModes ?? []).filter((mode) => beforeViewerModes.has(mode)),
		label: input.restore.label
	};

	return summarizeRestoreInstruction(restored);
}

function appendViewerModeNote(
	message: string,
	presentation: VehiclePresentationState | undefined
): string {
	if (!presentation) {
		return message;
	}

	const activeViewerModes = presentation.viewerOperations
		.filter(
			(operation) =>
				operation.op === 'set_enabled' &&
				operation.value === true &&
				(operation.targetId === 'wireframe' ||
					operation.targetId === 'xray' ||
					operation.targetId === 'uv_debug' ||
					operation.targetId === 'postprocess')
		)
		.map((operation) => operation.targetId);

	if (activeViewerModes.length === 0) {
		return message;
	}

	const labels = activeViewerModes.map((mode) =>
		mode === 'uv_debug' ? 'UV debug' : mode === 'postprocess' ? 'postprocess' : mode
	);
	const viewerSummary =
		labels.length === 1
			? labels[0]
			: labels.length === 2
				? `${labels[0]} and ${labels[1]}`
				: `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;

	return `${message} ${viewerSummary} view remains active.`;
}

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
		(operation) =>
			(operation.op === 'set_visibility' && operation.value === false) ||
			// set_alpha ops from remove/isolate should also appear as restorable hidden
			// targets so the model can see and restore them the same way it restores
			// explicitly hidden nodes.
			(operation.op === 'set_alpha' && typeof operation.value === 'number' && (operation.value as number) < 1)
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
	const currentSelection = selectedNodes[selectedNodes.length - 1];

	return {
		assetId,
		selectedNodeId: currentSelection?.nodeId,
		selectedNodeName: currentSelection
			? currentSelection.targetType === 'part'
				? `${currentSelection.targetName ?? currentSelection.nodeName} part`
				: currentSelection.nodeName
			: undefined,
		selectedNodePath: currentSelection?.nodePath,
		selectedNodes
	};
}

export function getSelectedSemanticGroupContext(assetId?: VehicleAssetId): {
	selectedGroupId?: string;
} {
	if (!assetId) {
		return {};
	}

	const runtimeState = semanticRuntimeState.getAssetState(assetId);
	return runtimeState.selectedGroupId ? { selectedGroupId: runtimeState.selectedGroupId } : {};
}

export function getSidebarContext(
	assetId: VehicleAssetId,
	contextKey: string
): FooterChatSidebarState {
	return inspectorSidebarState.getContext(assetId, contextKey);
}

export function getSupplementaryListContext(
	assetId: VehicleAssetId,
	contextKey: string
): FooterChatSupplementaryListState {
	return footerSupplementaryList.getContext(assetId, contextKey);
}

export function beginFooterResponseCycle(assetId?: VehicleAssetId): void {
	if (assetId) {
		footerSupplementaryList.reset(assetId);
	}
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

function buildSemanticMutationRequestVariable(payload: ChatResponse): string | null {
	const trace = payload.trace;
	if (!trace || trace.executedToolDomain !== 'semantics') {
		return null;
	}

	if (trace.destructiveScope === 'overlay_delete') {
		return trace.approvalSummary?.trim() || 'Delete semantic overlay for this asset?';
	}

	if (trace.destructiveScope === 'group_delete') {
		return trace.approvalSummary?.trim() || 'Delete semantic group?';
	}

	if (trace.destructiveScope === 'broad_membership_mutation') {
		if (typeof trace.approvalSummary === 'string' && trace.approvalSummary.trim().length > 0) {
			return trace.approvalSummary;
		}
		if (typeof trace.affectedTargetCount === 'number' && trace.affectedTargetCount > 0) {
			return `Apply semantic reassignment across ${trace.affectedTargetCount} targets?`;
		}
		return 'Apply semantic reassignment?';
	}

	return null;
}

export async function approveSemanticMutation(payload: ChatResponse): Promise<AppLayerApprovalResult> {
	const requestVariable = buildSemanticMutationRequestVariable(payload);
	if (!requestVariable) {
		return { approved: true };
	}

	try {
		const approved = await requestApproval(requestVariable);
		return approved
			? { approved: true }
			: {
					approved: false,
					blockedMessage: 'Approval declined. No changes were applied.'
				};
	} catch {
		return {
			approved: false,
			blockedMessage: 'Approval declined. No changes were applied.'
		};
	}
}

export async function approveChatResponseApplication(
	payload: ChatResponse
): Promise<AppLayerApprovalResult> {
	const bulkApproval = await approveBulkApplication(payload);
	if (!bulkApproval.approved) {
		return bulkApproval;
	}

	return approveSemanticMutation(payload);
}

export function applyChatResponse(
	payload: ChatResponse,
	assetId?: VehicleAssetId,
	contextKey?: string
): string {
	const beforePatchState = get(vehiclePatchState);
	const beforePresentation =
		beforePatchState.assetId === assetId ? beforePatchState.presentation : undefined;
	const semanticTargetAssetId = payload.semanticOverlay?.assetId ?? assetId;
	const selectedGroupPatch =
		payload.selectedGroupId !== undefined ? { selectedGroupId: payload.selectedGroupId } : {};
	if (semanticTargetAssetId && payload.semanticOverlay !== undefined) {
		// Only update the overlay store when a semantic tool explicitly returned an overlay.
		// semanticOverlayStatus is present on every response (including pure presentation
		// requests), so gating on that alone would wipe the store on every non-semantic call.
		const snapshot: VehicleSemanticOverlaySnapshot = {
			overlay: payload.semanticOverlay ?? null,
			overlayRevision: payload.semanticOverlay?.revision ?? null,
			overlayStatus: payload.semanticOverlayStatus ?? (payload.semanticOverlay ? 'fresh' : 'unknown')
		};
		semanticRuntimeState.applyAssetState(semanticTargetAssetId, {
			overlaySnapshot: snapshot,
			...selectedGroupPatch
		});
	} else if (assetId && payload.selectedGroupId !== undefined) {
		semanticRuntimeState.applyAssetState(assetId, selectedGroupPatch);
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

		if (assetId) {
			semanticRuntimeState.applyAssetState(assetId, {
				selectedGroupId: null
			});
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

		if (
			assetId &&
			(payload.presentationRestore.restoreAll === true ||
				(payload.presentationRestore.highlightedTargetIds?.length ?? 0) > 0 ||
				(payload.presentationRestore.hiddenTargetIds?.length ?? 0) > 0)
		) {
			const afterPatchState = get(vehiclePatchState);
			if (
				afterPatchState.assetId === assetId &&
				afterPatchState.presentation.highlightOperations.length === 0 &&
				afterPatchState.presentation.nodeVisibilityOperations.length === 0
			) {
				semanticRuntimeState.applyAssetState(assetId, {
					selectedGroupId: null
				});
			}
		}
	}

	if (payload.selectionUpdate?.mode === 'replace') {
		if (!assetId) {
			throw new Error('No active vehicle asset is available for selection updates.');
		}

		vehicleNodeSelection.replace(assetId, payload.selectionUpdate.selectedNodes);
	}

	if (payload.sidebar && assetId) {
		if (!contextKey) {
			throw new Error('Missing session ledger key for sidebar state.');
		}
		inspectorSidebarState.set(assetId, payload.sidebar, contextKey);
	}

	if (assetId && payload.supplementaryList) {
		if (!contextKey) {
			throw new Error('Missing session ledger key for supplementary list state.');
		}
		footerSupplementaryList.set(assetId, payload.supplementaryList, contextKey);
	} else if (assetId) {
		footerSupplementaryList.reset(assetId);
	}

	if (payload.presentationRestore && beforePresentation) {
		return appendViewerModeNote(
			summarizeVerifiedRestore({
				before: beforePresentation,
				restore: payload.presentationRestore
			}),
			get(vehiclePatchState).assetId === assetId ? get(vehiclePatchState).presentation : beforePresentation
		);
	}

	if (payload.historyAction === 'clear_highlights' && beforePresentation) {
		return appendViewerModeNote(
			summarizeRestoreInstruction({
				highlightedTargetIds: beforePresentation.highlightOperations.map(
					(operation) => operation.targetId
				),
				label: 'clear highlights'
			}),
			get(vehiclePatchState).assetId === assetId ? get(vehiclePatchState).presentation : beforePresentation
		);
	}

	return getAppliedChatResponseMessage(payload);
}
