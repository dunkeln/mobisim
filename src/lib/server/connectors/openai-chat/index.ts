import { env } from '$env/dynamic/private';
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
import { normalizeRequest, describePresentationTargets } from './normalize';
import { toOpenAIMessages } from './prompt';
import { withActiveSpan } from '$lib/server/telemetry';
import {
	attemptDirectVehicleEdit,
	CHAT_TOOLS,
	executeToolCall,
	mergePatchOperations,
	resolveSemanticOverlayPromptContext,
	resolveSidebarAction,
	resolveSupplementaryListAction
} from './execution';
import { DEFAULT_MODEL, MAX_TOOL_ROUNDS, type SemanticOverlayPromptContext } from './internal';
import type { FooterChatVehiclePatchOperation } from './types';

export {
	OpenAIChatConfigError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from './errors';

export async function createFooterChatResponse(
	input: FooterChatRequest
): Promise<FooterChatResponse> {
	const normalized = normalizeRequest(input);
	const model = env.OPENAI_MODEL || DEFAULT_MODEL;
	const toolChoice = getToolChoiceForRequest(normalized);
	const route = classifyExecutionRoute(normalized);

	return withActiveSpan(
		'mobisim.chat',
		'footer_chat.create_response',
		{
			attributes: {
				'mobisim.chat.route': route,
				'mobisim.chat.tool_choice':
					typeof toolChoice === 'string' ? toolChoice : toolChoice?.type ?? 'none',
				'mobisim.chat.asset_id': normalized.assetId ?? 'none',
				'mobisim.chat.has_selection': normalized.selectedNodes.length > 0,
				'mobisim.chat.selected_node_count': normalized.selectedNodes.length
			}
		},
		async () => {
			try {
				const semanticOverlayForTrace: SemanticOverlayPromptContext = {
					status: 'unknown',
					sidebarCadence: 'stable'
				};

				if (route === 'presentation_restore') {
					const presentationRestore = buildPresentationRestoreFromContext(
						normalized.message,
						normalized.presentation
					);
					if (!presentationRestore) {
						throw new OpenAIChatConfigError('Restore route resolved without presentation context.');
					}

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
								supplementaryListAction: 'unchanged'
							}
						};
				}

				const semanticOverlay = await resolveSemanticOverlayPromptContext(normalized);
				const openai = getOpenAIChatClient();
				const messages = toOpenAIMessages({
					input: normalized,
					semanticOverlay,
					describePresentationTargets
				});

				let vehiclePatchOperations: FooterChatVehiclePatchOperation[] = [];
				let vehiclePatchLabel: string | undefined;
				let presentationRestore = undefined;
				let selectionUpdate = undefined;
				let selectionUpdateLabel: string | undefined;
				let sidebar = normalized.sidebar;
				let supplementaryList = normalized.supplementaryList;
				const toolCallsUsed: string[] = [];

				let completion = await openai.chat.completions.create({
					model,
					messages,
					tools: CHAT_TOOLS,
					tool_choice: toolChoice
				});

				for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
					const assistantMessage = completion.choices[0]?.message;
					const toolCalls = assistantMessage?.tool_calls;

					if (!toolCalls || toolCalls.length === 0) {
						break;
					}

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

				if (!text) {
					if (vehiclePatchOperations.length > 0) {
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
							trace: {
								route,
								semanticOverlayStatus: semanticOverlay.status,
								toolCalls: toolCallsUsed,
								sidebarAction: resolveSidebarAction(normalized.sidebar, sidebar),
								supplementaryListAction: resolveSupplementaryListAction(
									normalized.supplementaryList,
									supplementaryList
								)
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
							trace: {
								route: 'direct_edit',
								semanticOverlayStatus: semanticOverlay.status,
								toolCalls: toolCallsUsed,
								sidebarAction: resolveSidebarAction(normalized.sidebar, sidebar),
								supplementaryListAction: resolveSupplementaryListAction(
									normalized.supplementaryList,
									supplementaryList
								)
							}
						};
					}
				}

				return {
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
					trace: {
						route,
						semanticOverlayStatus: semanticOverlay.status,
						toolCalls: toolCallsUsed,
						sidebarAction: resolveSidebarAction(normalized.sidebar, sidebar),
						supplementaryListAction: resolveSupplementaryListAction(
							normalized.supplementaryList,
							supplementaryList
						)
					}
				};
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
