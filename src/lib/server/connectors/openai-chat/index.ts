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
import { CHAT_TOOLS } from './tool-definitions';
import { withActiveSpan } from '$lib/server/telemetry';
import {
	attemptDirectVehicleEdit,
	executeToolCall,
	mergePatchOperations,
	resolveSemanticOverlayPromptContext,
	resolveSidebarAction,
	resolveSupplementaryListAction
} from './execution';
import {
	DEFAULT_MODEL,
	MAX_TOOL_ROUNDS,
	type FooterChatExecutionRoute,
	type SemanticOverlayPromptContext
} from './internal';
import type {
	FooterChatPresentationContext,
	FooterChatPresentationRestore,
	FooterChatVehiclePatchOperation
} from './types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';

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

function buildPresentationContextFromOperations(
	basePresentation: FooterChatPresentationContext | undefined,
	operations: FooterChatVehiclePatchOperation[],
	intentLabel?: string
): FooterChatPresentationContext | undefined {
	const viewerModes = operations
		.filter(
			(operation) =>
				operation.targetType === 'viewer' &&
				operation.op === 'set_enabled' &&
				operation.value === true &&
				(operation.targetId === 'wireframe' ||
					operation.targetId === 'xray' ||
					operation.targetId === 'uv_debug' ||
					operation.targetId === 'postprocess')
		)
		.map((operation) => operation.targetId as NonNullable<FooterChatPresentationContext['viewerModes']>[number]);

	const hiddenTargets = operations.filter(
		(operation) => operation.targetType === 'node' && operation.op === 'set_visibility' && operation.value === false
	);
	const context: FooterChatPresentationContext = {
		activeIntentLabel: intentLabel ?? basePresentation?.activeIntentLabel,
		highlightedTargets: summarizeTargets(
			operations.filter((operation) => operation.op === 'set_overlay_highlight')
		),
		materialTargets: summarizeTargets(
			operations.filter(
				(operation) =>
					operation.targetType === 'material' && operation.op !== 'set_overlay_highlight'
			),
			true
		),
		hiddenTargets: summarizeTargets(hiddenTargets),
		viewerModes: viewerModes.length > 0 ? viewerModes : basePresentation?.viewerModes
	};

	if (
		!context.activeIntentLabel &&
		(context.highlightedTargets?.length ?? 0) === 0 &&
		(context.materialTargets?.length ?? 0) === 0 &&
		(context.hiddenTargets?.length ?? 0) === 0 &&
		(context.viewerModes?.length ?? 0) === 0
	) {
		return undefined;
	}

	return context;
}

function applyPresentationRestoreToContext(
	presentation: FooterChatPresentationContext | undefined,
	restore: FooterChatPresentationRestore | undefined
): FooterChatPresentationContext | undefined {
	if (!presentation || !restore) {
		return presentation;
	}

	if (restore.restoreAll) {
		return undefined;
	}

	const next: FooterChatPresentationContext = {
		...presentation,
		highlightedTargets: restore.highlightedTargetIds
			? (presentation.highlightedTargets ?? []).filter(
					(target) => !restore.highlightedTargetIds?.includes(target.targetId)
			  )
			: presentation.highlightedTargets,
		materialTargets: restore.materialTargetIds
			? (presentation.materialTargets ?? []).filter(
					(target) => !restore.materialTargetIds?.includes(target.targetId)
			  )
			: presentation.materialTargets,
		hiddenTargets: restore.hiddenTargetIds
			? (presentation.hiddenTargets ?? []).filter(
					(target) => !restore.hiddenTargetIds?.includes(target.targetId)
			  )
			: presentation.hiddenTargets,
		viewerModes: restore.viewerModes
			? (presentation.viewerModes ?? []).filter((mode) => !restore.viewerModes?.includes(mode))
			: presentation.viewerModes
	};

	if (
		!next.activeIntentLabel &&
		(next.highlightedTargets?.length ?? 0) === 0 &&
		(next.materialTargets?.length ?? 0) === 0 &&
		(next.hiddenTargets?.length ?? 0) === 0 &&
		(next.viewerModes?.length ?? 0) === 0
	) {
		return undefined;
	}

	return next;
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
				let latestSemanticOverlay = undefined;
				let latestSemanticOverlayStatus = semanticOverlay.status;
				let latestSemanticIngressBindings = undefined;
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
							semanticOverlayStatus: latestSemanticOverlayStatus,
							semanticOverlay: latestSemanticOverlay,
							semanticIngressBindings: latestSemanticIngressBindings,
							trace: {
								route,
								semanticOverlayStatus: latestSemanticOverlayStatus,
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
					semanticOverlayStatus: latestSemanticOverlayStatus,
					semanticOverlay: latestSemanticOverlay,
					semanticIngressBindings: latestSemanticIngressBindings,
					trace: {
						route,
						semanticOverlayStatus: latestSemanticOverlayStatus,
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
