import OpenAI from 'openai';
import { buildPresentationRestoreFromContext, summarizeRestoreInstruction } from '$lib/contracts/footer-chat-restore';
import { getOpenAIChatClient } from './client';
import {
	OpenAIChatConfigError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from './errors';
import type { FooterChatRequest, FooterChatResponse } from './types';
import { classifyExecutionRoute, getToolChoiceForRequest } from './routing';
import {
	normalizeRequest,
	describePresentationTargets,
	normalizeSupplementaryListState
} from './normalize';
import { toOpenAIMessages } from './prompt';
import { CHAT_TOOLS } from './tool-definitions';
import { getToolModel } from './model-routing';
import { withActiveSpan } from '$lib/server/telemetry';
import {
	attemptDirectSemanticEdit,
	attemptDirectVehicleEdit,
	executeToolCall,
	mergePatchOperations,
	resolveSemanticOverlayPromptContext,
	resolveSidebarAction,
	resolveSupplementaryListAction
} from './execution';
import {
	MAX_TOOL_ROUNDS,
	type SemanticOverlayPromptContext,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME
} from './internal';
import {
	deriveFooterChatPolicy,
	deriveObservedPlanningMode,
	describeFooterChatPolicy
} from './policy';
import { describeIntentDraft, resolveIntentDraft } from './intent-resolver';
import type {
	FooterChatExecutionContext,
	FooterChatPresentationContext,
	FooterChatVehiclePatchOperation
} from './types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import {
	buildHistoryTrace,
	persistContextHistory,
	resolveContextHistory
} from '$lib/server/connectors/context-history';

