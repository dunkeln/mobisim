import type { VehiclePartIntentMode } from './types';

export function shouldHighlightPart(request: string): boolean {
	return /\b(highlight|call out|focus on|focus|mark|spotlight|isolate|show only|only show|show just|just show|show me just|keep only|only keep|concentrate on|emphasize|point out|zoom to|zoom in on|select|selected|pick out|pick|choose|remove|strip out|take out|pull out|bring out|expand out|separate out)\b/i.test(
		request
	);
}

export function shouldTintWindows(request: string): boolean {
	return /\b(tint|smoke|chrome tint|window tint|windows|glass|windshield)\b/i.test(request);
}

export function shouldPaintBody(request: string): boolean {
	return /\b(paint|repaint|body color|body paint|color the body|change the color|make it)\b/i.test(
		request
	);
}

export function isLightingGlowRequest(request: string): boolean {
	return (
		/\b(headlight|headlights|taillight|taillights|rear light|rear lights|brake light|brake lights|front light|front lights|light|lights)\b/i.test(
			request
		) &&
		/\b(turn on|turn off|on|off|enable|enabled|disable|disabled|glow|glowing|lit|light up|without|remove|plain)\b/i.test(
			request
		)
	);
}

export function isVehicleEditRequest(request: string): boolean {
	return (
		shouldHighlightPart(request) ||
		shouldTintWindows(request) ||
		shouldPaintBody(request) ||
		isLightingGlowRequest(request) ||
		/\b(wireframe|xray|x-ray|uv|uvs|uv debug|uv_debug|postprocess|post-processing)\b/i.test(request)
	);
}

export function extractHighlightQuery(request: string): string {
	return request
		.replace(
			/\b(highlight|call out|focus on|focus|mark|spotlight|isolate|show only|only show|show just|just show|show me just|keep only|only keep|concentrate on|emphasize|point out|zoom to|zoom in on|select|selected|pick out|pick|choose|remove|strip out|take out|pull out|bring out|expand out|separate out)\b/gi,
			' '
		)
		.replace(/\b(the|a|an|please|just|me|car|vehicle|part|parts)\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function normalizePartQuery(request: string): string {
	const normalized = extractHighlightQuery(request);
	return normalized || request.trim();
}

export function requestNeedsHighlightedIntersection(request: string): boolean {
	return /\bhighlighted\b/i.test(request);
}

export function requestPreservesCurrentPaint(request: string): boolean {
	return /\bpreserve current paint|keep current paint|do not change (?:the )?paint\b/i.test(request);
}

export function inferPartIntentMode(request: string): VehiclePartIntentMode {
	if (/\b(remove|removed|strip out|take out|pull out|bring out|expand out|separate out)\b/i.test(request)) {
		return 'remove';
	}

	if (/\b(isolate|show only|only show|show just|just show|show me just|keep only|only keep|concentrate on)\b/i.test(request)) {
		return 'isolate';
	}

	if (/\b(focus on|focus)\b/i.test(request)) {
		return 'focus';
	}

	return 'highlight';
}

export function isDisableRequest(request: string): boolean {
	return /\b(off|disable|disabled|without|hide|remove|plain)\b/i.test(request);
}
