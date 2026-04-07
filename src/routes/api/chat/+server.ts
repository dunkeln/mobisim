import { json } from '@sveltejs/kit';
import {
	createFooterChatResponse,
	OpenAIChatConfigError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from '$lib/server/connectors/openai-chat';
import type { FooterChatRequest } from '$lib/server/connectors/openai-chat/types';

export async function POST({ request }) {
	let payload: FooterChatRequest;

	try {
		payload = (await request.json()) as FooterChatRequest;
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	try {
		const response = await createFooterChatResponse(payload);
		return json(response);
	} catch (error) {
		if (error instanceof OpenAIChatInputError) {
			return json({ error: error.message }, { status: 400 });
		}

		if (error instanceof OpenAIChatConfigError) {
			console.error('chat config error', error.message);
			return json({ error: error.message }, { status: 500 });
		}

		if (error instanceof OpenAIChatUpstreamError) {
			console.error('chat upstream error', error.message);
			return json({ error: error.message }, { status: 502 });
		}

		console.error('chat unknown error', error);
		return json({ error: 'Chat request failed.' }, { status: 500 });
	}
}
