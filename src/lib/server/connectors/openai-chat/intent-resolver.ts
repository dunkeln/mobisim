import type { NormalizedFooterChatRequest } from './internal';
import { isVehicleEditRequest } from '$lib/server/connectors/vehicle-intents';

export type FooterChatIntentDomain =
	| 'presentation'
	| 'semantics'
	| 'selection'
	| 'viewer'
	| 'inspection'
	| 'mixed'
	| 'unknown';

export type FooterChatIntentOperation =
	| 'appearance'
	| 'focus'
	| 'restore'
	| 'assign'
	| 'reassign'
	| 'unassign'
	| 'create_group'
	| 'refresh'
	| 'expand_selection'
	| 'inspect'
	| 'summarize'
	| 'unknown';

export type FooterChatIntentReferent =
	| 'selected'
	| 'highlighted'
	| 'pronoun'
	| 'named'
	| 'asset'
	| 'unknown';

export type FooterChatIntentTargetScope = 'node' | 'material' | 'mixed' | 'unknown';

export type FooterChatIntentOutputMode = 'spoken' | 'supplementary' | 'sidebar' | 'both' | 'unknown';

export type FooterChatIntentDraft = {
	domain: FooterChatIntentDomain;
	operation: FooterChatIntentOperation;
	referent: FooterChatIntentReferent;
	targetScope: FooterChatIntentTargetScope;
	outputMode: FooterChatIntentOutputMode;
	confidence: number;
	reasons: string[];
};

function hasScopedSelection(input: NormalizedFooterChatRequest): boolean {
	return input.selectedNodes.some((entry) => entry.assetId === input.assetId);
}

function hasMaterialScopedSelection(input: NormalizedFooterChatRequest): boolean {
	return input.selectedNodes.some(
		(entry) =>
			entry.assetId === input.assetId &&
			(typeof entry.materialIndex === 'number' || !!entry.materialName)
	);
}

function hasHighlightedTargets(input: NormalizedFooterChatRequest): boolean {
	return (input.presentation?.highlightedTargets?.length ?? 0) > 0;
}

function getHighlightedTargetKinds(
	input: NormalizedFooterChatRequest
): Set<'node' | 'material'> {
	return new Set(
		(input.presentation?.highlightedTargets ?? [])
			.map((target) => target.targetType)
			.filter((value): value is 'node' | 'material' => value === 'node' || value === 'material')
	);
}

function mentionsSemanticFamilyName(message: string): boolean {
	return /\b(group|semantic|classification|category|belongs?|wheels?|doors?|glasshouse|glass|windows?|body(?: shell)?|front face|trim|interior|headlights?|taillights?|front lighting|rear lighting)\b/i.test(
		message
	);
}

function mentionsSemanticGroupCreation(message: string): boolean {
	return (
		/\b(create|make|turn|promote|lift|group)\b.*\b(new\s+)?(semantic\s+group|group)\b/i.test(
			message
		) ||
		/\b(new\s+semantic\s+group|semantic\s+group\s+from\s+selection|group\s+this\s+selection|group\s+this\s+target|make\s+this\s+a\s+group|turn\s+this\s+into\s+a\s+group)\b/i.test(
			message
		)
	);
}

function mentionsExplicitSemanticMembership(message: string): boolean {
	return (
		/\bsemantic\b/i.test(message) ||
		/\b(group|classification|category|membership)\b/i.test(message) ||
		/\bbelongs?\s+(to|in)\b/i.test(message) ||
		/\b(member|members)\b/i.test(message)
	);
}

function mentionsVisualEditVerb(message: string): boolean {
	return /\b(highlight|isolate|focus|call out|mark visually|remove|hide|strip out|take out|pull out)\b/i.test(
		message
	);
}

function mentionsViewSurface(message: string): boolean {
	return /\b(view|viewport|scene|screen|display|canvas|frame|framing|render)\b/i.test(message);
}

function mentionsSelectionReferent(message: string): boolean {
	return /\b(this|these|it|that|them|selected(?:\s+nodes?)?|selection|selections|current selection|selected node|selected material)\b/i.test(
		message
	);
}

