import { json } from '@sveltejs/kit';
import { createFooterAudioChatResponse } from '$lib/server/connectors/openai-chat/audio';
import {
	OpenAIChatConfigError,
	OpenAIChatInputError,
	OpenAIChatUpstreamError
} from '$lib/server/connectors/openai-chat';
import type { FooterChatRequest } from '$lib/server/connectors/openai-chat/types';

function readStringField(value: FormDataEntryValue | null): string | undefined {
	return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function readJsonField<T>(value: FormDataEntryValue | null, fallback: T): T {
	if (typeof value !== 'string' || value.trim().length === 0) {
		return fallback;
	}

	if (value.trim() === 'undefined' || value.trim() === 'null') {
		return fallback;
	}

	return JSON.parse(value) as T;
}

export async function POST({ request }) {
	let formData: FormData;

	try {
		formData = await request.formData();
	} catch {
		return json({ error: 'Invalid form body.' }, { status: 400 });
	}

	const audio = formData.get('audio');
	if (!(audio instanceof File)) {
		return json({ error: 'Audio file is required.' }, { status: 400 });
	}

	let payload: Omit<FooterChatRequest, 'message'>;

	try {
		payload = {
			assetId: readStringField(formData.get('assetId')) as FooterChatRequest['assetId'],
			selectedNodeId: readStringField(formData.get('selectedNodeId')),
			selectedNodeName: readStringField(formData.get('selectedNodeName')),
			selectedNodePath: readStringField(formData.get('selectedNodePath')),
			selectedNodes: readJsonField(formData.get('selectedNodes'), []),
			presentation: readJsonField(formData.get('presentation'), undefined),
			sidebar: readJsonField(formData.get('sidebar'), undefined),
			supplementaryList: readJsonField(formData.get('supplementaryList'), undefined)
		};
	} catch {
		return json({ error: 'Invalid audio chat metadata.' }, { status: 400 });
	}

	try {
		const response = await createFooterAudioChatResponse(audio, payload);
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
		return json({ error: 'Audio chat request failed.' }, { status: 500 });
	}
}
