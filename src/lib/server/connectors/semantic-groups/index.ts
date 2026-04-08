import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSemanticGroupDefinitionsPath } from '$lib/server/connectors/vehicle-registry/storage';
import type {
	VehicleSemanticActionSupport,
	VehicleSemanticGroup
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type {
	SemanticGroupAssignmentMode,
	SemanticGroupDefinition,
	SemanticGroupDefinitionsStore
} from './types';

const DEFAULT_DEFINITIONS: SemanticGroupDefinition[] = [
	{
		id: 'wheels',
		humanLabel: 'wheels',
		aliases: ['wheel', 'rim', 'rims', 'tires'],
		category: 'wheels',
		supports: ['focus', 'highlight', 'isolate'],
		assignmentMode: 'exclusive',
		exclusiveFamily: 'primary_component'
	},
	{
		id: 'doors',
		humanLabel: 'doors',
		aliases: ['door'],
		category: 'doors',
		supports: ['focus', 'highlight', 'isolate'],
		assignmentMode: 'exclusive',
		exclusiveFamily: 'primary_component'
	},
	{
		id: 'front_lighting',
		humanLabel: 'front lighting',
		aliases: ['headlights', 'headlight'],
		category: 'front_lighting',
		supports: ['focus', 'highlight', 'isolate'],
		assignmentMode: 'exclusive',
		exclusiveFamily: 'lighting'
	},
	{
		id: 'rear_lighting',
		humanLabel: 'rear lighting',
		aliases: ['taillights', 'taillight', 'rear lights'],
		category: 'rear_lighting',
		supports: ['focus', 'highlight', 'isolate'],
		assignmentMode: 'exclusive',
		exclusiveFamily: 'lighting'
	},
	{
		id: 'glasshouse',
		humanLabel: 'glasshouse',
		aliases: ['glass', 'windows', 'window'],
		category: 'glasshouse',
		supports: ['focus', 'highlight', 'isolate', 'tint'],
		assignmentMode: 'overlay'
	},
	{
		id: 'body_shell',
		humanLabel: 'body shell',
		aliases: ['body', 'paint'],
		category: 'body_shell',
		supports: ['focus', 'highlight', 'isolate', 'paint'],
		assignmentMode: 'overlay'
	},
	{
		id: 'front_face',
		humanLabel: 'front face',
		aliases: ['front end', 'nose', 'grille'],
		category: 'front_face',
		supports: ['focus', 'highlight', 'isolate'],
		assignmentMode: 'overlay'
	},
	{
		id: 'trim',
		humanLabel: 'trim',
		aliases: ['accent trim'],
		category: 'trim',
		supports: ['focus', 'highlight', 'isolate'],
		assignmentMode: 'overlay'
	},
	{
		id: 'interior',
		humanLabel: 'interior',
		aliases: ['cabin'],
		category: 'interior',
		supports: ['focus', 'highlight', 'isolate'],
		assignmentMode: 'overlay'
	}
];

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return Array.from(
		new Set(
			value
				.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
				.filter((entry) => entry.length > 0)
		)
	).sort((left, right) => left.localeCompare(right));
}

function isGroupCategory(value: unknown): value is VehicleSemanticGroup['category'] {
	return (
		value === 'wheels' ||
		value === 'doors' ||
		value === 'front_lighting' ||
		value === 'rear_lighting' ||
		value === 'glasshouse' ||
		value === 'body_shell' ||
		value === 'front_face' ||
		value === 'trim' ||
		value === 'interior' ||
		value === 'other'
	);
}

function isActionSupport(value: unknown): value is VehicleSemanticActionSupport {
	return (
		value === 'highlight' ||
		value === 'focus' ||
		value === 'isolate' ||
		value === 'paint' ||
		value === 'tint'
	);
}

function isAssignmentMode(value: unknown): value is SemanticGroupAssignmentMode {
	return value === 'exclusive' || value === 'overlay';
}

function normalizeDefinition(value: unknown): SemanticGroupDefinition | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
	const humanLabel = typeof candidate.humanLabel === 'string' ? candidate.humanLabel.trim() : '';
	const aliases = normalizeStringArray(candidate.aliases);
	const category = isGroupCategory(candidate.category) ? candidate.category : null;
	const supports = Array.isArray(candidate.supports)
		? Array.from(new Set(candidate.supports.filter(isActionSupport))).sort((left, right) =>
				left.localeCompare(right)
			)
		: [];
	const assignmentMode = isAssignmentMode(candidate.assignmentMode)
		? candidate.assignmentMode
		: null;
	const exclusiveFamily =
		typeof candidate.exclusiveFamily === 'string' && candidate.exclusiveFamily.trim().length > 0
			? candidate.exclusiveFamily.trim()
			: undefined;

	if (!id || !humanLabel || !category || supports.length === 0 || !assignmentMode) {
		return null;
	}

	return {
		id,
		humanLabel,
		aliases,
		category,
		supports,
		assignmentMode,
		exclusiveFamily
	};
}