function inferOperation(message: string): FooterChatIntentOperation {
	if (/\b(refresh|rebuild|regenerate|reanaly[sz]e|enrich)\b.*\b(semantic|semantics|overlay|labels?)\b/i.test(message)) {
		return 'refresh';
	}

	if (mentionsSemanticGroupCreation(message)) {
		return 'create_group';
	}

	if (/\b(expand|extend|promote|lift)\b.*\b(selection|selected|this|these)\b/i.test(message)) {
		return 'expand_selection';
	}

	if (
		/\b(reassign|move)\b/i.test(message) &&
		(/\bto\b/i.test(message) || /\bgroup\b/i.test(message))
	) {
		return 'reassign';
	}

	if (
		/\b(unassign|remove|clear|take|pull)\b/i.test(message) &&
		(/\b(from|out of|off)\b/i.test(message) ||
			/\bgroup|semantic|classification|category|belongs?\b/i.test(message) ||
			/\bshould not be\b/i.test(message) ||
			/\bis not\b/i.test(message))
	) {
		return 'unassign';
	}

	if (
		/\b(assign|classify|mark|add)\b/i.test(message) ||
		/\b(put|place)\b/i.test(message) ||
		/\b(move)\b(?=.*\b(into|in)\b)/i.test(message) ||
		/\bbelongs to\b/i.test(message) ||
		/\b(in|into)\s+(the\s+)?(group|category)\b/i.test(message) ||
		/\bshould be\b/i.test(message)
	) {
		return 'assign';
	}

	if (/\b(summarize|summary|what changed|status|options|capabilities|available tools|what can you do)\b/i.test(message)) {
		return 'summarize';
	}

	if (
		/\b(unhighlight|clear highlights|restore|reset view|return .* normal|disable .*?(wireframe|xray|uv|postprocess))\b/i.test(
			message
		)
	) {
		return 'restore';
	}

	if (/\b(highlight|isolate|focus|call out|mark visually)\b/i.test(message)) {
		return 'focus';
	}

	if (/\b(paint|repaint|recolor|color|tint|darken|lighten|chrome|matte|metallic|pearl|gloss)\b/i.test(message)) {
		return 'appearance';
	}

	if (/\b(what|show|get|inspect|which)\b/i.test(message)) {
		return 'inspect';
	}

	return 'unknown';
}

function inferReferent(input: NormalizedFooterChatRequest, message: string): FooterChatIntentReferent {
	if (/\b(highlighted|glowing|hidden|current highlight)\b/i.test(message)) {
		return 'highlighted';
	}

	if (mentionsSelectionReferent(message)) {
		if (hasScopedSelection(input)) {
			return 'selected';
		}

		if (hasHighlightedTargets(input)) {
			return 'highlighted';
		}

		return 'pronoun';
	}

	if (/\b(node-\d+|material-\S+)\b/i.test(message)) {
		return 'named';
	}

	if (/\b(body|car|vehicle|whole car|whole vehicle|entire car|entire vehicle|all\b|everything\b)\b/i.test(message)) {
		return 'asset';
	}

	return 'unknown';
}

function inferTargetScope(
	input: NormalizedFooterChatRequest,
	message: string
): FooterChatIntentTargetScope {
	if (/\bwhole mixed|mixed group membership|whole group membership|both node and material\b/i.test(message)) {
		return 'mixed';
	}

	if (/\bnode\b|node-\d+\b/i.test(message)) {
		return 'node';
	}

	if (/\bmaterial\b|\bregion\b|\bsurface\b|\bpaint\b/i.test(message)) {
		return 'material';
	}

	const highlightedTargetKinds = getHighlightedTargetKinds(input);
	if (highlightedTargetKinds.has('node') && highlightedTargetKinds.has('material')) {
		return 'unknown';
	}

	if (highlightedTargetKinds.has('node')) {
		return 'node';
	}

	if (highlightedTargetKinds.has('material')) {
		return 'material';
	}

	if (hasMaterialScopedSelection(input)) {
		return 'unknown';
	}

	if (hasScopedSelection(input)) {
		return 'node';
	}

	return 'unknown';
}

function inferOutputMode(message: string): FooterChatIntentOutputMode {
	const wantsSupplementary = /\b(footer|supplementary|list|options|tool list|changed targets|what changed|status)\b/i.test(
		message
	);
	const wantsSidebar = /\b(sidebar|card)\b/i.test(message);

	if (wantsSupplementary && wantsSidebar) {
		return 'both';
	}
	if (wantsSupplementary) {
		return 'supplementary';
	}
	if (wantsSidebar) {
		return 'sidebar';
	}
	return 'spoken';
}

