import OpenAI from 'openai';
import { buildPresentationRestoreFromContext, summarizeRestoreInstruction } from '$lib/contracts/footer-chat-restore';
import { getOpenAIChatClient } from './client';
import {
	OpenAIChatConfigError,
	OpenAIChatExecutionError,
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
import { loadSceneDagWithSemanticOverlayState } from '$lib/server/scene-dag';
import {
	attemptDirectSemanticGroupDelete,
	attemptDirectSemanticGroupPatch,
	attemptDirectSemanticEdit,
	attemptDirectVehicleEdit,
	executeToolCall,
	mergePatchOperations,
	resolveSidebarAction,
	resolveSupplementaryListAction
} from './execution';
import {
	MAX_TOOL_ROUNDS,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME
} from './internal';
import {
	deriveFooterChatPolicy,
	deriveObservedPlanningMode,
	describeFooterChatPolicy
} from './policy';
import { describeIntentDraft, resolveIntentDraft } from './intent-resolver';
import { resolveSemanticSidebarCadence } from './execution';
import type {
	FooterChatExecutionContext,
	FooterChatPresentationContext,
	FooterChatPresentationRestore,
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
	OpenAIChatExecutionError,
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

function hasCommittedToolSideEffects(input: {
	vehiclePatchOperations: FooterChatVehiclePatchOperation[];
	selectionUpdate?: VehicleNodeSelection[];
	semanticOverlayKnown: boolean;
	selectedGroupIdChanged: boolean;
	sidebarChanged: boolean;
	supplementaryListChanged: boolean;
}): boolean {
	return (
		input.vehiclePatchOperations.length > 0 ||
		(input.selectionUpdate?.length ?? 0) > 0 ||
		input.semanticOverlayKnown ||
		input.selectedGroupIdChanged ||
		input.sidebarChanged ||
		input.supplementaryListChanged
	);
}

function buildCommittedToolFallbackMessage(input: {
	vehiclePatchOperations: FooterChatVehiclePatchOperation[];
	selectionUpdate?: VehicleNodeSelection[];
	semanticOverlayKnown: boolean;
}): string {
	if (input.semanticOverlayKnown) {
		return 'Applied the requested semantic update.';
	}

	if ((input.selectionUpdate?.length ?? 0) > 0) {
		return 'Updated the current selection.';
	}

	if (input.vehiclePatchOperations.length > 0) {
		return 'Applied the requested vehicle edit.';
	}

	return 'Applied the requested update.';
}

async function persistContextHistorySafely(input: {
	userId?: string;
	request: Parameters<typeof persistContextHistory>[0]['request'];
	response: Parameters<typeof persistContextHistory>[0]['response'];
	rawUserMessage: string;
}): Promise<void> {
	try {
		await persistContextHistory(input);
	} catch (error) {
		console.error(
			'chat history persistence failed',
			error instanceof Error ? error.message : error
		);
	}
}

export function buildHighlightOverrideRestore(input: {
	presentation?: FooterChatPresentationContext;
	vehiclePatchOperations: FooterChatVehiclePatchOperation[];
}): FooterChatPresentationRestore | undefined {
	const highlightedTargets = input.presentation?.highlightedTargets ?? [];
	if (highlightedTargets.length === 0 || input.vehiclePatchOperations.length === 0) {
		return undefined;
	}

	const highlightedTargetIds = new Set(highlightedTargets.map((target) => target.targetId));
	const overriddenHighlightIds = Array.from(
		new Set(
			input.vehiclePatchOperations
				.filter((operation) => operation.op !== 'set_overlay_highlight')
				.map((operation) => operation.targetId)
				.filter((targetId) => highlightedTargetIds.has(targetId))
		)
	).sort((left, right) => left.localeCompare(right));

	if (overriddenHighlightIds.length === 0) {
		return undefined;
	}

	return {
		highlightedTargetIds: overriddenHighlightIds,
		label: 'restore original view'
	};
}

function mergePresentationRestores(
	base: FooterChatPresentationRestore | undefined,
	incoming: FooterChatPresentationRestore | undefined
): FooterChatPresentationRestore | undefined {
	if (!base) {
		return incoming;
	}

	if (!incoming) {
		return base;
	}

	if (base.restoreAll || incoming.restoreAll) {
		return {
			restoreAll: true,
			label: incoming.label ?? base.label ?? 'restore original view'
		};
	}

	const mergeIds = (left?: string[], right?: string[]) => {
		const merged = Array.from(new Set([...(left ?? []), ...(right ?? [])])).sort((a, b) =>
			a.localeCompare(b)
		);
		return merged.length > 0 ? merged : undefined;
	};

	const mergeModes = (left?: string[], right?: string[]) => {
		const merged = Array.from(new Set([...(left ?? []), ...(right ?? [])])).sort((a, b) =>
			a.localeCompare(b)
		);
		return merged.length > 0 ? merged : undefined;
	};

	return {
		highlightedTargetIds: mergeIds(base.highlightedTargetIds, incoming.highlightedTargetIds),
		materialTargetIds: mergeIds(base.materialTargetIds, incoming.materialTargetIds),
		hiddenTargetIds: mergeIds(base.hiddenTargetIds, incoming.hiddenTargetIds),
		viewerModes: mergeModes(base.viewerModes, incoming.viewerModes) as
			| FooterChatPresentationRestore['viewerModes']
			| undefined,
		label: incoming.label ?? base.label
	};
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
			let vehiclePatchOperations: FooterChatVehiclePatchOperation[] = [];
			let vehiclePatchLabel: string | undefined;
			let presentationRestore = undefined;
			let selectionUpdate: VehicleNodeSelection[] | undefined = undefined;
			let selectionUpdateLabel: string | undefined;
			let latestSemanticOverlay = undefined;
			let latestSemanticOverlayStatus: FooterChatResponse['semanticOverlayStatus'] = 'unknown';
			let currentSelectedGroupId = normalized.selectedGroupId;
			let sidebar = normalized.sidebar;
			let supplementaryList = normalized.supplementaryList;
			const toolCallsUsed: string[] = [];
			let latestToolTrace:
				| Pick<
						NonNullable<FooterChatResponse['trace']>,
						| 'executedToolDomain'
						| 'executedAction'
						| 'affectedTargetCount'
						| 'destructiveScope'
						| 'approvalSummary'
				  >
				| undefined;
			let toolRoundsUsed = 0;
			let clarificationIssued = false;
			let effectiveRoute = route;

			try {
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
								semanticOverlayStatus: 'unknown',
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
							semanticOverlayStatus: 'unknown',
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
					const directSemanticPatchResponse = await attemptDirectSemanticGroupPatch(
						normalized,
						model,
						executeToolCall
					);
					if (directSemanticPatchResponse) {
						return {
							...directSemanticPatchResponse,
							trace: {
								route: 'direct_edit',
								semanticOverlayStatus:
									directSemanticPatchResponse.semanticOverlayStatus ?? 'unknown',
								toolCalls: ['edit_vehicle_semantics'],
								sidebarAction: 'unchanged',
								supplementaryListAction: 'unchanged',
								...historyTrace,
								plannerModel: model,
								planningMode: 'direct',
								toolRoundsUsed: 0,
								clarificationIssued: false,
								composedToolChain: false,
								...(directSemanticPatchResponse.trace ?? {})
							}
						};
					}

					const directSemanticDeleteResponse = await attemptDirectSemanticGroupDelete(
						normalized,
						model,
						executeToolCall
					);
					if (directSemanticDeleteResponse) {
						return {
							...directSemanticDeleteResponse,
							trace: {
								route: 'direct_edit',
								semanticOverlayStatus:
									directSemanticDeleteResponse.semanticOverlayStatus ?? 'unknown',
								toolCalls: ['edit_vehicle_semantics'],
								sidebarAction: 'unchanged',
								supplementaryListAction: 'unchanged',
								...historyTrace,
								plannerModel: model,
								planningMode: 'direct',
								toolRoundsUsed: 0,
								clarificationIssued: false,
								composedToolChain: false,
								...(directSemanticDeleteResponse.trace ?? {})
							}
						};
					}

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
								composedToolChain: false,
								...(directSemanticResponse.trace ?? {})
							}
						};
					}

					const directResponse = await attemptDirectVehicleEdit(normalized, model);
					if (directResponse) {
						const highlightOverrideRestore = buildHighlightOverrideRestore({
							presentation: normalized.presentation,
							vehiclePatchOperations: directResponse.vehiclePatchOperations ?? []
						});
						return {
							...directResponse,
							presentationRestore: mergePresentationRestores(
								directResponse.presentationRestore,
								highlightOverrideRestore
							),
							trace: {
								route: 'direct_edit',
								semanticOverlayStatus: 'unknown',
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

				const sceneDag = normalized.assetId
					? await loadSceneDagWithSemanticOverlayState({
							assetId: normalized.assetId,
							selectedNodes: normalized.selectedNodes,
							selectedGroupId: normalized.selectedGroupId,
							presentation: normalized.presentation
					  })
					: null;
				const semanticOverlay = sceneDag
					? {
							status: sceneDag.semanticOverlayStatus,
							overlay: sceneDag.semanticOverlay ?? undefined,
							sidebarCadence: resolveSemanticSidebarCadence(
								normalized,
								sceneDag.semanticOverlayStatus,
								sceneDag.semanticOverlay ?? undefined
							)
					  }
					: { status: 'unknown' as const, sidebarCadence: 'stable' as const };
				const openai = getOpenAIChatClient();
				const messages = toOpenAIMessages({
					input: normalized,
					semanticOverlay,
					sceneDag,
					historyContext,
					policySummary: describeFooterChatPolicy(policy),
					intentSummary: describeIntentDraft(intentDraft),
					describePresentationTargets
				});

				latestSemanticOverlayStatus = semanticOverlay.status;
				let latestToolCatalogPayload: Record<string, unknown> | undefined;
				let toolFailureMessage: string | undefined;

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
							normalized.presentation,
							currentSelectedGroupId
						);
						messages.push(toolResult.message);
						const toolError = getToolResultError(toolResult);
						if (toolError) {
							toolFailureMessage = toolError;
							break;
						}

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

						if (toolResult.selectedGroupId !== undefined) {
							currentSelectedGroupId = toolResult.selectedGroupId;
						}

						if (toolResult.trace) {
							latestToolTrace = toolResult.trace;
						}
					}

					if (toolFailureMessage) {
						break;
					}

					completion = await openai.chat.completions.create({
						model,
						messages,
						tools: CHAT_TOOLS
					});
				}

				if (toolFailureMessage) {
					const planningMode = deriveObservedPlanningMode({
						policy,
						route: effectiveRoute,
						toolCallsUsed,
						clarificationIssued: false
					});

					const response: FooterChatResponse = {
						model,
						message: {
							role: 'assistant',
							content: toolFailureMessage
						},
						sidebar,
						supplementaryList,
						semanticOverlayStatus: latestSemanticOverlayStatus,
						semanticOverlay: latestSemanticOverlay,
						selectedGroupId: currentSelectedGroupId,
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
							composedToolChain: toolCallsUsed.length > 1,
							...(latestToolTrace ?? {})
						}
					};

					await persistContextHistorySafely({
						userId: executionContext.userId,
						request: normalized,
						response,
						rawUserMessage: input.message
					});

					return response;
				}

				const content = completion.choices[0]?.message?.content;
				const text = Array.isArray(content)
					? content
							.map((part) => ('text' in part ? part.text : ''))
							.join('')
							.trim()
					: content?.trim();

				clarificationIssued = !!text && /\?\s*$/.test(text);
				const planningMode = deriveObservedPlanningMode({
					policy,
					route: effectiveRoute,
					toolCallsUsed,
					clarificationIssued
				});
				const highlightOverrideRestore = buildHighlightOverrideRestore({
					presentation: normalized.presentation,
					vehiclePatchOperations
				});
				presentationRestore = mergePresentationRestores(
					presentationRestore,
					highlightOverrideRestore
				);

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
							selectedGroupId: currentSelectedGroupId,
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
								composedToolChain: toolCallsUsed.length > 1,
								...(latestToolTrace ?? {})
							}
						};
					}

					throw new OpenAIChatConfigError('OpenAI returned an empty response.');
				}

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
					selectedGroupId: currentSelectedGroupId,
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
						composedToolChain: toolCallsUsed.length > 1,
						...(latestToolTrace ?? {})
					}
				};

				await persistContextHistorySafely({
					userId: executionContext.userId,
					request: normalized,
					response,
					rawUserMessage: input.message
				});

				return response;
			} catch (error) {
				if (error instanceof OpenAI.APIError) {
					if (
						hasCommittedToolSideEffects({
							vehiclePatchOperations,
							selectionUpdate,
							semanticOverlayKnown: latestSemanticOverlay !== undefined,
							selectedGroupIdChanged: currentSelectedGroupId !== normalized.selectedGroupId,
							sidebarChanged: sidebar !== normalized.sidebar,
							supplementaryListChanged: supplementaryList !== normalized.supplementaryList
						})
					) {
						const response: FooterChatResponse = {
							model,
							message: {
								role: 'assistant',
								content: buildCommittedToolFallbackMessage({
									vehiclePatchOperations,
									selectionUpdate,
									semanticOverlayKnown: latestSemanticOverlay !== undefined
								})
							},
							vehiclePatchAssetId:
								vehiclePatchOperations.length > 0 ? normalized.assetId : undefined,
							vehiclePatchLabel:
								vehiclePatchOperations.length > 0
									? (vehiclePatchLabel ??
										buildCommittedToolFallbackMessage({
											vehiclePatchOperations,
											selectionUpdate,
											semanticOverlayKnown: latestSemanticOverlay !== undefined
										}))
									: undefined,
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
							selectedGroupId: currentSelectedGroupId,
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
								planningMode: deriveObservedPlanningMode({
									policy,
									route: effectiveRoute,
									toolCallsUsed,
									clarificationIssued: false
								}),
								toolRoundsUsed,
								clarificationIssued: false,
								composedToolChain: toolCallsUsed.length > 1
							}
						};

						await persistContextHistorySafely({
							userId: executionContext.userId,
							request: normalized,
							response,
							rawUserMessage: input.message
						});

						return response;
					}

					throw new OpenAIChatUpstreamError(error.message);
				}

				if (error instanceof OpenAIChatInputError) {
					throw error;
				}

				if (error instanceof OpenAIChatConfigError) {
					throw error;
				}

				throw new OpenAIChatExecutionError(
					error instanceof Error ? error.message : 'Chat request failed.'
				);
			}
		}
	);
}
