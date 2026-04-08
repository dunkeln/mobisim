import type {
	FooterChatPresentationContext,
	FooterChatPresentationRestore,
	FooterChatPresentationTarget
} from '$lib/server/connectors/openai-chat/types';

export type FooterChatPresentationRestoreKind =
	| 'highlights'
	| 'hidden'
	| 'viewer_modes'
	| 'materials'
	| 'all';

export type FooterChatPresentationRestoreScope = 'all' | 'matching';

export function selectMatchingPresentationTargetIds(
	query: string,
	targets: FooterChatPresentationTarget[] | undefined
): string[] {
	return getMatchedTargetIdsForRestore(query, targets);
}

export function isRestoreRequest(message: string): boolean {
	return /\b(restore|revert|reset|bring\b.*\bback|put\b.*\bback|show\b.*\bagain|make (it )?normal again|back to normal|original view|default view|turn .* back on|unhighlight|dehighlight|clear\b.*\bhighlights?|remove\b.*\bhighlights?)\b/i.test(
		message
	);
}

export function isRestoreAllRequest(message: string): boolean {
	return /\b(restore everything|reset everything|reset all|revert all|make (it )?normal again|back to normal|restore the vehicle|restore the car|original view|default view)\b/i.test(
		message
	);
}

function normalizeRestoreTerms(message: string): string[] {
	return message
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 2);
}

function matchesRestoreTarget(message: string, target: FooterChatPresentationTarget): boolean {
	const haystack = `${target.targetId} ${target.targetName ?? ''}`.toLowerCase();
	const baseTerms = normalizeRestoreTerms(message);
	const terms = Array.from(
		new Set(
			baseTerms.flatMap((term) =>
				term.endsWith('s') && term.length > 3 ? [term, term.slice(0, -1)] : [term]
			)
		)
	);

	return terms.some((term) => haystack.includes(term));
}

function getMatchedTargetIdsForRestore(
	message: string,
	targets: FooterChatPresentationTarget[] | undefined
): string[] {
	if (!targets || targets.length === 0) {
		return [];
	}

	return targets
		.filter((target) => matchesRestoreTarget(message, target))
		.map((target) => target.targetId);
}

function getAllTargetIds(targets: FooterChatPresentationTarget[] | undefined): string[] {
	return (targets ?? []).map((target) => target.targetId);
}

function getMatchedViewerModesForRestore(
	message: string,
	viewerModes: NonNullable<FooterChatPresentationContext['viewerModes']> | undefined
): NonNullable<FooterChatPresentationContext['viewerModes']> {
	if (!viewerModes || viewerModes.length === 0) {
		return [];
	}

	const modeMatches = viewerModes.filter((mode) => {
		if (mode === 'uv_debug') {
			return /\buv\b|\buv debug\b|\buv_debug\b/i.test(message);
		}

		if (mode === 'postprocess') {
			return /\bpostprocess\b|\bpost-processing\b|\bpostprocessing\b/i.test(message);
		}

		return new RegExp(`\\b${mode === 'xray' ? 'xray|x-ray' : mode}\\b`, 'i').test(message);
	});
	return modeMatches;
}

function hasSpecificRestoreTargetTerms(
	message: string,
	genericTerms: string[]
): boolean {
	const generic = new Set(genericTerms);
	return normalizeRestoreTerms(message).some((term) => !generic.has(term));
}

export function buildPresentationRestoreFromContext(
	message: string,
	presentation: FooterChatPresentationContext | undefined
): FooterChatPresentationRestore | null {
	if (!presentation || !isRestoreRequest(message)) {
		return null;
	}

	if (isRestoreAllRequest(message)) {
		return {
			restoreAll: true,
			label: 'restore original view'
		};
	}

	const highlightRestoreRequested =
		/\b(highlight|highlights|highlighted|glow|glowing|unhighlight|dehighlight|clear\b.*\bhighlights?|remove\b.*\bhighlights?)\b/i.test(
			message
		);
	const highlightedMatches = highlightRestoreRequested
		? getMatchedTargetIdsForRestore(message, presentation.highlightedTargets)
		: [];
	const highlightedTargetIds = highlightRestoreRequested
		? highlightedMatches.length > 0 ||
			!hasSpecificRestoreTargetTerms(message, [
				'highlight',
				'highlights',
				'highlighted',
				'glow',
				'glowing',
				'unhighlight',
				'dehighlight',
				'clear',
				'remove',
				'the',
				'current',
				'active',
				'region',
				'regions',
				'overlay',
				'overlays',
				'view'
			])
			? highlightedMatches.length > 0
				? highlightedMatches
				: getAllTargetIds(presentation.highlightedTargets)
			: []
		: [];

	const hiddenRestoreRequested =
		/\b(bring\b.*\bback|put\b.*\bback|show\b.*\bagain|restore|reveal|unhide|removed|hidden)\b/i.test(
			message
		);
	const hiddenMatches = hiddenRestoreRequested
		? getMatchedTargetIdsForRestore(message, presentation.hiddenTargets)
		: [];
	const hiddenTargetIds = hiddenRestoreRequested
		? hiddenMatches.length > 0 ? hiddenMatches : []
		: [];

	const viewerRestoreRequested =
		/\b(xray|x-ray|wireframe|uv|uv debug|uv_debug|postprocess|post-processing|postprocessing|layer)\b/i.test(
			message
		);
	const viewerMatches = viewerRestoreRequested
		? getMatchedViewerModesForRestore(message, presentation.viewerModes)
		: [];
	const viewerModes = viewerRestoreRequested ? viewerMatches : [];

	const materialRestoreRequested =
		/\b(restore|revert|reset|bring\b.*\bback|put\b.*\bback|show\b.*\bagain|normal|default|original)\b/i.test(
			message
		) &&
		/\b(material|paint|tint|glass|window|body|shell|door|panel|bumper|grille|hood|bonnet|roof|mirror|wheel|wheels|rim|rims|headlight|headlights|taillight|taillights|trim|interior)\b/i.test(
			message
		);
	const materialMatches = materialRestoreRequested
		? getMatchedTargetIdsForRestore(message, presentation.materialTargets)
		: [];
	const materialTargetIds = materialRestoreRequested ? materialMatches : [];

	if (
		highlightedTargetIds.length === 0 &&
		hiddenTargetIds.length === 0 &&
		viewerModes.length === 0 &&
		materialTargetIds.length === 0
	) {
		return null;
	}

	return {
		highlightedTargetIds: highlightedTargetIds.length > 0 ? highlightedTargetIds : undefined,
		hiddenTargetIds: hiddenTargetIds.length > 0 ? hiddenTargetIds : undefined,
		viewerModes: viewerModes.length > 0 ? viewerModes : undefined,
		materialTargetIds: materialTargetIds.length > 0 ? materialTargetIds : undefined,
		label: 'restore original view'
	};
}

