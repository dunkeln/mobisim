import { env } from '$env/dynamic/private';
import type { ContextHistoryConfig } from './types';

const DEFAULT_EVENT_TTL_DAYS = 30;
const DEFAULT_TOKEN_BUDGET = 600;
const DEFAULT_REGION = 'us-west-2';

function readPositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getContextHistoryConfig(): ContextHistoryConfig {
	const store = env.CONTEXT_HISTORY_STORE?.trim().toLowerCase();
	const tableName = env.CONTEXT_HISTORY_TABLE?.trim();
	const enabled = store === 'dynamodb' && !!tableName;

	return {
		enabled,
		store: 'dynamodb',
		region: env.AWS_REGION?.trim() || DEFAULT_REGION,
		tableName: tableName || 'mobisim-context-history',
		endpoint: env.DYNAMODB_ENDPOINT?.trim() || undefined,
		eventTtlDays: readPositiveInteger(env.CONTEXT_HISTORY_EVENT_TTL_DAYS, DEFAULT_EVENT_TTL_DAYS),
		tokenBudget: readPositiveInteger(env.CONTEXT_HISTORY_TOKEN_BUDGET, DEFAULT_TOKEN_BUDGET),
		rawRetentionEnabled:
			env.CONTEXT_HISTORY_RAW_RETENTION_ENABLED === 'true' ||
			env.CONTEXT_HISTORY_RAW_RETENTION_ENABLED === '1'
	};
}
