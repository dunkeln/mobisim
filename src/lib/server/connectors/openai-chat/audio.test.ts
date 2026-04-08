import { beforeEach, describe, expect, it, vi } from 'vitest';

const createFooterChatResponseMock = vi.fn();
const transcriptionCreateMock = vi.fn();
const speechCreateMock = vi.fn();
const chatCompletionsCreateMock = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: {
		OPENAI_API_KEY: 'test-key',
		OPENAI_MODEL: 'gpt-5.2',
		OPENAI_AUDIO_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
		OPENAI_AUDIO_TTS_MODEL: 'gpt-4o-mini-tts',
		OPENAI_AUDIO_TTS_VOICE: 'alloy'
	}
}));

vi.mock('./index', () => ({
	createFooterChatResponse: createFooterChatResponseMock
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
		createFooterChatResponseMock.mockReset();
		transcriptionCreateMock.mockReset();
		speechCreateMock.mockReset();
		chatCompletionsCreateMock.mockReset();
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
			}
		);

		expect(transcriptionCreateMock).toHaveBeenCalledWith({
			file: expect.any(File),
			model: 'gpt-4o-mini-transcribe'
		});
		expect(createFooterChatResponseMock).toHaveBeenCalledWith({
			assetId: 'audi_r8',
			message: 'paint the body midnight purple'
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
		});
	});
});
