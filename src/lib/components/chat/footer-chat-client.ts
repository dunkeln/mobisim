import { get } from 'svelte/store';
import { toast } from '$lib/components/ui/sonner';
import {
	buildPresentationRestoreFromContext,
	summarizeRestoreInstruction
} from '$lib/contracts/footer-chat-restore';
import { inspectorSidebarState } from '$lib/stores/inspector-sidebar';
import { footerActiveTool } from '$lib/stores/footer-active-tool';
import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
import { vehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import { vehiclePatchState } from '$lib/stores/vehicle-patches';
import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
import type {
	FooterChatMessage as ChatMessage,
	FooterChatPresentationContext,
	FooterChatSidebarState,
	FooterChatSupplementaryListState,
	FooterChatPresentationTarget,
	FooterChatResponse as ChatResponse,
	FooterChatViewerMode
} from '$lib/server/connectors/openai-chat/types';
import type { VehicleSemanticOverlaySnapshot } from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

type ChatErrorResponse = {
	error?: string;
};

export function isChatResponse(
	payload: ChatResponse | ChatErrorResponse
): payload is ChatResponse {
	return 'message' in payload && 'model' in payload;
}

export function isUndoRequest(content: string): boolean {
	return /\b(undo|revert|go back|step back)\b/i.test(content.trim());
}

export function isRedoRequest(content: string): boolean {
	return /\b(redo|reapply|do that again)\b/i.test(content.trim());
}

export function isResetRequest(content: string): boolean {
	return /^(reset|reset (the )?(car|vehicle|view|changes)|undo all(?: changes| edits| operations)?|revert all(?: changes| edits| operations)?|reset everything|revert everything|undo everything|clear changes|start over)$/i.test(
		content.trim()
	);
}

export function isClearHighlightRequest(content: string): boolean {
	return /^(clear|remove|undo|reset) (the )?(highlight|highlights)$/i.test(content.trim());
}

function describeIntentLabel(label: string | null | undefined, fallback: string): string {
	const normalized = label?.trim();
	return normalized && normalized.length > 0 ? normalized : fallback;
}

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

export function handleLocalChatCommand(content: string, assetId?: VehicleAssetId): boolean {
	if (isResetRequest(content)) {
		const didReset = vehiclePatchState.reset(assetId);
		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: didReset
				? 'Reset the vehicle to its original GLB state.'
				: 'There are no vehicle changes to reset.'
		};
		toast.success(didReset ? 'Vehicle reset' : 'Nothing to reset', {
			description: assistantMessage.content
		});
		return true;
	}

	const selectiveUndoQuery = vehiclePatchState.extractSelectiveUndoQuery(content);
	if (selectiveUndoQuery) {
		const revertedLabel = vehiclePatchState.undoMatching(assetId, selectiveUndoQuery);
		toast.success(revertedLabel ? 'Undo applied' : 'Nothing matched', {
			description: revertedLabel
				? `Undid ${revertedLabel}.`
				: `No active change matched "${selectiveUndoQuery}".`
		});
		return true;
	}

	if (isUndoRequest(content)) {
		const previousState = get(vehiclePatchState);
		const didUndo = vehiclePatchState.undo(assetId);
		const nextState = get(vehiclePatchState);
		const undoneLabel = describeIntentLabel(previousState.intentLabel, 'the last vehicle change');
		const restoredLabel = describeIntentLabel(nextState.intentLabel, 'the previous vehicle state');
		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: didUndo
				? `Undid ${undoneLabel} and restored ${restoredLabel}.`
				: 'There is no vehicle change to undo.'
		};
		toast.success(didUndo ? 'Undo applied' : 'Nothing to undo', {
			description: assistantMessage.content
		});
		return true;
	}

	if (isRedoRequest(content)) {
		const previousState = get(vehiclePatchState);
		const didRedo = vehiclePatchState.redo(assetId);
		const nextState = get(vehiclePatchState);
		const redoneLabel = describeIntentLabel(
			nextState.intentLabel,
			previousState.intentLabel ?? 'the last undone change'
		);
		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: didRedo ? `Reapplied ${redoneLabel}.` : 'There is no vehicle change to redo.'
		};
		toast.success(didRedo ? 'Redo applied' : 'Nothing to redo', {
			description: assistantMessage.content
		});
		return true;
	}

	if (isClearHighlightRequest(content)) {
		const didClear = vehiclePatchState.apply(assetId, {
			kind: 'clear_highlights',
			intentLabel: 'clear highlights'
		});
		const assistantMessage: ChatMessage = {
			role: 'assistant',
			content: didClear
				? 'Cleared the active highlight overlays.'
				: 'There are no highlight overlays to clear.'
		};
		toast.success(didClear ? 'Highlights cleared' : 'No highlights to clear', {
			description: assistantMessage.content
		});
		return true;
	}

	const presentationRestore = buildPresentationRestoreFromContext(
		content,
		getPresentationContext(assetId)
	);
	if (presentationRestore) {
		const didRestore = vehiclePatchState.apply(assetId, {
			kind: 'restore',
			intentLabel: presentationRestore.label?.trim() || 'restore original view',
			restore: presentationRestore
		});
		toast.success(didRestore ? 'Restore applied' : 'Nothing to restore', {
			description: didRestore
				? summarizeRestoreInstruction(presentationRestore)
				: 'No active presentation matched the restore request.'
		});
		return true;
	}

	return false;
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
