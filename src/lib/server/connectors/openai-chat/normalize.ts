import { isVehicleAssetId } from '$lib/vehicles/catalog';
import type {
	FooterChatPresentationContext,
	FooterChatPresentationTarget,
	FooterChatRequest,
	FooterChatSidebarCard,
	FooterChatSidebarState,
	FooterChatSupplementaryListState
} from './types';
import { OpenAIChatInputError } from './errors';
import type {
	NormalizedFooterChatRequest,
	NormalizeSupplementaryListStateFn,
	NormalizeSidebarCardFn,
	NormalizeSidebarStateFn
} from './internal';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';

export const normalizeSidebarCard: NormalizeSidebarCardFn = (input) => {
	if (!input || typeof input.title !== 'string') {
		return null;
	}

	const title = input.title.trim();
	if (!title) {
		return null;
	}

	const entries = Object.fromEntries(
		Object.entries(input.entries ?? {}).filter(([key, value]) => {
			const normalizedKey = key.trim();
			if (!normalizedKey) {
				return false;
			}

			return (
				typeof value === 'string' ||
				typeof value === 'number' ||
				typeof value === 'boolean' ||
				value === null
			);
		})
	);

	return { title, entries };
};

export const normalizeSidebarState: NormalizeSidebarStateFn = (input) => {
	if (!input) {
		return undefined;
	}

	return {
		active: input.active === true,
		cards: Array.isArray(input.cards)
			? input.cards
					.map((card) => normalizeSidebarCard(card))
					.filter((card): card is FooterChatSidebarCard => card !== null)
			: []
	};
};

export const normalizeSupplementaryListState: NormalizeSupplementaryListStateFn = (input) => {
	if (!input) {
		return undefined;
	}

	const entries = Object.fromEntries(
		Object.entries(input.entries ?? {})
			.map(([key, value]) => [
				typeof key === 'string' ? key.trim() : '',
				typeof value === 'string' ? value.trim() : ''
			])
			.filter(([key, value]) => key.length > 0 && value.length > 0)
			.slice(0, 6)
	);

	return {
		active: input.active === true,
		entries
	};
};

function normalizePresentationTarget(
	input: FooterChatPresentationTarget | null | undefined
): FooterChatPresentationTarget | null {
	if (!input || typeof input.targetId !== 'string') {
		return null;
	}

	const targetId = input.targetId.trim();
	if (!targetId) {
		return null;
	}

	return {
		targetId,
		targetType:
			input.targetType === 'node' || input.targetType === 'material'
				? input.targetType
				: undefined,
		targetName:
			typeof input.targetName === 'string' ? input.targetName.trim() || undefined : undefined,
		operation:
			typeof input.operation === 'string' && input.operation.trim().length > 0
				? input.operation
				: undefined
	};
}

function normalizePresentationContext(
	input: FooterChatPresentationContext | null | undefined
): FooterChatPresentationContext | undefined {
	if (!input) {
		return undefined;
	}

	const normalizeTargets = (
		targets: FooterChatPresentationContext['highlightedTargets']
	): FooterChatPresentationTarget[] | undefined => {
		const normalized = Array.isArray(targets)
			? targets
					.map((target) => normalizePresentationTarget(target))
					.filter((target): target is FooterChatPresentationTarget => target !== null)
			: [];

		return normalized.length > 0 ? normalized : undefined;
	};

	const viewerModes = Array.isArray(input.viewerModes)
		? input.viewerModes.filter(
				(
					mode
				): mode is NonNullable<FooterChatPresentationContext['viewerModes']>[number] =>
					mode === 'wireframe' ||
					mode === 'xray' ||
					mode === 'uv_debug' ||
					mode === 'postprocess'
		  )
		: [];

	const normalized: FooterChatPresentationContext = {
		activeIntentLabel:
			typeof input.activeIntentLabel === 'string'
				? input.activeIntentLabel.trim() || undefined
				: undefined,
		highlightedTargets: normalizeTargets(input.highlightedTargets),
		materialTargets: normalizeTargets(input.materialTargets),
		hiddenTargets: normalizeTargets(input.hiddenTargets),
		viewerModes: viewerModes.length > 0 ? viewerModes : undefined
	};

	if (
		!normalized.activeIntentLabel &&
		!normalized.highlightedTargets &&
		!normalized.materialTargets &&
		!normalized.hiddenTargets &&
		!normalized.viewerModes
	) {
		return undefined;
	}

	return normalized;
}

export function normalizeRequest(input: FooterChatRequest): NormalizedFooterChatRequest {
	const message = input.message.trim();

	if (!message) {
		throw new OpenAIChatInputError('Message is required.');
	}

	return {
		message,
		assetId: input.assetId && isVehicleAssetId(input.assetId) ? input.assetId : undefined,
		selectedNodeId:
			typeof input.selectedNodeId === 'string'
				? input.selectedNodeId.trim() || undefined
				: undefined,
		selectedNodeName:
			typeof input.selectedNodeName === 'string'
				? input.selectedNodeName.trim() || undefined
				: undefined,
		selectedNodePath:
			typeof input.selectedNodePath === 'string'
				? input.selectedNodePath.trim() || undefined
				: undefined,
		selectedNodes: Array.isArray(input.selectedNodes)
			? input.selectedNodes.filter(
					(entry): entry is VehicleNodeSelection =>
						!!entry &&
						typeof entry.assetId === 'string' &&
						typeof entry.nodeId === 'string' &&
						typeof entry.nodeName === 'string' &&
						typeof entry.nodePath === 'string'
			  )
			: [],
		presentation: normalizePresentationContext(input.presentation),
		sidebar: normalizeSidebarState(input.sidebar),
		supplementaryList: normalizeSupplementaryListState(input.supplementaryList)
	};
}

export function describePresentationTargets(
	label: string,
	targets: FooterChatPresentationTarget[] | undefined
): string | null {
	if (!targets || targets.length === 0) {
		return null;
	}

	return `${label}: ${targets
		.map(
			(target) =>
				`${target.targetType ? `${target.targetType} ` : ''}${target.targetId}${target.targetName ? ` (${target.targetName})` : ''}${target.operation ? ` via ${target.operation}` : ''}`
		)
		.join('; ')}.`;
}
