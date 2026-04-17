import { json } from '@sveltejs/kit';
import { createRealtimeClientSecret } from '$lib/server/connectors/openai-chat/realtime';
import { resolveAuthenticatedUserId } from '$lib/server/auth/identity';
import {
	OpenAIChatConfigError,
	OpenAIChatExecutionError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from '$lib/server/connectors/openai-chat';
import type { FooterChatRequest } from '$lib/server/connectors/openai-chat/types';

type RealtimeSessionRequest = {
	assetId?: FooterChatRequest['assetId'];
	selectedGroupId?: FooterChatRequest['selectedGroupId'];
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
	selectedNodes?: FooterChatRequest['selectedNodes'];
	presentation?: FooterChatRequest['presentation'];
	sidebar?: FooterChatRequest['sidebar'];
	supplementaryList?: FooterChatRequest['supplementaryList'];
};

export async function POST({ request, locals }) {
	let payload: RealtimeSessionRequest;

	try {
		payload = (await request.json()) as RealtimeSessionRequest;
	} catch {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	try {
		const session = await locals.auth();
		const realtimeSession = await createRealtimeClientSecret({
			userId: resolveAuthenticatedUserId(session),
			assetId: payload.assetId,
			selectedGroupId: payload.selectedGroupId,
			selectedNodeId: payload.selectedNodeId,
			selectedNodeName: payload.selectedNodeName,
			selectedNodePath: payload.selectedNodePath,
			selectedNodes: payload.selectedNodes,
			presentation: payload.presentation,
			sidebar: payload.sidebar,
			supplementaryList: payload.supplementaryList
		});

		return json({
			clientSecret: realtimeSession.clientSecret,
			semanticOverlayStatus: realtimeSession.semanticOverlayStatus,
			instructions: realtimeSession.instructions,
			contextKey: realtimeSession.contextKey
		});
	} catch (error) {
		if (error instanceof OpenAIChatInputError) {
			return json({ error: error.message }, { status: 400 });
		}

		if (error instanceof OpenAIChatConfigError) {
			return json({ error: error.message }, { status: 500 });
		}

		if (error instanceof OpenAIChatExecutionError) {
			return json({ error: error.message }, { status: 500 });
		}

		if (error instanceof OpenAIChatUpstreamError) {
			return json({ error: error.message }, { status: 502 });
		}

		return json(
			{
				error: error instanceof Error ? error.message : 'Realtime session creation failed.'
			},
			{ status: 500 }
		);
	}
}