export function buildPresentationRestoreFromInstruction(
	args: {
		kind: FooterChatPresentationRestoreKind;
		scope?: FooterChatPresentationRestoreScope;
		query?: string;
	},
	presentation: FooterChatPresentationContext | undefined
): FooterChatPresentationRestore | null {
	if (!presentation) {
		return null;
	}

	if (args.kind === 'all') {
		return {
			restoreAll: true,
			label: 'restore original view'
		};
	}

	const scope = args.scope ?? 'all';
	const query = args.query?.trim();
	const useAllTargets = scope === 'all' || !query;

	const highlightedTargetIds =
		args.kind === 'highlights'
			? useAllTargets
				? (presentation.highlightedTargets ?? []).map((target) => target.targetId)
				: getMatchedTargetIdsForRestore(query, presentation.highlightedTargets)
			: [];
	const hiddenTargetIds =
		args.kind === 'hidden'
			? useAllTargets
				? (presentation.hiddenTargets ?? []).map((target) => target.targetId)
				: getMatchedTargetIdsForRestore(query, presentation.hiddenTargets)
			: [];
	const materialTargetIds =
		args.kind === 'materials'
			? useAllTargets
				? (presentation.materialTargets ?? []).map((target) => target.targetId)
				: getMatchedTargetIdsForRestore(query, presentation.materialTargets)
			: [];
	const viewerModes =
		args.kind === 'viewer_modes'
			? useAllTargets
				? (presentation.viewerModes ?? [])
				: getMatchedViewerModesForRestore(query, presentation.viewerModes)
			: [];

	if (
		highlightedTargetIds.length === 0 &&
		hiddenTargetIds.length === 0 &&
		materialTargetIds.length === 0 &&
		viewerModes.length === 0
	) {
		return null;
	}

	return {
		highlightedTargetIds: highlightedTargetIds.length > 0 ? highlightedTargetIds : undefined,
		hiddenTargetIds: hiddenTargetIds.length > 0 ? hiddenTargetIds : undefined,
		materialTargetIds: materialTargetIds.length > 0 ? materialTargetIds : undefined,
		viewerModes: viewerModes.length > 0 ? viewerModes : undefined,
		label: 'restore original view'
	};
}

export function summarizeRestoreInstruction(restore: FooterChatPresentationRestore): string {
	if (restore.restoreAll) {
		return 'Restored the vehicle to its original rendered state.';
	}

	const fragments: string[] = [];
	if (restore.viewerModes && restore.viewerModes.length > 0) {
		fragments.push(`disabled ${restore.viewerModes.join(', ')}`);
	}
	if (restore.hiddenTargetIds && restore.hiddenTargetIds.length > 0) {
		fragments.push(`restored ${restore.hiddenTargetIds.length} hidden node region(s)`);
	}
	if (restore.highlightedTargetIds && restore.highlightedTargetIds.length > 0) {
		fragments.push(`cleared ${restore.highlightedTargetIds.length} highlight region(s)`);
	}
	if (restore.materialTargetIds && restore.materialTargetIds.length > 0) {
		fragments.push(`restored ${restore.materialTargetIds.length} material region(s)`);
	}

	return fragments.length > 0
		? `${fragments[0]!.charAt(0).toUpperCase()}${fragments[0]!.slice(1)}${fragments.length > 1 ? ` and ${fragments.slice(1).join(', ')}` : ''}.`
		: 'Restored the current presentation to the original rendered state.';
}
