import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = {
	OPENAI_API_KEY: 'test-key',
	OPENAI_MODEL: 'gpt-5.2',
	OPENAI_TOOL_MODEL: 'gpt-5.2-reasoner',
	OPENAI_REPLY_MODEL: 'gpt-4o-mini',
	OPENAI_AUDIO_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
	OPENAI_AUDIO_TTS_MODEL: 'gpt-4o-mini-tts',
	OPENAI_AUDIO_TTS_VOICE: 'alloy'
};

const createFooterChatResponseMock = vi.fn();
const transcriptionCreateMock = vi.fn();
const speechCreateMock = vi.fn();
const chatCompletionsCreateMock = vi.fn();
const resolveContextHistoryMock = vi.fn();
const persistContextHistoryMock = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: envMock
}));

vi.mock('./index', () => ({
	createFooterChatResponse: createFooterChatResponseMock
}));

vi.mock('$lib/server/connectors/context-history', () => ({
	resolveContextHistory: resolveContextHistoryMock,
	persistContextHistory: persistContextHistoryMock,
	buildHistoryTrace: (context: { sourceUsed: string; compactionApplied: boolean }) =>
		context.sourceUsed === 'none' && !context.compactionApplied
			? {}
			: {
					historySourceUsed: context.sourceUsed,
					historyCompactionApplied: context.compactionApplied
				}
}));

vi.mock('openai', () => {
	class APIError extends Error {}

	class OpenAI {
		static APIError = APIError;
		chat = {
			completions: {
				create: chatCompletionsCreateMock
			}
		};
		audio = {
			transcriptions: {
				create: transcriptionCreateMock
			},
			speech: {
				create: speechCreateMock
			}
		};
	}

	return { default: OpenAI };
});

