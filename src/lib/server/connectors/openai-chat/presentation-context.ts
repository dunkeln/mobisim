import type {
	FooterChatHistoryAction,
	FooterChatPresentationContext,
	FooterChatPresentationRestore,
	FooterChatVehiclePatchOperation
} from './types';

type PresentationTarget = NonNullable<FooterChatPresentationContext['highlightedTargets']>[number];

function upsertTarget(
	targets: PresentationTarget[] | undefined,
	target: PresentationTarget
): PresentationTarget[] {
	const next = [...(targets ?? [])];
	const index = next.findIndex((entry) => entry.targetId === target.targetId);
	if (index >= 0) {
		next[index] = {
			...next[index],
			...target
		};
		return next;
	}

	next.push(target);
	return next;
}

function removeTarget(
	targets: PresentationTarget[] | undefined,
	targetId: string
): PresentationTarget[] | undefined {
	const next = (targets ?? []).filter((target) => target.targetId !== targetId);
	return next.length > 0 ? next : undefined;
}

export function applyOperationsToPresentationContext(
	basePresentation: FooterChatPresentationContext | undefined,
	operations: FooterChatVehiclePatchOperation[],
	intentLabel?: string
): FooterChatPresentationContext | undefined {
	let next: FooterChatPresentationContext = {
		activeIntentLabel: intentLabel ?? basePresentation?.activeIntentLabel,
		highlightedTargets: basePresentation?.highlightedTargets,
		materialTargets: basePresentation?.materialTargets,
		hiddenTargets: basePresentation?.hiddenTargets,
		viewerModes: basePresentation?.viewerModes
	};

	for (const operation of operations) {
		if (operation.op === 'set_overlay_highlight') {
			if (operation.value === false) {
				next.highlightedTargets = removeTarget(next.highlightedTargets, operation.targetId);
				continue;
			}

			next.highlightedTargets = upsertTarget(next.highlightedTargets, {
				targetId: operation.targetId,
				targetType:
					operation.targetType === 'node' || operation.targetType === 'material'
						? operation.targetType
						: undefined,
				targetName: operation.targetName
			});
			continue;
		}

		if (operation.targetType === 'material') {
			next.materialTargets = upsertTarget(next.materialTargets, {
				targetId: operation.targetId,
				targetType: 'material',
				targetName: operation.targetName,
				operation: operation.op
			});
			continue;
		}

		if (operation.targetType === 'node' && operation.op === 'set_visibility') {
			if (operation.value === false) {
				next.hiddenTargets = upsertTarget(next.hiddenTargets, {
					targetId: operation.targetId,
					targetType: 'node',
					targetName: operation.targetName
				});
			} else {
				next.hiddenTargets = removeTarget(next.hiddenTargets, operation.targetId);
			}
			continue;
		}

		if (operation.targetType === 'viewer' && operation.op === 'set_enabled') {
			const mode =
				operation.targetId === 'wireframe' ||
				operation.targetId === 'xray' ||
				operation.targetId === 'uv_debug' ||
				operation.targetId === 'postprocess'
					? operation.targetId
					: null;

			if (!mode) {
				continue;
			}

			if (operation.value === true) {
				next.viewerModes = Array.from(new Set([...(next.viewerModes ?? []), mode]));
			} else {
				const remaining = (next.viewerModes ?? []).filter((entry) => entry !== mode);
				next.viewerModes = remaining.length > 0 ? remaining : undefined;
			}
		}
	}

	if (
		!next.activeIntentLabel &&
		(next.highlightedTargets?.length ?? 0) === 0 &&
		(next.materialTargets?.length ?? 0) === 0 &&
		(next.hiddenTargets?.length ?? 0) === 0 &&
		(next.viewerModes?.length ?? 0) === 0
	) {
		return undefined;
	}

	return next;
}

export function applyPresentationRestoreToContext(
	presentation: FooterChatPresentationContext | undefined,
	restore: FooterChatPresentationRestore | undefined
): FooterChatPresentationContext | undefined {
	if (!presentation || !restore) {
		return presentation;
	}

	if (restore.restoreAll) {
		return undefined;
	}

	const next: FooterChatPresentationContext = {
		...presentation,
		highlightedTargets: restore.highlightedTargetIds
			? (presentation.highlightedTargets ?? []).filter(
					(target) => !restore.highlightedTargetIds?.includes(target.targetId)
			  )
			: presentation.highlightedTargets,
		materialTargets: restore.materialTargetIds
			? (presentation.materialTargets ?? []).filter(
					(target) => !restore.materialTargetIds?.includes(target.targetId)
			  )
			: presentation.materialTargets,
		hiddenTargets: restore.hiddenTargetIds
			? (presentation.hiddenTargets ?? []).filter(
					(target) => !restore.hiddenTargetIds?.includes(target.targetId)
			  )
			: presentation.hiddenTargets,
		viewerModes: restore.viewerModes
			? (presentation.viewerModes ?? []).filter((mode) => !restore.viewerModes?.includes(mode))
			: presentation.viewerModes
	};

	if (
		!next.activeIntentLabel &&
		(next.highlightedTargets?.length ?? 0) === 0 &&
		(next.materialTargets?.length ?? 0) === 0 &&
		(next.hiddenTargets?.length ?? 0) === 0 &&
		(next.viewerModes?.length ?? 0) === 0
	) {
		return undefined;
	}

	return next;
}

export function applyHistoryActionToPresentationContext(
	presentation: FooterChatPresentationContext | undefined,
	historyAction: FooterChatHistoryAction
): FooterChatPresentationContext | undefined {
	if (historyAction === 'reset') {
		return undefined;
	}

	if (historyAction === 'clear_highlights') {
		if (!presentation) {
			return presentation;
		}

		const next = {
			...presentation,
			highlightedTargets: undefined
		};

		if (
			!next.activeIntentLabel &&
			(next.materialTargets?.length ?? 0) === 0 &&
			(next.hiddenTargets?.length ?? 0) === 0 &&
			(next.viewerModes?.length ?? 0) === 0
		) {
			return undefined;
		}

		return next;
	}

	return presentation;
}
