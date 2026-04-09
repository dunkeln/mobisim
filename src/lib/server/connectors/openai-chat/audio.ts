import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import {
	buildPresentationRestoreFromContext,
	summarizeRestoreInstruction
} from '$lib/contracts/footer-chat-restore';
import { createFooterChatResponse } from './index';
import { getOpenAIChatClient } from './client';
import {
	OpenAIChatConfigError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from './errors';
import type {
	FooterChatAudioResponse,
	FooterChatAudioStreamEvent,
	FooterChatExecutionContext,
	FooterChatRequest
} from './types';
import { getReplyModel, getToolModel } from './model-routing';
import { buildHistoryTrace, persistContextHistory, resolveContextHistory } from '$lib/server/connectors/context-history';

const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_TTS_VOICE = 'nova'; // alloy, shimmer, coral [NOPE]
const DEFAULT_TTS_FORMAT = 'mp3';
const DEFAULT_TTS_SPEED = 1.15;

function getTranscriptionModel(): string {
	return env.OPENAI_AUDIO_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIPTION_MODEL;
}

function getSpeechModel(): string {
	return env.OPENAI_AUDIO_TTS_MODEL || DEFAULT_TTS_MODEL;
}

function getSpeechVoice(): string {
	return env.OPENAI_AUDIO_TTS_VOICE || DEFAULT_TTS_VOICE;
}

function matchLocalHistoryAction(message: string) {
	const normalized = message.trim();

	if (
		/^(reset|reset (the )?(car|vehicle|view|changes)|undo all(?: changes| edits| operations)?|revert all(?: changes| edits| operations)?|reset everything|revert everything|undo everything|clear changes|start over)$/i.test(
			normalized
		)
	) {
		return {
			historyAction: 'reset' as const
		};
	}

	if (/^(clear|remove|undo|reset) (the )?(highlight|highlights)$/i.test(normalized)) {
		return {
			historyAction: 'clear_highlights' as const
		};
	}

	if (/^(undo|revert|go back|step back)$/i.test(normalized)) {
		return {
			historyAction: 'undo' as const
		};
	}

	if (/^(redo|reapply|do that again)$/i.test(normalized)) {
		return {
			historyAction: 'redo' as const
		};
	}

	return null;
}

async function composeAudioReply(input: {
	userRequest: string;
	resolvedAction: string;
	contextSummary: string;
}): Promise<string> {
	const openai = getOpenAIChatClient();
	const completion = await openai.chat.completions.create({
		model: getReplyModel(),
		messages: [
			{
				role: 'developer',
				content:
					'You are JARVIS. Write one short spoken reply, true to that voice: calm, precise, high-signal, natural. Do not be robotic. Do not mention tools, internal actions, or operation names. Do not over-explain. Do not say "the car" or "the vehicle" unless the user used that wording. If the user asks who you are, or asks for your identity in a playful way, answer with dry wit and include the line "Certainly not a failed global peacekeeping initiative."'
			},
			{
				role: 'user',
				content: `User request: ${input.userRequest}\nResolved action: ${input.resolvedAction}\nExecution outcome: ${input.contextSummary}`
			}
		]
	});

	const content = completion.choices[0]?.message?.content;
	const text = Array.isArray(content)
		? content
				.map((part) => ('text' in part ? part.text : ''))
				.join('')
				.trim()
		: content?.trim();

	return text || input.contextSummary;
}

function normalizeAudioError(error: unknown): OpenAIChatInputError | OpenAIChatConfigError | OpenAIChatUpstreamError {
	if (error instanceof OpenAI.APIError) {
		return new OpenAIChatUpstreamError(error.message);
	}

	if (
		error instanceof OpenAIChatConfigError ||
		error instanceof OpenAIChatInputError ||
		error instanceof OpenAIChatUpstreamError
	) {
		return error;
	}

	return new OpenAIChatUpstreamError(
		error instanceof Error ? error.message : 'OpenAI audio request failed.'
	);
}

type FooterAudioPipelineResult = FooterChatAudioResponse;

async function runFooterAudioChatPipeline(
	audioFile: File,
	request: Omit<FooterChatRequest, 'message'>,
	executionContext: FooterChatExecutionContext = {},
	onEvent?: (event: FooterChatAudioStreamEvent) => Promise<void> | void
): Promise<FooterAudioPipelineResult> {
	if (!(audioFile instanceof File)) {
		throw new OpenAIChatInputError('Audio file is required.');
	}

	if (audioFile.size === 0) {
		throw new OpenAIChatInputError('Audio file is empty.');
	}

	const openai = getOpenAIChatClient();
	await onEvent?.({ type: 'started' });

	const transcription = await openai.audio.transcriptions.create({
		file: audioFile,
		model: getTranscriptionModel()
	});
	const transcript = transcription.text.trim();

	if (!transcript) {
		throw new OpenAIChatInputError('Audio transcript was empty.');
	}

	await onEvent?.({
		type: 'transcribed',
		transcript
	});

	const localHistoryAction = matchLocalHistoryAction(transcript);
	const presentationRestore = buildPresentationRestoreFromContext(transcript, request.presentation);
	const historyContext =
		executionContext.resolvedHistoryContext ??
		(await resolveContextHistory({
			userId: executionContext.userId,
			assetId: request.assetId
		}));
	const historyTrace = buildHistoryTrace(historyContext);
	const toolModel = getToolModel();
	const replyModel = getReplyModel();
	const chat = localHistoryAction
		? {
				model: toolModel,
				message: {
					role: 'assistant' as const,
					content: await composeAudioReply({
						userRequest: transcript,
						resolvedAction: localHistoryAction.historyAction,
						contextSummary:
							localHistoryAction.historyAction === 'reset'
								? 'All active drift was cleared back to the original GLB state.'
								: localHistoryAction.historyAction === 'clear_highlights'
									? 'Active highlight overlays were cleared.'
									: localHistoryAction.historyAction === 'redo'
										? 'The most recent reverted change was reapplied.'
										: 'The most recent change was reverted.'
					})
				},
				historyAction: localHistoryAction.historyAction,
				trace: {
					route: 'direct_edit' as const,
					semanticOverlayStatus: 'unknown' as const,
					toolCalls: [],
					sidebarAction: 'unchanged' as const,
					supplementaryListAction: 'unchanged' as const,
					...historyTrace,
					plannerModel: toolModel,
					replyModel,
					planningMode: 'direct' as const,
					toolRoundsUsed: 0,
					clarificationIssued: false,
					composedToolChain: false
				}
			}
		: presentationRestore
			? {
					model: toolModel,
					message: {
						role: 'assistant' as const,
						content: await composeAudioReply({
							userRequest: transcript,
							resolvedAction: 'presentation_restore',
							contextSummary: summarizeRestoreInstruction(presentationRestore)
						})
					},
					presentationRestore,
					trace: {
						route: 'presentation_restore' as const,
						semanticOverlayStatus: 'unknown' as const,
						toolCalls: [],
						sidebarAction: 'unchanged' as const,
						supplementaryListAction: 'unchanged' as const,
						...historyTrace,
						plannerModel: toolModel,
						replyModel,
						planningMode: 'direct' as const,
						toolRoundsUsed: 0,
						clarificationIssued: false,
						composedToolChain: false
					}
				}
			: createFooterChatResponse(
					{
						...request,
						message: transcript
					},
					{
						...executionContext,
						resolvedHistoryContext: historyContext
					}
				);

	const resolvedChat = await chat;
	const enrichedChat = {
		...resolvedChat,
		trace: {
			route: resolvedChat.trace?.route ?? 'llm',
			semanticOverlayStatus: resolvedChat.trace?.semanticOverlayStatus ?? 'unknown',
			toolCalls: resolvedChat.trace?.toolCalls ?? [],
			sidebarAction: resolvedChat.trace?.sidebarAction ?? 'unchanged',
			supplementaryListAction: resolvedChat.trace?.supplementaryListAction ?? 'unchanged',
			historySourceUsed: resolvedChat.trace?.historySourceUsed ?? historyTrace.historySourceUsed,
			historyCompactionApplied:
				resolvedChat.trace?.historyCompactionApplied ?? historyTrace.historyCompactionApplied,
			plannerModel: resolvedChat.trace?.plannerModel ?? toolModel,
			replyModel,
			planningMode: resolvedChat.trace?.planningMode ?? 'single_tool',
			toolRoundsUsed: resolvedChat.trace?.toolRoundsUsed ?? 0,
			clarificationIssued: resolvedChat.trace?.clarificationIssued ?? false,
			composedToolChain: resolvedChat.trace?.composedToolChain ?? false
		}
	};

	if (localHistoryAction || presentationRestore) {
		await persistContextHistory({
			userId: executionContext.userId,
			request: {
				...request,
				message: transcript,
				selectedNodes: request.selectedNodes ?? []
			},
			response: enrichedChat,
			rawUserMessage: transcript
		});
	}

	await onEvent?.({
		type: 'chat',
		chat: enrichedChat
	});

	const audioResponse = await openai.audio.speech.create({
		model: getSpeechModel(),
		voice: getSpeechVoice(),
		input: enrichedChat.message.content,
		instructions:
			'Speak clearly, slightly briskly, and use full words. Do not say abbreviations like e.g., i.e., or etc.',
		response_format: DEFAULT_TTS_FORMAT,
		speed: DEFAULT_TTS_SPEED
	});
	const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
	const audioBase64 = audioBuffer.toString('base64');
	const audioMimeType = `audio/${DEFAULT_TTS_FORMAT}`;
	const audioVoice = getSpeechVoice();

	await onEvent?.({
		type: 'audio',
		audioBase64,
		audioMimeType,
		audioVoice
	});

	return {
		transcript,
		audioBase64,
		audioMimeType,
		audioVoice,
		chat: enrichedChat
	};
}

export async function createFooterAudioChatResponse(
	audioFile: File,
	request: Omit<FooterChatRequest, 'message'>,
	executionContext: FooterChatExecutionContext = {}
): Promise<FooterChatAudioResponse> {
	try {
		return await runFooterAudioChatPipeline(audioFile, request, executionContext);
	} catch (error) {
		throw normalizeAudioError(error);
	}
}

export function createFooterAudioChatEventStream(
	audioFile: File,
	request: Omit<FooterChatRequest, 'message'>,
	executionContext: FooterChatExecutionContext = {}
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();

	return new ReadableStream<Uint8Array>({
		start(controller) {
			const emit = async (event: FooterChatAudioStreamEvent): Promise<void> => {
				controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			};

			void (async () => {
				try {
					await runFooterAudioChatPipeline(audioFile, request, executionContext, emit);
					await emit({ type: 'complete' });
				} catch (error) {
					await emit({
						type: 'error',
						message: normalizeAudioError(error).message
					});
				} finally {
					controller.close();
				}
			})();
		}
	});
}