export {
	OpenAIChatConfigError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from './errors';

function summarizeTargets(
	operations: FooterChatVehiclePatchOperation[],
	includeOperation = false
) {
	const targets = new Map<
		string,
		{
			targetId: string;
			targetType?: 'node' | 'material';
			targetName?: string;
			operation?: FooterChatVehiclePatchOperation['op'];
		}
	>();

	for (const operation of operations) {
		const key = `${operation.targetType}:${operation.targetId}:${operation.op}`;
		if (targets.has(key)) {
			continue;
		}

		targets.set(key, {
			targetId: operation.targetId,
			targetType:
				operation.targetType === 'node' || operation.targetType === 'material'
					? operation.targetType
					: undefined,
			targetName: operation.targetName,
			operation: includeOperation ? operation.op : undefined
		});
	}

	return Array.from(targets.values());
}

function getToolResultContent(toolResult: {
	message: { content?: string | Array<unknown> | null };
}): string | null {
	return typeof toolResult.message.content === 'string' ? toolResult.message.content : null;
}

function getToolResultError(toolResult: {
	message: { content?: string | Array<unknown> | null };
}): string | null {
	const content = getToolResultContent(toolResult);
	if (!content) {
		return null;
	}

	try {
		const payload = JSON.parse(content) as { error?: unknown };
		return typeof payload.error === 'string' ? payload.error : null;
	} catch {
		return null;
	}
}

function parseToolPayload(content: string | null): Record<string, unknown> | null {
	if (!content) {
		return null;
	}

	try {
		const parsed = JSON.parse(content) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function requestWantsSupplementaryFallback(message: string): boolean {
	return /\b(footer|supplementary|list|options|status|available tools|what tools are available|what can you do here|what can i do here|capabilities|changed targets|what changed)\b/i.test(
		message
	);
}

function summarizeOperationTargets(operations: FooterChatVehiclePatchOperation[]): string | undefined {
	const labels = summarizeTargets(operations)
		.map((target) => target.targetName ?? target.targetId)
		.filter((value, index, values) => value && values.indexOf(value) === index);

	if (labels.length === 0) {
		return undefined;
	}

	if (labels.length <= 3) {
		return labels.join(', ');
	}

	return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`;
}

function buildSupplementaryListFromCatalogPayload(
	payload: Record<string, unknown>
) {
	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const recommendations = Array.isArray(payload.recommendations) ? payload.recommendations : [];
	const entries = Object.fromEntries(
		tools
			.map((tool) => {
				if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
					return null;
				}

				const name = typeof tool.name === 'string' ? tool.name.trim() : '';
				const purpose = typeof tool.purpose === 'string' ? tool.purpose.trim() : '';
				if (!name || !purpose) {
					return null;
				}

				return [name, purpose] as const;
			})
			.filter((entry): entry is readonly [string, string] => entry !== null)
			.slice(0, 5)
	);

	const primaryRecommendation = recommendations.find(
		(value): value is string => typeof value === 'string' && value.trim().length > 0
	);
	if (primaryRecommendation) {
		entries.Next = primaryRecommendation.trim();
	}

	return normalizeSupplementaryListState({
		active: Object.keys(entries).length > 0,
		entries
	});
}

function buildSupplementaryListFromExecutionResult(input: {
	message: string;
	vehiclePatchLabel?: string;
	vehiclePatchOperations: FooterChatVehiclePatchOperation[];
	selectionUpdateCount: number;
	finalText: string;
}) {
	const entries: Record<string, string> = {};
	const actionSummary = input.vehiclePatchLabel?.trim() || input.finalText.trim();
	if (actionSummary) {
		entries.Action = actionSummary;
	}

	const targets = summarizeOperationTargets(input.vehiclePatchOperations);
	if (targets) {
		entries.Targets = targets;
	}

	if (input.selectionUpdateCount > 0) {
		entries.Selection = `${input.selectionUpdateCount} selected`;
	}

	if (
		Object.keys(entries).length === 1 &&
		!/\b(changed targets|what changed|footer|supplementary|list|status|options)\b/i.test(
			input.message
		)
	) {
		return undefined;
	}

	return normalizeSupplementaryListState({
		active: Object.keys(entries).length > 0,
		entries
	});
}

function buildSupplementaryListFallback(input: {
	message: string;
	existing: FooterChatResponse['supplementaryList'];
	toolCatalogPayload?: Record<string, unknown>;
	vehiclePatchLabel?: string;
	vehiclePatchOperations: FooterChatVehiclePatchOperation[];
	selectionUpdateCount: number;
	finalText: string;
}) {
	const existingActive =
		input.existing?.active === true && Object.keys(input.existing.entries ?? {}).length > 0;
	if (existingActive || !requestWantsSupplementaryFallback(input.message)) {
		return input.existing;
	}

	const executionFallback = buildSupplementaryListFromExecutionResult({
		message: input.message,
		vehiclePatchLabel: input.vehiclePatchLabel,
		vehiclePatchOperations: input.vehiclePatchOperations,
		selectionUpdateCount: input.selectionUpdateCount,
		finalText: input.finalText
	});
	if (executionFallback?.active) {
		return executionFallback;
	}

	const catalogFallback = input.toolCatalogPayload
		? buildSupplementaryListFromCatalogPayload(input.toolCatalogPayload)
		: undefined;
	if (catalogFallback?.active) {
		return catalogFallback;
	}

	return input.existing;
}

export async function createFooterChatResponse(
	input: FooterChatRequest,
	executionContext: FooterChatExecutionContext = {}
): Promise<FooterChatResponse> {
	const normalized = normalizeRequest(input);
	const model = getToolModel();
	const intentDraft = resolveIntentDraft(normalized);
	const policy = deriveFooterChatPolicy(normalized, MAX_TOOL_ROUNDS, intentDraft);
	const toolChoice = policy.toolChoice ?? getToolChoiceForRequest(normalized);
	const route = classifyExecutionRoute(normalized);
	const historyContext =
		executionContext.resolvedHistoryContext ??
		(await resolveContextHistory({
			userId: executionContext.userId,
			assetId: normalized.assetId
		}));
	const historyTrace = buildHistoryTrace(historyContext);

	return withActiveSpan(
		'mobisim.chat',
		'footer_chat.create_response',
		{
			attributes: {
				'mobisim.chat.route': route,
				'mobisim.chat.tool_choice':
					typeof toolChoice === 'string' ? toolChoice : toolChoice?.type ?? 'none',
				'mobisim.chat.planner_model': model,
				'mobisim.chat.policy_mode': policy.mode,
				'mobisim.chat.intent_domain': intentDraft.domain,
				'mobisim.chat.intent_operation': intentDraft.operation,
				'mobisim.chat.intent_referent': intentDraft.referent,
				'mobisim.chat.intent_target_scope': intentDraft.targetScope,
				'mobisim.chat.asset_id': normalized.assetId ?? 'none',
				'mobisim.chat.has_selection': normalized.selectedNodes.length > 0,
				'mobisim.chat.selected_node_count': normalized.selectedNodes.length
			}
		},
		async () => {
			try {
				let effectiveRoute = route;
				const semanticOverlayForTrace: SemanticOverlayPromptContext = {
					status: 'unknown',
					sidebarCadence: 'stable'
				};

				if (route === 'presentation_restore') {
					const presentationRestore = buildPresentationRestoreFromContext(
						normalized.message,
						normalized.presentation
					);
					if (presentationRestore) {
					return {
						model,
						message: {
							role: 'assistant',
							content: summarizeRestoreInstruction(presentationRestore)
						},
						presentationRestore,
							trace: {
								route,
								semanticOverlayStatus: semanticOverlayForTrace.status,
								toolCalls: [],
								sidebarAction: 'unchanged',
								supplementaryListAction: 'unchanged',
								...historyTrace,
								plannerModel: model,
								planningMode: 'direct',
									toolRoundsUsed: 0,
									clarificationIssued: false,
									composedToolChain: false
								}
							};
					}

					effectiveRoute = 'llm';
				}

				if (policy.clarificationMessage) {
					return {
						model,
						message: {
							role: 'assistant',
							content: policy.clarificationMessage
						},
						trace: {
							route: 'llm',
							semanticOverlayStatus: semanticOverlayForTrace.status,
							toolCalls: [],
							sidebarAction: 'unchanged',
							supplementaryListAction: 'unchanged',
							...historyTrace,
							plannerModel: model,
							planningMode: 'clarification',
							toolRoundsUsed: 0,
							clarificationIssued: true,
							composedToolChain: false
						}
					};
				}

				if (policy.mode === 'direct') {
					const directSemanticResponse = await attemptDirectSemanticEdit(
						normalized,
						model,
						executeToolCall
					);
					if (directSemanticResponse) {
						return {
							...directSemanticResponse,
							trace: {
								route: 'direct_edit',
								semanticOverlayStatus: directSemanticResponse.semanticOverlayStatus ?? 'unknown',
								toolCalls: ['edit_vehicle_semantics'],
								sidebarAction: 'unchanged',
								supplementaryListAction: 'unchanged',
								...historyTrace,
								plannerModel: model,
								planningMode: 'direct',
								toolRoundsUsed: 0,
								clarificationIssued: false,
								composedToolChain: false
							}
						};
					}

					const directResponse = await attemptDirectVehicleEdit(normalized, model);
					if (directResponse) {
						return {
							...directResponse,
							trace: {
								route: 'direct_edit',
								semanticOverlayStatus: semanticOverlayForTrace.status,
								toolCalls: [],
								sidebarAction: 'unchanged',
								supplementaryListAction: 'unchanged',
								...historyTrace,
								plannerModel: model,
								planningMode: 'direct',
								toolRoundsUsed: 0,
								clarificationIssued: false,
								composedToolChain: false
							}
						};
					}
				}

				const semanticOverlay = await resolveSemanticOverlayPromptContext(normalized);
				const openai = getOpenAIChatClient();
				const messages = toOpenAIMessages({
					input: normalized,
					semanticOverlay,
					historyContext,
					policySummary: describeFooterChatPolicy(policy),
					intentSummary: describeIntentDraft(intentDraft),
					describePresentationTargets
				});

				let vehiclePatchOperations: FooterChatVehiclePatchOperation[] = [];
				let vehiclePatchLabel: string | undefined;
				let presentationRestore = undefined;
				let selectionUpdate: VehicleNodeSelection[] | undefined = undefined;
				let selectionUpdateLabel: string | undefined;
				let latestSemanticOverlay = undefined;
				let latestSemanticOverlayStatus = semanticOverlay.status;
				let latestSemanticIngressBindings = undefined;
				let sidebar = normalized.sidebar;
				let supplementaryList = normalized.supplementaryList;
				let latestToolCatalogPayload: Record<string, unknown> | undefined;
				const toolCallsUsed: string[] = [];
				let toolRoundsUsed = 0;
				let clarificationIssued = false;

				let completion = await openai.chat.completions.create({
					model,
					messages,
					tools: CHAT_TOOLS,
					tool_choice: toolChoice
				});

				for (let round = 0; round < policy.toolBudget; round += 1) {
					const assistantMessage = completion.choices[0]?.message;
					const toolCalls = assistantMessage?.tool_calls;

					if (!toolCalls || toolCalls.length === 0) {
						break;
					}

					toolRoundsUsed += 1;

					messages.push(assistantMessage);

					for (const toolCall of toolCalls) {
						if (toolCall.type !== 'function') {
							continue;
						}

						toolCallsUsed.push(toolCall.function.name);
						const toolResult = await executeToolCall(
							toolCall,
							normalized.assetId,
							normalized.selectedNodes,
							normalized.presentation
						);
						messages.push(toolResult.message);

						if (toolResult.plannedOperations && toolResult.plannedOperations.length > 0) {
							vehiclePatchOperations = mergePatchOperations(
								vehiclePatchOperations,
								toolResult.plannedOperations
							);
							vehiclePatchLabel = toolResult.intentLabel ?? vehiclePatchLabel;
						}

						if (toolResult.selectionUpdate && toolResult.selectionUpdate.length > 0) {
							selectionUpdate = toolResult.selectionUpdate;
							selectionUpdateLabel = toolResult.selectionUpdateLabel ?? selectionUpdateLabel;
						}

						if (toolResult.presentationRestore) {
							presentationRestore = toolResult.presentationRestore;
						}

						if (toolResult.sidebar) {
							sidebar = toolResult.sidebar;
						}

						if (toolResult.supplementaryList) {
							supplementaryList = toolResult.supplementaryList;
						}

						if (toolCall.function.name === GET_VEHICLE_TOOL_CATALOG_TOOL_NAME) {
							const payload = parseToolPayload(getToolResultContent(toolResult));
							if (payload) {
								latestToolCatalogPayload = payload;
							}
						}

						if (toolResult.semanticOverlay !== undefined) {
							latestSemanticOverlay = toolResult.semanticOverlay;
							latestSemanticOverlayStatus = toolResult.semanticOverlay ? 'fresh' : 'missing';
						}

						if (toolResult.semanticIngressBindings) {
							latestSemanticIngressBindings = toolResult.semanticIngressBindings;
						}
					}

					completion = await openai.chat.completions.create({
						model,
						messages,
						tools: CHAT_TOOLS
					});
				}

				const content = completion.choices[0]?.message?.content;
				const text = Array.isArray(content)
					? content
							.map((part) => ('text' in part ? part.text : ''))
							.join('')
							.trim()
					: content?.trim();

				clarificationIssued = !!text && /\?\s*$/.test(text);
				supplementaryList = buildSupplementaryListFallback({
					message: normalized.message,
					existing: supplementaryList,
					toolCatalogPayload: latestToolCatalogPayload,
					vehiclePatchLabel,
					vehiclePatchOperations,
					selectionUpdateCount: selectionUpdate?.length ?? 0,
					finalText: text ?? ''
				});

				if (!text) {
					if (vehiclePatchOperations.length > 0) {
						const planningMode = deriveObservedPlanningMode({
							policy,
							route: effectiveRoute,
							toolCallsUsed,
							clarificationIssued: false
						});
						return {
							model,
							message: {
								role: 'assistant',
								content: 'Applied the requested vehicle edit.'
							},
							vehiclePatchAssetId: normalized.assetId,
							vehiclePatchLabel,
							vehiclePatchOperations,
							presentationRestore,
							selectionUpdate:
								selectionUpdate && selectionUpdate.length > 0
									? {
											mode: 'replace',
											selectedNodes: selectionUpdate,
											label: selectionUpdateLabel
									  }
									: undefined,
							sidebar,
							supplementaryList,
							semanticOverlayStatus: latestSemanticOverlayStatus,
							semanticOverlay: latestSemanticOverlay,
							semanticIngressBindings: latestSemanticIngressBindings,
							trace: {
								route: effectiveRoute,
								semanticOverlayStatus: latestSemanticOverlayStatus,
								toolCalls: toolCallsUsed,
								sidebarAction: resolveSidebarAction(normalized.sidebar, sidebar),
								supplementaryListAction: resolveSupplementaryListAction(
									normalized.supplementaryList,
									supplementaryList
								),
								...historyTrace,
								plannerModel: model,
								planningMode,
								toolRoundsUsed,
								clarificationIssued: false,
								composedToolChain: toolCallsUsed.length > 1
							}
						};
					}

					throw new OpenAIChatConfigError('OpenAI returned an empty response.');
				}

				if (
					vehiclePatchOperations.length === 0 &&
					!presentationRestore &&
					!(selectionUpdate && selectionUpdate.length > 0)
				) {
					const fallbackVehicleEditResponse = await attemptDirectVehicleEdit(normalized, model);
					if (fallbackVehicleEditResponse) {
						return {
							...fallbackVehicleEditResponse,
							semanticOverlayStatus: latestSemanticOverlayStatus,
							semanticOverlay: latestSemanticOverlay,
							semanticIngressBindings: latestSemanticIngressBindings,
							trace: {
								route: 'direct_edit',
								semanticOverlayStatus: latestSemanticOverlayStatus,
								toolCalls: toolCallsUsed,
								sidebarAction: resolveSidebarAction(normalized.sidebar, sidebar),
								supplementaryListAction: resolveSupplementaryListAction(
									normalized.supplementaryList,
									supplementaryList
								),
								...historyTrace,
								plannerModel: model,
								planningMode: 'direct',
								toolRoundsUsed,
								clarificationIssued: false,
								composedToolChain: toolCallsUsed.length > 1
							}
						};
					}
				}

				const planningMode = deriveObservedPlanningMode({
					policy,
					route: effectiveRoute,
					toolCallsUsed,
					clarificationIssued
				});

				const response: FooterChatResponse = {
					model,
					message: {
						role: 'assistant',
						content: text
					},
					vehiclePatchAssetId: vehiclePatchOperations.length > 0 ? normalized.assetId : undefined,
					vehiclePatchLabel:
						vehiclePatchOperations.length > 0 ? (vehiclePatchLabel ?? text) : undefined,
					vehiclePatchOperations:
						vehiclePatchOperations.length > 0 ? vehiclePatchOperations : undefined,
					presentationRestore,
					selectionUpdate:
						selectionUpdate && selectionUpdate.length > 0
							? {
									mode: 'replace',
									selectedNodes: selectionUpdate,
									label: selectionUpdateLabel
							  }
							: undefined,
					sidebar,
					supplementaryList,
					semanticOverlayStatus: latestSemanticOverlayStatus,
					semanticOverlay: latestSemanticOverlay,
					semanticIngressBindings: latestSemanticIngressBindings,
					trace: {
						route: effectiveRoute,
						semanticOverlayStatus: latestSemanticOverlayStatus,
						toolCalls: toolCallsUsed,
						sidebarAction: resolveSidebarAction(normalized.sidebar, sidebar),
						supplementaryListAction: resolveSupplementaryListAction(
							normalized.supplementaryList,
							supplementaryList
						),
						...historyTrace,
						plannerModel: model,
						planningMode,
						toolRoundsUsed,
						clarificationIssued,
						composedToolChain: toolCallsUsed.length > 1
					}
				};

				await persistContextHistory({
					userId: executionContext.userId,
					request: normalized,
					response,
					rawUserMessage: input.message
				});

				return response;
			} catch (error) {
				if (error instanceof OpenAI.APIError) {
					throw new OpenAIChatUpstreamError(error.message);
				}

				if (error instanceof OpenAIChatConfigError) {
					throw error;
				}

				throw new OpenAIChatUpstreamError(
					error instanceof Error ? error.message : 'OpenAI request failed.'
				);
			}
		}
	);
}
