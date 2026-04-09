import { json } from '@sveltejs/kit';
import { createFooterAudioChatResponse } from '$lib/server/connectors/openai-chat/audio';
import { parseFooterAudioChatFormData } from '$lib/server/connectors/openai-chat/audio-request';
import {
	OpenAIChatConfigError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from '$lib/server/connectors/openai-chat';
import { resolveAuthenticatedUserId } from '$lib/server/auth/identity';

export async function POST({ request, locals }) {
	let formData: FormData;

	try {
		formData = await request.formData();
	} catch {
		return json({ error: 'Invalid form body.' }, { status: 400 });
	}

	let audio: File;
	let payload;

	try {
		({ audio, payload } = parseFooterAudioChatFormData(formData));
	} catch (error) {
		return json(
			{
				error: error instanceof Error ? error.message : 'Invalid audio chat request.'
			},
			{ status: 400 }
		);
	}

	try {
		const session = await locals.auth();
		const response = await createFooterAudioChatResponse(audio, payload, {
			userId: resolveAuthenticatedUserId(session)
		});
		return json(response);
	} catch (error) {
		if (error instanceof OpenAIChatInputError) {
			return json({ error: error.message }, { status: 400 });
		}

		if (error instanceof OpenAIChatConfigError) {
			console.error('chat audio config error', error.message);
			return json({ error: error.message }, { status: 500 });
		}

		if (error instanceof OpenAIChatUpstreamError) {
			console.error('chat audio upstream error', error.message);
			return json({ error: error.message }, { status: 502 });
		}

		console.error('chat audio unknown error', error);
		return json(
			{
				error: error instanceof Error ? error.message : 'Audio chat request failed.'
			},
			{ status: 500 }
		);
	}
}
