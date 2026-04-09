import { env } from '$env/dynamic/private';
import { DEFAULT_MODEL } from './internal';

const DEFAULT_REPLY_MODEL = 'gpt-4o-mini';

export function getToolModel(): string {
	return env.OPENAI_TOOL_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function getReplyModel(): string {
	return env.OPENAI_REPLY_MODEL || getToolModel() || DEFAULT_REPLY_MODEL;
}

export function getLegacyModel(): string {
	return env.OPENAI_MODEL || DEFAULT_MODEL;
}