function validateDefinitions(definitions: SemanticGroupDefinition[]): SemanticGroupDefinition[] {
	const unique = new Map<string, SemanticGroupDefinition>();

	for (const definition of definitions) {
		if (!unique.has(definition.id)) {
			unique.set(definition.id, definition);
		}
	}

	return Array.from(unique.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function slugify(input: string): string {
	return input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function normalizeLookupKey(value: string): string {
	return slugify(value);
}

export async function readSemanticGroupDefinitions(): Promise<SemanticGroupDefinitionsStore> {
	try {
		const raw = JSON.parse(await readFile(resolveSemanticGroupDefinitionsPath(), 'utf8')) as {
			definitions?: unknown[];
		};
		const normalized = Array.isArray(raw.definitions)
			? raw.definitions
					.map((entry) => normalizeDefinition(entry))
					.filter((entry): entry is SemanticGroupDefinition => entry !== null)
			: [];
		return {
			definitions: validateDefinitions([...DEFAULT_DEFINITIONS, ...normalized])
		};
	} catch {
		return {
			definitions: [...DEFAULT_DEFINITIONS]
		};
	}
}

export async function writeSemanticGroupDefinitions(
	store: SemanticGroupDefinitionsStore
): Promise<SemanticGroupDefinitionsStore> {
	const nextStore = {
		definitions: validateDefinitions(store.definitions)
	};
	const targetPath = resolveSemanticGroupDefinitionsPath();
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, JSON.stringify(nextStore, null, 2), 'utf8');
	return nextStore;
}

export async function ensureSemanticGroupDefinition(input: {
	category: VehicleSemanticGroup['category'];
	humanLabel?: string;
	aliases?: string[];
}): Promise<SemanticGroupDefinition> {
	const store = await readSemanticGroupDefinitions();

	if (input.category !== 'other') {
		const existing = store.definitions.find((definition) => definition.category === input.category);
		if (existing) {
			return existing;
		}
	}

	const humanLabel = input.humanLabel?.trim() || input.category.replaceAll('_', ' ');
	const id =
		input.category === 'other' ? `other_${slugify(humanLabel) || 'group'}` : input.category;
	const existingById = store.definitions.find((definition) => definition.id === id);
	if (existingById) {
		return existingById;
	}

	const definition: SemanticGroupDefinition = {
		id,
		humanLabel,
		aliases: normalizeStringArray(input.aliases),
		category: input.category,
		supports:
			input.category === 'glasshouse'
				? ['focus', 'highlight', 'isolate', 'tint']
				: input.category === 'body_shell'
					? ['focus', 'highlight', 'isolate', 'paint']
					: ['focus', 'highlight', 'isolate'],
		assignmentMode: input.category === 'other' ? 'overlay' : 'overlay'
	};

	await writeSemanticGroupDefinitions({
		definitions: [...store.definitions, definition]
	});

	return definition;
}

export async function resolveSemanticGroupDefinition(input: {
	semanticGroup?: string;
	category?: VehicleSemanticGroup['category'];
	humanLabel?: string;
	aliases?: string[];
}): Promise<SemanticGroupDefinition> {
	if (input.category) {
		return ensureSemanticGroupDefinition({
			category: input.category,
			humanLabel: input.humanLabel,
			aliases: input.aliases
		});
	}

	const semanticGroup = input.semanticGroup?.trim();
	if (!semanticGroup) {
		throw new Error('A semantic group name or category is required.');
	}

	const lookupKey = normalizeLookupKey(semanticGroup);
	const store = await readSemanticGroupDefinitions();
	const matched = store.definitions.find((definition) => {
		const keys = [definition.id, definition.humanLabel, ...definition.aliases].map((value) =>
			normalizeLookupKey(value)
		);
		return keys.includes(lookupKey);
	});

	if (matched) {
		return matched;
	}

	return ensureSemanticGroupDefinition({
		category: 'other',
		humanLabel: input.humanLabel?.trim() || semanticGroup,
		aliases: Array.from(new Set([semanticGroup, ...(input.aliases ?? [])]))
	});
}

export async function findSemanticGroupDefinition(input: {
	semanticGroup?: string;
	category?: VehicleSemanticGroup['category'];
}): Promise<SemanticGroupDefinition | null> {
	const store = await readSemanticGroupDefinitions();

	if (input.category) {
		return (
			store.definitions.find((definition) => definition.category === input.category) ?? null
		);
	}

	const semanticGroup = input.semanticGroup?.trim();
	if (!semanticGroup) {
		return null;
	}

	const lookupKey = normalizeLookupKey(semanticGroup);
	return (
		store.definitions.find((definition) => {
			const keys = [definition.id, definition.humanLabel, ...definition.aliases].map((value) =>
				normalizeLookupKey(value)
			);
			return keys.includes(lookupKey);
		}) ?? null
	);
}
