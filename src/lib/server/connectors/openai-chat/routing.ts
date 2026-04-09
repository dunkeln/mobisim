import type { ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';
import { isVehicleEditRequest } from '$lib/server/connectors/vehicle-intents';
import {
	EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
} from './internal';
import type {
	FooterChatExecutionRoute,
	NormalizedFooterChatRequest
} from './internal';

function isToolCatalogRequest(message: string): boolean {
	return /\b(what tools are available|available tools|show (?:me )?(?:the )?tools|what can you do here|what can i do here|capabilities)\b/i.test(
		message
	);
}

function needsToolPlanningFirst(message: string): boolean {
	return (
		/\b(and then|then|also|while|at the same time|along with|plus)\b/i.test(message) ||
		/\b(walk me through|talk me through|figure out|decide|choose|plan|best way)\b/i.test(message) ||
		/\b(summary|summarize|sidebar|footer|list)\b/i.test(message)
	);
}

export function isSemanticRefreshRequest(message: string): boolean {
	return /\b(refresh|rebuild|regenerate|reanaly[sz]e|enrich)\b.*\b(semantic|semantics|overlay|manifest|labels?)\b/i.test(
		message
	);
}

export function requestNeedsSemanticGrounding(message: string): boolean {
	return /\b(semantic|semantics|overlay|groups?|parts?|paint|repaint|body color|body paint|glass|window|tint|headlight|headlights|wheel|wheels|rim|rims|grille|highlight|isolate|spotlight)\b/i.test(
		message
	);
}

function isSelectionScopedLanguage(message: string): boolean {
	return /\b(this|these|selected|selection|current selection)\b/i.test(message);
}

function isSelectionScopedViewerModeRequest(message: string): boolean {
	return /\b(wireframe|xray|x-ray|uv|uv_debug|postprocess|post-processing|postprocessing)\b/i.test(
		message
	);
}

function isGlobalAssetTargetRequest(message: string): boolean {
	return /\b(body|car|vehicle|whole car|whole vehicle|entire car|entire vehicle|all\b|everything\b)\b/i.test(
		message
	);
}

function isTargetableSelectionEditRequest(message: string): boolean {
	return /\b(tint|glass|window|windshield|smoke|limo|highlight|isolate|remove|paint|repaint|recolor|color|darken|lighten|chrome|matte|metallic|pearl|gloss)\b/i.test(
		message
	);
}

export function isSemanticAnnotationRequest(message: string): boolean {
	return (
		/\b(belongs to|part of)\b/i.test(message) ||
		/\b(group|classify|mark|assign)\s+(this|these|them|selected(?:\s+nodes?)?|selection|current selection)\s+(as|to)\b/i.test(
			message
		) ||
		/\b(reassign|unassign|remove|clear|move)\b.*\b(group|semantic|classification|category|belongs?)\b/i.test(
			message
		) ||
		/\b(move|reassign)\b.*\bto\b/i.test(message) ||
		/^\s*(this|these|them|selected(?:\s+nodes?)?|selection|current selection)\s+(is|are|should be|should not be)\s+/i.test(message)
	);
}

export function isSelectionExpansionRequest(message: string): boolean {
	return /\b(expand|extend|promote|lift)\b.*\b(selection|selected|this|these)\b/i.test(message);
}

export function shouldAttemptDirectSelectionEdit(input: NormalizedFooterChatRequest): boolean {
	const scopedSelections = input.selectedNodes.filter((entry) => entry.assetId === input.assetId);
	if (!input.assetId || scopedSelections.length === 0) {
		return false;
	}

	if (
		!isVehicleEditRequest(input.message) ||
		isSemanticRefreshRequest(input.message) ||
		isSemanticAnnotationRequest(input.message) ||
		isSelectionScopedViewerModeRequest(input.message)
	) {
		return false;
	}

	if (isSelectionScopedLanguage(input.message)) {
		return true;
	}

	return (
		isTargetableSelectionEditRequest(input.message) && !isGlobalAssetTargetRequest(input.message)
	);
}

export function shouldAttemptDirectVehicleEdit(input: NormalizedFooterChatRequest): boolean {
	if (
		!input.assetId ||
		!isVehicleEditRequest(input.message) ||
		isSemanticRefreshRequest(input.message)
	) {
		return false;
	}

	if (isSemanticAnnotationRequest(input.message)) {
		return false;
	}

	return true;
}

export function classifyExecutionRoute(
	_input: NormalizedFooterChatRequest
): FooterChatExecutionRoute {
	return 'llm';
}

export function getToolChoiceForRequest(
	input: NormalizedFooterChatRequest
): ChatCompletionToolChoiceOption | undefined {
	if (isToolCatalogRequest(input.message)) {
		return {
			type: 'function',
			function: {
				name: GET_VEHICLE_TOOL_CATALOG_TOOL_NAME
			}
		};
	}

	if (isSemanticRefreshRequest(input.message)) {
		return {
			type: 'function',
			function: {
				name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME
			}
		};
	}

	if (needsToolPlanningFirst(input.message)) {
		return {
			type: 'function',
			function: {
				name: GET_VEHICLE_TOOL_CATALOG_TOOL_NAME
			}
		};
	}

	return undefined;
}
