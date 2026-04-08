import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { OpenAIChatConfigError } from './errors';

let client: OpenAI | null = null;

export function getOpenAIChatClient(): OpenAI {
	if (!env.OPENAI_API_KEY) {
		throw new OpenAIChatConfigError('OPENAI_API_KEY is not configured.');
	}

	client ??= new OpenAI({
		apiKey: env.OPENAI_API_KEY
	});

	return client;
}
