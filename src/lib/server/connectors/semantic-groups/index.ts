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
		aliases: ['headlights', 'headlight', 'front lights', 'front light', 'frontlights', 'frontlight'],
		category: 'front_lighting',
		supports: ['focus', 'highlight', 'isolate'],
		assignmentMode: 'exclusive',
		exclusiveFamily: 'lighting'
	},
	{
		id: 'rear_lighting',
		humanLabel: 'rear lighting',
		aliases: [
			'taillights',
			'taillight',
			'rear lights',
			'rear light',
			'backlights',
			'backlight',
			'brake lights',
			'brake light'
		],
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
		unique.set(definition.id, definition);
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

function inferCanonicalCategoryFromReference(
	value: string | undefined
): VehicleSemanticGroup['category'] | null {
	const lookupKey = normalizeLookupKey(value ?? '');
	if (!lookupKey) {
		return null;
	}

	if (
		lookupKey === 'front_lighting' ||
		lookupKey === 'front_lights' ||
		lookupKey === 'front_light' ||
		lookupKey === 'frontlights' ||
		lookupKey === 'frontlight' ||
		lookupKey === 'headlights' ||
		lookupKey === 'headlight'
	) {
		return 'front_lighting';
	}

	if (
		lookupKey === 'rear_lighting' ||
		lookupKey === 'rear_lights' ||
		lookupKey === 'rear_light' ||
		lookupKey === 'backlights' ||
		lookupKey === 'backlight' ||
		lookupKey === 'taillights' ||
		lookupKey === 'taillight' ||
		lookupKey === 'brake_lights' ||
		lookupKey === 'brake_light'
	) {
		return 'rear_lighting';
	}

	return null;
}

function defaultSupportsForCategory(
	category: VehicleSemanticGroup['category']
): VehicleSemanticActionSupport[] {
	if (category === 'glasshouse') {
		return ['focus', 'highlight', 'isolate', 'tint'];
	}

	if (category === 'body_shell') {
		return ['focus', 'highlight', 'isolate', 'paint'];
	}

	return ['focus', 'highlight', 'isolate'];
}

function resolveDefinitionReference(
	store: SemanticGroupDefinitionsStore,
	input: {
		id?: string;
		semanticGroup?: string;
		category?: VehicleSemanticGroup['category'];
	}
): SemanticGroupDefinition | null {
	if (input.id?.trim()) {
		return store.definitions.find((definition) => definition.id === input.id?.trim()) ?? null;
	}

	if (input.category) {
		return store.definitions.find((definition) => definition.category === input.category) ?? null;
	}

	const semanticGroup = input.semanticGroup?.trim();
	if (!semanticGroup) {
		return null;
	}

	const canonicalCategory = inferCanonicalCategoryFromReference(semanticGroup);
	if (canonicalCategory) {
		return store.definitions.find((definition) => definition.category === canonicalCategory) ?? null;
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
		supports: defaultSupportsForCategory(input.category),
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

	const canonicalCategory = inferCanonicalCategoryFromReference(semanticGroup);
	if (canonicalCategory) {
		return ensureSemanticGroupDefinition({
			category: canonicalCategory,
			humanLabel: input.humanLabel,
			aliases: input.aliases
		});
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
	id?: string;
	semanticGroup?: string;
	category?: VehicleSemanticGroup['category'];
}): Promise<SemanticGroupDefinition | null> {
	const store = await readSemanticGroupDefinitions();
	return resolveDefinitionReference(store, input);
}

export async function createSemanticGroupDefinition(input: {
	id?: string;
	humanLabel: string;
	aliases?: string[];
	category: VehicleSemanticGroup['category'];
	supports?: VehicleSemanticActionSupport[];
	assignmentMode?: SemanticGroupAssignmentMode;
	exclusiveFamily?: string;
}): Promise<SemanticGroupDefinition> {
	const humanLabel = input.humanLabel.trim();
	if (!humanLabel) {
		throw new Error('A semantic group label is required.');
	}

	const store = await readSemanticGroupDefinitions();
	const id = input.id?.trim() || slugify(humanLabel) || 'semantic_group';
	if (store.definitions.some((definition) => definition.id === id)) {
		throw new Error(`Semantic group ${id} already exists.`);
	}

	const definition: SemanticGroupDefinition = {
		id,
		humanLabel,
		aliases: normalizeStringArray(input.aliases),
		category: input.category,
		supports:
			input.supports && input.supports.length > 0
				? Array.from(new Set(input.supports)).sort((left, right) => left.localeCompare(right))
				: defaultSupportsForCategory(input.category),
		assignmentMode: input.assignmentMode ?? 'overlay',
		exclusiveFamily:
			typeof input.exclusiveFamily === 'string' && input.exclusiveFamily.trim().length > 0
				? input.exclusiveFamily.trim()
				: undefined
	};

	await writeSemanticGroupDefinitions({
		definitions: [...store.definitions, definition]
	});

	return definition;
}

export async function patchSemanticGroupDefinition(input: {
	id?: string;
	semanticGroup?: string;
	category?: VehicleSemanticGroup['category'];
	humanLabel?: string;
	aliases?: string[];
	supports?: VehicleSemanticActionSupport[];
	assignmentMode?: SemanticGroupAssignmentMode;
	exclusiveFamily?: string | null;
}): Promise<SemanticGroupDefinition> {
	const store = await readSemanticGroupDefinitions();
	const existing = resolveDefinitionReference(store, input);
	if (!existing) {
		throw new Error('Semantic group definition was not found.');
	}

	const nextDefinition: SemanticGroupDefinition = {
		...existing,
		humanLabel:
			typeof input.humanLabel === 'string' && input.humanLabel.trim().length > 0
				? input.humanLabel.trim()
				: existing.humanLabel,
		aliases: input.aliases ? normalizeStringArray(input.aliases) : existing.aliases,
		category: input.category ?? existing.category,
		supports:
			input.supports && input.supports.length > 0
				? Array.from(new Set(input.supports)).sort((left, right) => left.localeCompare(right))
				: existing.supports,
		assignmentMode: input.assignmentMode ?? existing.assignmentMode,
		exclusiveFamily:
			input.exclusiveFamily === null
				? undefined
				: typeof input.exclusiveFamily === 'string' && input.exclusiveFamily.trim().length > 0
					? input.exclusiveFamily.trim()
					: existing.exclusiveFamily
	};

	await writeSemanticGroupDefinitions({
		definitions: store.definitions.map((definition) =>
			definition.id === existing.id ? nextDefinition : definition
		)
	});

	return nextDefinition;
}

export async function deleteSemanticGroupDefinition(input: {
	id?: string;
	semanticGroup?: string;
	category?: VehicleSemanticGroup['category'];
}): Promise<SemanticGroupDefinition> {
	const store = await readSemanticGroupDefinitions();
	const existing = resolveDefinitionReference(store, input);
	if (!existing) {
		throw new Error('Semantic group definition was not found.');
	}

	if (DEFAULT_DEFINITIONS.some((definition) => definition.id === existing.id)) {
		throw new Error(
			'Built-in semantic group definitions cannot be deleted. Remove asset assignments instead.'
		);
	}

	await writeSemanticGroupDefinitions({
		definitions: store.definitions.filter((definition) => definition.id !== existing.id)
	});

	return existing;
}
