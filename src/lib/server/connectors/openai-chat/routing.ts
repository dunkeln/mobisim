import type { ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';
import { isVehicleEditRequest } from '$lib/server/connectors/vehicle-intents';
import {
	EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
	EDIT_VEHICLE_SELECTION_TOOL_NAME,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
} from './internal';
import type {
	FooterChatExecutionRoute,
	NormalizedFooterChatRequest
} from './internal';
import { resolveIntentDraft, type FooterChatIntentDraft } from './intent-resolver';

function isToolCatalogRequest(message: string): boolean {
	return /\b(what tools are available|available tools|show (?:me )?(?:the )?tools|what can you do here|what can i do here|capabilities)\b/i.test(
		message
	);
}

function needsToolPlanningFirst(message: string): boolean {
	// Only gate to the tool catalog when the user explicitly asks for help deciding
	// what to do — not for compound action requests like "paint red and then highlight
	// the wheels", which are fully deterministic and should execute directly.
	return /\b(walk me through|talk me through|figure out|decide|choose|plan|best way)\b/i.test(message);
}

function wantsStructuredAssistantUi(message: string): boolean {
	return /\b(footer|supplementary|sidebar|list|status|options|changed targets|what changed)\b/i.test(
		message
	);
}

function wantsStructuredUiForAction(
	message: string,
	intentDraft: FooterChatIntentDraft
): boolean {
	return (
		wantsStructuredAssistantUi(message) &&
		(intentDraft.operation === 'appearance' ||
			intentDraft.operation === 'focus' ||
			intentDraft.operation === 'restore' ||
			isVehicleEditRequest(message))
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
	const intentDraft = resolveIntentDraft(input);
	const scopedSelections = input.selectedNodes.filter((entry) => entry.assetId === input.assetId);
	if (!input.assetId || scopedSelections.length === 0) {
		return false;
	}

	if (
		intentDraft.domain === 'semantics' ||
		intentDraft.domain === 'selection' ||
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
	const intentDraft = resolveIntentDraft(input);
	if (
		!input.assetId ||
		intentDraft.domain === 'semantics' ||
		intentDraft.domain === 'selection' ||
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
	input: NormalizedFooterChatRequest
): FooterChatExecutionRoute {
	if (
		/\b(unhighlight|clear\b.*\bhighlights?|restore|reset view|return .* normal|disable .*?(wireframe|xray|uv|postprocess)|remove\b.*\bhighlights?)\b/i.test(
			input.message
		)
	) {
		return 'presentation_restore';
	}

	if (shouldAttemptDirectSelectionEdit(input) || shouldAttemptDirectVehicleEdit(input)) {
		return 'direct_edit';
	}

	return 'llm';
}

export function getToolChoiceForRequest(
	input: NormalizedFooterChatRequest
): ChatCompletionToolChoiceOption | undefined {
	const intentDraft = resolveIntentDraft(input);
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

	if (
		intentDraft.domain === 'semantics' &&
		(intentDraft.operation === 'assign' ||
			intentDraft.operation === 'reassign' ||
			intentDraft.operation === 'unassign' ||
			intentDraft.operation === 'refresh')
	) {
		return {
			type: 'function',
			function: {
				name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME
			}
		};
	}

	if (intentDraft.domain === 'selection' && intentDraft.operation === 'expand_selection') {
		return {
			type: 'function',
			function: {
				name: EDIT_VEHICLE_SELECTION_TOOL_NAME
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

	if (
		wantsStructuredUiForAction(input.message, intentDraft) &&
		(intentDraft.domain === 'presentation' ||
			intentDraft.domain === 'semantics' ||
			intentDraft.domain === 'inspection')
	) {
		return {
			type: 'function',
			function: {
				name: GET_VEHICLE_TOOL_CATALOG_TOOL_NAME
			}
		};
	}

	return undefined;
}
