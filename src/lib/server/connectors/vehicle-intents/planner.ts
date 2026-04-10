import type {
	VehicleSemanticGroup,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehiclePlannerTargetExpression } from './types';

export function sanitizePlannerKeepQuery(query: string): string {
	return query
		.replace(/[,.;:]+/g, ' ')
		.replace(/\b(the|a|an|please|just)\b/gi, ' ')
		.replace(/\b(visible|left|remaining|remain|stays?|stay|kept|keep|too|highlighted)\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function splitPlannerKeepQueries(raw: string): string[] {
	return Array.from(
		new Set(
			raw
				.split(/\b(?:and|plus|along with|,)\b/gi)
				.map((value) => sanitizePlannerKeepQuery(value))
				.filter(Boolean)
		)
	);
}

export function buildPlannerUnionExpression(queries: string[]): VehiclePlannerTargetExpression {
	if (queries.length === 1) {
		return {
			kind: 'semantic_query',
			query: queries[0]!
		};
	}

	return {
		kind: 'union',
		items: queries.map((query) => ({
			kind: 'semantic_query' as const,
			query
		}))
	};
}

export function extractRemoveOverrideQueries(request: string): string[] {
	const match =
		request.match(/\bbut\s+remove\s+(.+)$/i) ??
		request.match(/\bexcept\s+keep\s+.+\bbut\s+strip out\s+(.+)$/i);

	return match ? splitPlannerKeepQueries(match[1] ?? '') : [];
}

export function extractRemoveAllExceptExpression(request: string): VehiclePlannerTargetExpression | null {
	const trimmed = request.trim();
	const baseRequest = trimmed.replace(/\bbut\s+remove\s+.+$/i, '').trim();
	const matches = [
		baseRequest.match(
			/\b(?:remove|strip out|take out|pull out)\b.*\b(?:everything|everything else|all|the rest)\b.*\b(?:except|but|besides)\b\s+(.+)$/i
		),
		baseRequest.match(
			/\b(?:remove|strip out|take out|pull out)\b.*\b(?:everything|everything else|all|the rest)\b.*\bkeep\b\s+(.+)$/i
		),
		baseRequest.match(/\b(?:keep only|only keep|show only|only show)\b\s+(.+)$/i)
	];

	for (const match of matches) {
		const candidates = splitPlannerKeepQueries(match?.[1] ?? '');
		if (candidates.length > 0) {
			const baseExpression = buildPlannerUnionExpression(candidates);
			const overrideQueries = extractRemoveOverrideQueries(trimmed);
			if (overrideQueries.length === 0) {
				return baseExpression;
			}

			return {
				kind: 'subtract',
				left: baseExpression,
				right: buildPlannerUnionExpression(overrideQueries)
			};
		}
	}

	return null;
}

export function flattenSemanticQueries(expression: VehiclePlannerTargetExpression): string[] {
	if (expression.kind === 'semantic_query') {
		return [expression.query];
	}

	if (expression.kind === 'highlighted_materials') {
		return [];
	}

	if (expression.kind === 'union') {
		return Array.from(new Set(expression.items.flatMap((item) => flattenSemanticQueries(item))));
	}

	return Array.from(
		new Set([
			...flattenSemanticQueries(expression.left),
			...flattenSemanticQueries(expression.right)
		])
	);
}

export function tokenizeSemanticQuery(value: string): string[] {
	return Array.from(
		new Set(
			value
				.toLowerCase()
				.split(/[^a-z0-9]+/)
				.map((term) => term.trim())
				.filter((term) => term.length > 0)
		)
	);
}

export function scoreSemanticEntityMatch(
	entity:
		| Pick<VehicleSemanticGroup, 'id' | 'humanLabel' | 'aliases'>
		| Pick<VehicleSemanticPartUnit, 'id' | 'humanLabel' | 'aliases'>,
	query: string
): number {
	const normalizedQuery = query.trim().toLowerCase();
	const queryTerms = tokenizeSemanticQuery(query);
	const entityTerms = [
		entity.id.replaceAll('_', ' ').replaceAll('-', ' '),
		entity.humanLabel,
		...entity.aliases
	].map((value) => value.toLowerCase());
	const combined = entityTerms.join(' ');
	let score = 0;

	if (entityTerms.includes(normalizedQuery)) {
		score += 100;
	}

	if (entityTerms.some((value) => value.includes(normalizedQuery))) {
		score += 40;
	}

	score += queryTerms.reduce((total, term) => total + (combined.includes(term) ? 10 : 0), 0);

	return score;
}