function scoreDomains(
	input: NormalizedFooterChatRequest,
	message: string,
	operation: FooterChatIntentOperation,
	referent: FooterChatIntentReferent
) {
	const scores: Record<FooterChatIntentDomain, number> = {
		presentation: 0,
		semantics: 0,
		selection: 0,
		viewer: 0,
		inspection: 0,
		mixed: 0,
		unknown: 0
	};
	const reasons: string[] = [];

	if (mentionsExplicitSemanticMembership(message)) {
		scores.semantics += 3;
		reasons.push('explicit semantic membership language is present');
	}
	if (operation === 'create_group') {
		scores.semantics += 3;
		reasons.push('semantic group creation language is present');
	}
	if (operation === 'assign' || operation === 'reassign' || operation === 'unassign' || operation === 'refresh') {
		scores.semantics += 3;
		reasons.push(`operation suggests ${operation} in semantics`);
	}
	if (
		(referent === 'selected' || referent === 'pronoun') &&
		hasScopedSelection(input) &&
		mentionsExplicitSemanticMembership(message)
	) {
		scores.semantics += 2;
		reasons.push('selection context strengthens semantic mutation');
	}
	if (mentionsSemanticFamilyName(message) && (operation === 'assign' || operation === 'reassign' || operation === 'unassign')) {
		scores.semantics += 1;
		reasons.push('named semantic family aligns with semantic mutation');
	}

	if (operation === 'expand_selection') {
		scores.selection += 6;
		reasons.push('selection expansion language is present');
	}

	if (/\b(wireframe|xray|x-ray|uv|uv_debug|postprocess)\b/i.test(message)) {
		scores.viewer += 3;
		reasons.push('viewer mode language is present');
	}

	if (operation === 'appearance' || operation === 'focus' || operation === 'restore') {
		scores.presentation += 3;
		reasons.push(`operation suggests ${operation} in presentation`);
	}
	if (
		isVehicleEditRequest(message) &&
		(!mentionsExplicitSemanticMembership(message) || operation === 'appearance' || operation === 'focus' || operation === 'restore')
	) {
		scores.presentation += 2;
		reasons.push('vehicle edit language favors presentation');
	}
	if (
		mentionsVisualEditVerb(message) &&
		mentionsSemanticFamilyName(message) &&
		!mentionsExplicitSemanticMembership(message)
	) {
		scores.presentation += 3;
		reasons.push('visual edit verb against a named family favors presentation over semantic membership');
	}
	if (
		hasScopedSelection(input) &&
		mentionsVisualEditVerb(message) &&
		mentionsViewSurface(message) &&
		!mentionsExplicitSemanticMembership(message)
	) {
		scores.presentation += 4;
		reasons.push('selection-backed view removal favors presentation over semantic membership');
	}

	if (/\b(what tools are available|available tools|what can you do|capabilities)\b/i.test(message)) {
		scores.inspection += 4;
		reasons.push('capability inspection language is present');
	}
	if (operation === 'summarize' || operation === 'inspect') {
		scores.inspection += 2;
		reasons.push(`operation suggests ${operation}`);
	}

	if (scores.semantics > 0 && scores.presentation > 0) {
		scores.mixed += 1;
	}

	return { scores, reasons };
}

export function resolveIntentDraft(input: NormalizedFooterChatRequest): FooterChatIntentDraft {
	const message = input.message;
	const operation = inferOperation(message);
	const referent = inferReferent(input, message);
	const targetScope = inferTargetScope(input, message);
	const outputMode = inferOutputMode(message);
	const { scores, reasons } = scoreDomains(input, message, operation, referent);

	const ranked = Object.entries(scores)
		.sort((left, right) => right[1] - left[1])
		.map(([domain, score]) => ({ domain: domain as FooterChatIntentDomain, score }));
	const top = ranked[0] ?? { domain: 'unknown' as const, score: 0 };
	const next = ranked[1] ?? { domain: 'unknown' as const, score: 0 };
	const confidence = Math.max(
		0,
		Math.min(1, top.score === 0 ? 0 : 0.45 + Math.min(0.45, (top.score - next.score) * 0.12))
	);

	return {
		domain: top.score === 0 ? 'unknown' : top.domain,
		operation,
		referent,
		targetScope,
		outputMode,
		confidence,
		reasons
	};
}

export function describeIntentDraft(draft: FooterChatIntentDraft): string {
	const reasons = draft.reasons.slice(0, 3).join('; ');
	return `Intent draft: domain=${draft.domain}; operation=${draft.operation}; referent=${draft.referent}; targetScope=${draft.targetScope}; outputMode=${draft.outputMode}; confidence=${draft.confidence.toFixed(
		2
	)}.${reasons ? ` Signals: ${reasons}.` : ''}`;
}
