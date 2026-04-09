import {
	EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
	EDIT_VEHICLE_SELECTION_TOOL_NAME,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
	type NormalizedFooterChatRequest
} from './internal';
import {
	isSemanticAnnotationRequest,
	isSemanticRefreshRequest,
	shouldAttemptDirectSelectionEdit,
	shouldAttemptDirectVehicleEdit
} from './routing';
import {
	resolveIntentDraft,
	type FooterChatIntentDraft
} from './intent-resolver';
import type { FooterChatTrace } from './types';
import type { ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';
import { isVehicleEditRequest } from '$lib/server/connectors/vehicle-intents';

export type FooterChatPlanningMode = 'direct' | 'single_tool' | 'multi_tool' | 'clarification';

export type FooterChatPolicy = {
	mode: FooterChatPlanningMode;
	toolChoice?: ChatCompletionToolChoiceOption;
	toolBudget: number;
	clarificationMessage?: string;
};

function isToolCatalogRequest(message: string): boolean {
	return /\b(what tools are available|available tools|show (?:me )?(?:the )?tools|what can you do here|what can i do here|capabilities)\b/i.test(
		message
	);
}

function needsToolPlanningFirst(message: string): boolean {
	return (
		/\b(and then|then|also|while|at the same time|along with|plus)\b/i.test(message) ||
		/\b(walk me through|talk me through|figure out|decide|choose|plan|best way)\b/i.test(message)
	);
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

function buildClarificationMessage(input: NormalizedFooterChatRequest): string | undefined {
	if (!isSemanticAnnotationRequest(input.message)) {
		return undefined;
	}

	if (/\b(whole|mixed)\b/i.test(input.message)) {
		return undefined;
	}

	const highlightedTargets = input.presentation?.highlightedTargets ?? [];
	const scopedSelections = input.selectedNodes.filter((entry) => entry.assetId === input.assetId);
	const highlightedKinds = new Set(
		highlightedTargets.map((target) => target.targetType).filter((value): value is 'node' | 'material' => !!value)
	);
	const selectionHasNode = scopedSelections.length > 0;
	const selectionHasMaterial = scopedSelections.some(
		(selection) => typeof selection.materialIndex === 'number' || !!selection.materialName
	);

	if (highlightedKinds.has('node') && highlightedKinds.has('material')) {
		return 'Do you want me to remove the node-backed member, the material-backed member, or the whole mixed group?';
	}

	if (selectionHasNode && selectionHasMaterial) {
		return 'Do you want me to change the whole node, the selected material region, or the whole mixed group?';
	}

	return undefined;
}

export function deriveFooterChatPolicy(
	input: NormalizedFooterChatRequest,
	defaultToolBudget: number,
	intentDraft: FooterChatIntentDraft = resolveIntentDraft(input)
): FooterChatPolicy {
	const clarificationMessage = buildClarificationMessage(input);
	if (clarificationMessage) {
		return {
			mode: 'clarification',
			toolBudget: 0,
			clarificationMessage
		};
	}

	if (
		intentDraft.domain === 'semantics' &&
		(intentDraft.operation === 'assign' ||
			intentDraft.operation === 'reassign' ||
			intentDraft.operation === 'unassign')
	) {
		if (intentDraft.referent === 'selected' || intentDraft.referent === 'highlighted') {
			return {
				mode: 'direct',
				toolBudget: defaultToolBudget
			};
		}

		if (intentDraft.outputMode === 'supplementary' || intentDraft.outputMode === 'both') {
			return {
				mode: 'multi_tool',
				toolBudget: defaultToolBudget,
				toolChoice: {
					type: 'function',
					function: {
						name: GET_VEHICLE_TOOL_CATALOG_TOOL_NAME
					}
				}
			};
		}

		return {
			mode: 'single_tool',
			toolBudget: defaultToolBudget,
			toolChoice: {
				type: 'function',
				function: {
					name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME
				}
			}
		};
	}

	if (intentDraft.domain === 'selection' && intentDraft.operation === 'expand_selection') {
		return {
			mode: 'single_tool',
			toolBudget: defaultToolBudget,
			toolChoice: {
				type: 'function',
				function: {
					name: EDIT_VEHICLE_SELECTION_TOOL_NAME
				}
			}
		};
	}

	if (isToolCatalogRequest(input.message) || needsToolPlanningFirst(input.message)) {
		return {
			mode: 'multi_tool',
			toolBudget: defaultToolBudget,
			toolChoice: {
				type: 'function',
				function: {
					name: GET_VEHICLE_TOOL_CATALOG_TOOL_NAME
				}
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
			mode: 'multi_tool',
			toolBudget: defaultToolBudget,
			toolChoice: {
				type: 'function',
				function: {
					name: GET_VEHICLE_TOOL_CATALOG_TOOL_NAME
				}
			}
		};
	}

	if (isSemanticRefreshRequest(input.message)) {
		return {
			mode: 'single_tool',
			toolBudget: defaultToolBudget,
			toolChoice: {
				type: 'function',
				function: {
					name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME
				}
			}
		};
	}

	if (shouldAttemptDirectSelectionEdit(input) || shouldAttemptDirectVehicleEdit(input)) {
		return {
			mode: 'direct',
			toolBudget: defaultToolBudget
		};
	}

	return {
		mode: 'single_tool',
		toolBudget: defaultToolBudget
	};
}

export function describeFooterChatPolicy(policy: FooterChatPolicy): string {
	if (policy.mode === 'clarification') {
		return 'Planning mode is clarification. Prefer a short disambiguation question before any mutation.';
	}

	if (policy.mode === 'direct') {
		return 'Planning mode is direct. Prefer the deterministic executor first when the request is simple and low ambiguity.';
	}

	if (policy.mode === 'multi_tool') {
		return 'Planning mode is multi_tool. Prefer inspect, then act, then present for compound requests.';
	}

	return 'Planning mode is single_tool. Prefer one clear domain action unless the turn proves it needs composition.';
}

export function deriveObservedPlanningMode(input: {
	policy: FooterChatPolicy;
	route: FooterChatTrace['route'];
	toolCallsUsed: string[];
	clarificationIssued: boolean;
}): FooterChatPlanningMode {
	if (input.clarificationIssued) {
		return 'clarification';
	}

	if (input.toolCallsUsed.length > 1) {
		return 'multi_tool';
	}

	if (input.policy.mode === 'multi_tool' && input.toolCallsUsed.length > 0) {
		return 'multi_tool';
	}

	if (input.route === 'direct_edit' || input.policy.mode === 'direct') {
		return 'direct';
	}

	return 'single_tool';
}
