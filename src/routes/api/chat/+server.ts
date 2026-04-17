import { json } from '@sveltejs/kit';
import {
	createFooterChatResponse,
	OpenAIChatConfigError,
	OpenAIChatExecutionError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from '$lib/server/connectors/openai-chat';
import type { FooterChatRequest } from '$lib/server/connectors/openai-chat/types';
import { resolveAuthenticatedUserId } from '$lib/server/auth/identity';

export async function POST({ request, locals }) {
	let payload: FooterChatRequest;

	try {
		payload = (await request.json()) as FooterChatRequest;
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	try {
		const session = await locals.auth();
		const response = await createFooterChatResponse(payload, {
			userId: resolveAuthenticatedUserId(session)
		});
		return json(response);
	} catch (error) {
		if (error instanceof OpenAIChatInputError) {
			return json({ error: error.message }, { status: 400 });
		}

		if (error instanceof OpenAIChatConfigError) {
			console.error('chat config error', error.message);
			return json({ error: error.message }, { status: 500 });
		}

		if (error instanceof OpenAIChatExecutionError) {
			console.error('chat execution error', error.message);
			return json({ error: error.message }, { status: 500 });
		}

		if (error instanceof OpenAIChatUpstreamError) {
			console.error('chat upstream error', error.message);
			return json({ error: error.message }, { status: 502 });
		}

		console.error('chat unknown error', error);
		return json(
			{
				error: error instanceof Error ? error.message : 'Chat request failed.'
			},
			{ status: 500 }
		);
	}
}
