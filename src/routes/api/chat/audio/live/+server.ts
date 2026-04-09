import { json } from '@sveltejs/kit';
import { createFooterAudioChatEventStream } from '$lib/server/connectors/openai-chat/audio';
import { parseFooterAudioChatFormData } from '$lib/server/connectors/openai-chat/audio-request';
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

	const session = await locals.auth();
	const stream = createFooterAudioChatEventStream(audio, payload, {
		userId: resolveAuthenticatedUserId(session)
	});

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
}