describe('createFooterAudioChatResponse', () => {
	beforeEach(() => {
		envMock.OPENAI_MODEL = 'gpt-5.2';
		envMock.OPENAI_TOOL_MODEL = 'gpt-5.2-reasoner';
		envMock.OPENAI_REPLY_MODEL = 'gpt-4o-mini';
		createFooterChatResponseMock.mockReset();
		transcriptionCreateMock.mockReset();
		speechCreateMock.mockReset();
		chatCompletionsCreateMock.mockReset();
		resolveContextHistoryMock.mockReset();
		persistContextHistoryMock.mockReset();
		resolveContextHistoryMock.mockResolvedValue({
			historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
			compactionApplied: false,
			sourceUsed: 'none'
		});
	});

	it('transcribes, executes chat, and returns synthesized audio', async () => {
		const { createFooterAudioChatResponse } = await import('./audio');
		transcriptionCreateMock.mockResolvedValue({
			text: 'paint the body midnight purple'
		});
		createFooterChatResponseMock.mockResolvedValue({
			model: 'gpt-5.2',
			message: {
				role: 'assistant',
				content: 'Applied body paint.'
			},
			vehiclePatchAssetId: 'audi_r8',
			vehiclePatchLabel: 'Applied body paint.',
			vehiclePatchOperations: [
				{
					targetType: 'material',
					targetId: 'material-1',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			]
		});
		speechCreateMock.mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: {
					'content-type': 'audio/mp3'
				}
			})
		);

		const response = await createFooterAudioChatResponse(
			new File([new Uint8Array([7, 8, 9])], 'voice.webm', { type: 'audio/webm' }),
			{
				assetId: 'audi_r8'
			},
			{
				userId: 'user-1'
			}
		);

		expect(transcriptionCreateMock).toHaveBeenCalledWith({
			file: expect.any(File),
			model: 'gpt-4o-mini-transcribe'
		});
		expect(createFooterChatResponseMock).toHaveBeenCalledWith({
			assetId: 'audi_r8',
			message: 'paint the body midnight purple'
		}, {
			userId: 'user-1',
			resolvedHistoryContext: {
				historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
				compactionApplied: false,
				sourceUsed: 'none'
			}
		});
		expect(speechCreateMock).toHaveBeenCalledWith({
			model: 'gpt-4o-mini-tts',
			voice: 'alloy',
			input: 'Applied body paint.',
			instructions:
				'Speak clearly, slightly briskly, and use full words. Do not say abbreviations like e.g., i.e., or etc.',
			response_format: 'mp3',
			speed: 1.15
		});
		expect(response.transcript).toBe('paint the body midnight purple');
		expect(response.chat.message.content).toBe('Applied body paint.');
		expect(response.audioBase64).toBe(Buffer.from([1, 2, 3]).toString('base64'));
		expect(response.chat.trace?.replyModel).toBe('gpt-4o-mini');
	});

	it('streams live audio events in order without requiring a conversation id', async () => {
		const { createFooterAudioChatEventStream } = await import('./audio');
		transcriptionCreateMock.mockResolvedValue({
			text: 'highlight the front lights'
		});
		createFooterChatResponseMock.mockResolvedValue({
			model: 'gpt-5.2',
			message: {
				role: 'assistant',
				content: 'Front lighting highlighted.'
			},
			vehiclePatchAssetId: 'audi_r8',
			vehiclePatchLabel: 'Front lighting highlighted.',
			vehiclePatchOperations: [
				{
					targetType: 'material',
					targetId: 'material-7',
					op: 'set_overlay_highlight',
					value: [0.9, 0.8, 0.4, 1]
				}
			]
		});
		speechCreateMock.mockResolvedValue(
			new Response(new Uint8Array([9, 8, 7]), {
				headers: {
					'content-type': 'audio/mp3'
				}
			})
		);

		const stream = createFooterAudioChatEventStream(
			new File([new Uint8Array([7, 8, 9])], 'voice.webm', { type: 'audio/webm' }),
			{
				assetId: 'audi_r8'
			},
			{
				userId: 'user-1'
			}
		);

		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let raw = '';

		while (true) {
			const { done, value } = await reader.read();
			raw += decoder.decode(value ?? new Uint8Array(), { stream: !done });
			if (done) {
				break;
			}
		}

		const events = raw
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { type: string; transcript?: string; chat?: { message: { content: string } } });

		expect(events.map((event) => event.type)).toEqual([
			'started',
			'transcribed',
			'chat',
			'audio',
			'complete'
		]);
		expect(events[1]?.transcript).toBe('highlight the front lights');
		expect(events[2]?.chat?.message.content).toBe('Front lighting highlighted.');
		expect(createFooterChatResponseMock).toHaveBeenCalledWith({
			assetId: 'audi_r8',
			message: 'highlight the front lights'
		}, {
			userId: 'user-1',
			resolvedHistoryContext: {
				historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
				compactionApplied: false,
				sourceUsed: 'none'
			}
		});
	});

	it('maps local history commands without hitting the text chat executor', async () => {
		const { createFooterAudioChatResponse } = await import('./audio');
		transcriptionCreateMock.mockResolvedValue({
			text: 'undo'
		});
		chatCompletionsCreateMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: 'Reverted the most recent change.'
					}
				}
			]
		});
		speechCreateMock.mockResolvedValue(new Response(new Uint8Array([4, 5, 6])));

		const response = await createFooterAudioChatResponse(
			new File([new Uint8Array([1])], 'voice.webm', { type: 'audio/webm' }),
			{
				assetId: 'audi_r8'
			}
		);

		expect(createFooterChatResponseMock).not.toHaveBeenCalled();
		expect(response.chat.historyAction).toBe('undo');
		expect(response.chat.message.content).toBe('Reverted the most recent change.');
		expect(chatCompletionsCreateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'gpt-4o-mini'
			})
		);
		expect(response.chat.trace?.plannerModel).toBe('gpt-5.2-reasoner');
		expect(response.chat.trace?.replyModel).toBe('gpt-4o-mini');
	});

	it('falls back to the tool model when OPENAI_REPLY_MODEL is unset', async () => {
		envMock.OPENAI_REPLY_MODEL = '';
		const { createFooterAudioChatResponse } = await import('./audio');
		transcriptionCreateMock.mockResolvedValue({
			text: 'undo'
		});
		chatCompletionsCreateMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: 'Reverted the most recent change.'
					}
				}
			]
		});
		speechCreateMock.mockResolvedValue(new Response(new Uint8Array([4, 5, 6])));

		const response = await createFooterAudioChatResponse(
			new File([new Uint8Array([1])], 'voice.webm', { type: 'audio/webm' }),
			{
				assetId: 'audi_r8'
			}
		);

		expect(chatCompletionsCreateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'gpt-5.2-reasoner'
			})
		);
		expect(response.chat.trace?.replyModel).toBe('gpt-5.2-reasoner');
	});

	it('treats revert all as a full reset instead of a generic undo', async () => {
		const { createFooterAudioChatResponse } = await import('./audio');
		transcriptionCreateMock.mockResolvedValue({
			text: 'revert all changes'
		});
		chatCompletionsCreateMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: 'Everything is back to the original state.'
					}
				}
			]
		});
		speechCreateMock.mockResolvedValue(new Response(new Uint8Array([4, 5, 6])));

		const response = await createFooterAudioChatResponse(
			new File([new Uint8Array([1])], 'voice.webm', { type: 'audio/webm' }),
			{
				assetId: 'audi_r8'
			}
		);

		expect(createFooterChatResponseMock).not.toHaveBeenCalled();
		expect(response.chat.historyAction).toBe('reset');
		expect(response.chat.message.content).toBe('Everything is back to the original state.');
	});

	it('short-circuits deterministic restore requests from current presentation context', async () => {
		const { createFooterAudioChatResponse } = await import('./audio');
		transcriptionCreateMock.mockResolvedValue({
			text: 'restore the wireframe view'
		});
		chatCompletionsCreateMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: 'Wireframe has been cleared.'
					}
				}
			]
		});
		speechCreateMock.mockResolvedValue(new Response(new Uint8Array([4, 5, 6])));

		const response = await createFooterAudioChatResponse(
			new File([new Uint8Array([1])], 'voice.webm', { type: 'audio/webm' }),
			{
				assetId: 'audi_r8',
				presentation: {
					viewerModes: ['wireframe']
				}
			}
		);

		expect(createFooterChatResponseMock).not.toHaveBeenCalled();
		expect(response.chat.presentationRestore).toEqual({
			viewerModes: ['wireframe'],
			label: 'restore original view'
		});
	});

	it('passes sidebar context through to the text chat executor', async () => {
		const { createFooterAudioChatResponse } = await import('./audio');
		transcriptionCreateMock.mockResolvedValue({
			text: 'summarize the current focus'
		});
		createFooterChatResponseMock.mockResolvedValue({
			model: 'gpt-5.2',
			message: {
				role: 'assistant',
				content: 'Focus remains on the shell.'
			}
		});
		speechCreateMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

		await createFooterAudioChatResponse(
			new File([new Uint8Array([7, 8, 9])], 'voice.webm', { type: 'audio/webm' }),
			{
				assetId: 'audi_r8',
				sidebar: {
					active: true,
					cards: [
						{
							title: 'Focus',
							entries: {
								target: 'Body Shell'
							}
						}
					]
				}
			}
		);

		expect(createFooterChatResponseMock).toHaveBeenCalledWith({
			assetId: 'audi_r8',
			sidebar: {
				active: true,
				cards: [
					{
						title: 'Focus',
						entries: {
							target: 'Body Shell'
						}
					}
				]
			},
			message: 'summarize the current focus'
		}, {
			resolvedHistoryContext: {
				historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
				compactionApplied: false,
				sourceUsed: 'none'
			}
		});
	});
});
