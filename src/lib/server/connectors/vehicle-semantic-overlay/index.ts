import { env } from '$env/dynamic/private';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import {
	resolveSemanticOverlayDirectory,
	resolveSemanticOverlayPath
} from '$lib/server/connectors/vehicle-registry/storage';
import type { VehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess/types';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	GenerateVehicleSemanticOverlayOptions,
	VehicleSemanticActionSupport,
	VehicleSemanticGroupAnnotation,
	VehicleSemanticGroup,
	VehicleSemanticPartCategory,
	VehicleSemanticPartRegion,
	VehicleSemanticPartSide,
	VehicleSemanticPartUnit,
	VehicleSemanticMaterialSuggestion,
	VehicleSemanticOverlay,
	VehicleSemanticOverlayDiscard,
	VehicleSemanticOverlayStatus,
	VehicleSemanticTag
} from './types';
import { VEHICLE_SEMANTIC_PART_CATEGORIES, VEHICLE_SEMANTIC_TAGS } from './types';

const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_MIN_ACCEPTED_CONFIDENCE = 0.7;

let client: OpenAI | null = null;
const inflightRefreshes = new Map<string, Promise<VehicleSemanticOverlay>>();

export class VehicleSemanticOverlayConfigError extends Error {}
export class VehicleSemanticOverlayUpstreamError extends Error {}

type VehicleSemanticSuggestionEnvelope = {
	materials: VehicleSemanticMaterialSuggestion[];
	parts: VehicleSemanticPartUnit[];
	groups: VehicleSemanticGroup[];
};

type SemanticPromptBudget = {
	maxMaterials: number;
	maxControlCandidates: number;
	maxNodes: number;
	maxMeshes: number;
	maxAliasesPerEntity: number;
	maxMeshNamesPerMaterial: number;
	maxNodePathsPerMaterial: number;
	maxMaterialIdsPerMesh: number;
	maxMaterialNamesPerMesh: number;
	maxChildIdsPerNode: number;
	maxStringLength: number;
};

const DEFAULT_PROMPT_BUDGET: SemanticPromptBudget = {
	maxMaterials: 120,
	maxControlCandidates: 160,
	maxNodes: 220,
	maxMeshes: 160,
	maxAliasesPerEntity: 0,
	maxMeshNamesPerMaterial: 3,
	maxNodePathsPerMaterial: 3,
	maxMaterialIdsPerMesh: 4,
	maxMaterialNamesPerMesh: 4,
	maxChildIdsPerNode: 6,
	maxStringLength: 96
};

const REDUCED_PROMPT_BUDGET: SemanticPromptBudget = {
	maxMaterials: 80,
	maxControlCandidates: 100,
	maxNodes: 140,
	maxMeshes: 100,
	maxAliasesPerEntity: 0,
	maxMeshNamesPerMaterial: 2,
	maxNodePathsPerMaterial: 2,
	maxMaterialIdsPerMesh: 3,
	maxMaterialNamesPerMesh: 3,
	maxChildIdsPerNode: 3,
	maxStringLength: 72
};

const MINIMAL_PROMPT_BUDGET: SemanticPromptBudget = {
	maxMaterials: 48,
	maxControlCandidates: 64,
	maxNodes: 80,
	maxMeshes: 64,
	maxAliasesPerEntity: 0,
	maxMeshNamesPerMaterial: 1,
	maxNodePathsPerMaterial: 1,
	maxMaterialIdsPerMesh: 2,
	maxMaterialNamesPerMesh: 2,
	maxChildIdsPerNode: 2,
	maxStringLength: 56
};

function getClient(): OpenAI {
	if (!env.OPENAI_API_KEY) {
		throw new VehicleSemanticOverlayConfigError('OPENAI_API_KEY is not configured.');
	}

	client ??= new OpenAI({
		apiKey: env.OPENAI_API_KEY
	});

	return client;
}

function getSemanticModel(): string {
	return env.OPENAI_SEMANTIC_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL;
}

function truncateString(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function limitSortedStrings(values: string[], maxItems: number, maxLength: number): string[] {
	return values
		.slice(0, maxItems)
		.map((value) => truncateString(value, maxLength))
		.sort((left, right) => left.localeCompare(right));
}

function scoreSemanticPriority(value: string): number {
	const normalized = value.toLowerCase();
	if (/(wheel|rim|tire|tyre)/.test(normalized)) return 7;
	if (/(headlight|headlamp|light|lamp)/.test(normalized)) return 6;
	if (/(glass|window|windshield)/.test(normalized)) return 5;
	if (/(grille|grill)/.test(normalized)) return 4;
	if (/(body|door|hood|roof|rear|front|bumper|trim)/.test(normalized)) return 3;
	return 0;
}

function sortBySemanticPriority<T>(items: T[], getValue: (item: T) => string): T[] {
	return [...items].sort((left, right) => {
		const scoreDelta = scoreSemanticPriority(getValue(right)) - scoreSemanticPriority(getValue(left));
		if (scoreDelta !== 0) {
			return scoreDelta;
		}

		return getValue(left).localeCompare(getValue(right));
	});
}

function isPromptTooLargeError(error: unknown): boolean {
	if (!(error instanceof OpenAI.APIError)) {
		return false;
	}

	const message = error.message.toLowerCase();
	return (
		error.code === 'rate_limit_exceeded' &&
		(message.includes('request too large') ||
			message.includes('input or output tokens must be reduced') ||
			message.includes('requested'))
	);
}

function isVehicleSemanticTag(value: unknown): value is VehicleSemanticTag {
	return typeof value === 'string' && VEHICLE_SEMANTIC_TAGS.includes(value as VehicleSemanticTag);
}

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

function normalizeSuggestion(
	value: unknown
): VehicleSemanticMaterialSuggestion | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const targetType = candidate.targetType;
	const targetId = typeof candidate.targetId === 'string' ? candidate.targetId.trim() : '';
	const targetName = typeof candidate.targetName === 'string' ? candidate.targetName.trim() : '';
	const humanLabel = typeof candidate.humanLabel === 'string' ? candidate.humanLabel.trim() : '';
	const aliases = normalizeStringArray(candidate.aliases);
	const semanticTags = Array.isArray(candidate.semanticTags)
		? candidate.semanticTags.filter(isVehicleSemanticTag)
		: [];
	const confidence =
		typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
			? candidate.confidence
			: Number.NaN;

	if (
		targetType !== 'material' ||
		targetId.length === 0 ||
		targetName.length === 0 ||
		humanLabel.length === 0 ||
		semanticTags.length === 0 ||
		!Number.isFinite(confidence)
	) {
		return null;
	}

	return {
		targetType,
		targetId,
		targetName,
		humanLabel,
		aliases,
		semanticTags,
		confidence: Math.min(1, Math.max(0, confidence))
	};
}

function slugifyPartId(input: string): string {
	return input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function isVehicleSemanticPartCategory(value: unknown): value is VehicleSemanticPartCategory {
	return (
		typeof value === 'string' &&
		VEHICLE_SEMANTIC_PART_CATEGORIES.includes(value as VehicleSemanticPartCategory)
	);
}

function isVehicleSemanticPartSide(value: unknown): value is VehicleSemanticPartSide {
	return value === 'left' || value === 'right' || value === 'center';
}

function isVehicleSemanticPartRegion(value: unknown): value is VehicleSemanticPartRegion {
	return value === 'front' || value === 'rear' || value === 'mid' || value === 'roof' || value === 'full';
}

const VEHICLE_SEMANTIC_GROUP_CATEGORIES = [
	'wheels',
	'doors',
	'front_lighting',
	'rear_lighting',
	'glasshouse',
	'body_shell',
	'front_face',
	'trim',
	'interior',
	'other'
] as const;

function isVehicleSemanticActionSupport(value: unknown): value is VehicleSemanticActionSupport {
	return (
		value === 'highlight' ||
		value === 'focus' ||
		value === 'isolate' ||
		value === 'explode' ||
		value === 'paint' ||
		value === 'tint'
	);
}

function isVehicleSemanticGroupCategory(
	value: unknown
): value is VehicleSemanticGroup['category'] {
	return (
		typeof value === 'string' &&
		VEHICLE_SEMANTIC_GROUP_CATEGORIES.includes(value as VehicleSemanticGroup['category'])
	);
}

function normalizePartUnit(value: unknown): VehicleSemanticPartUnit | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const humanLabel = typeof candidate.humanLabel === 'string' ? candidate.humanLabel.trim() : '';
	const idCandidate = typeof candidate.id === 'string' ? candidate.id.trim() : '';
	const aliases = normalizeStringArray(candidate.aliases);
	const confidence =
		typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
			? candidate.confidence
			: Number.NaN;
	const category = isVehicleSemanticPartCategory(candidate.category)
		? candidate.category
		: 'other';
	const nodeIds = normalizeStringArray(candidate.nodeIds);
	const meshIds = normalizeStringArray(candidate.meshIds);
	const materialIds = normalizeStringArray(candidate.materialIds);
	const anchorNodeId =
		typeof candidate.anchorNodeId === 'string' && candidate.anchorNodeId.trim().length > 0
			? candidate.anchorNodeId.trim()
			: undefined;
	const side = isVehicleSemanticPartSide(candidate.side) ? candidate.side : undefined;
	const region = isVehicleSemanticPartRegion(candidate.region) ? candidate.region : undefined;

	if (
		humanLabel.length === 0 ||
		(nodeIds.length === 0 && meshIds.length === 0 && materialIds.length === 0) ||
		!Number.isFinite(confidence)
	) {
		return null;
	}

	return {
		id: idCandidate || slugifyPartId(humanLabel) || 'semantic_part',
		humanLabel,
		aliases,
		confidence: Math.min(1, Math.max(0, confidence)),
		category,
		nodeIds,
		meshIds,
		materialIds,
		anchorNodeId,
		side,
		region
	};
}

function normalizeActionSupportArray(value: unknown): VehicleSemanticActionSupport[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return Array.from(
		new Set(
			value.filter((entry): entry is VehicleSemanticActionSupport =>
				isVehicleSemanticActionSupport(entry)
			)
		)
	).sort((left, right) => left.localeCompare(right));
}

function normalizeDerivedFromArray(
	value: unknown
): Array<'llm' | 'synthetic' | 'materials' | 'parts' | 'user'> {
	if (!Array.isArray(value)) {
		return [];
	}

	return Array.from(
		new Set(
			value.filter(
				(entry): entry is 'llm' | 'synthetic' | 'materials' | 'parts' | 'user' =>
					entry === 'llm' ||
					entry === 'synthetic' ||
					entry === 'materials' ||
					entry === 'parts' ||
					entry === 'user'
			)
		)
	).sort((left, right) => left.localeCompare(right));
}

function normalizeGroup(value: unknown): VehicleSemanticGroup | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const humanLabel = typeof candidate.humanLabel === 'string' ? candidate.humanLabel.trim() : '';
	const idCandidate = typeof candidate.id === 'string' ? candidate.id.trim() : '';
	const aliases = normalizeStringArray(candidate.aliases);
	const confidence =
		typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
			? candidate.confidence
			: Number.NaN;
	const category = isVehicleSemanticGroupCategory(candidate.category)
		? candidate.category
		: 'other';
	const supports = normalizeActionSupportArray(candidate.supports);
	const nodeIds = normalizeStringArray(candidate.nodeIds);
	const meshIds = normalizeStringArray(candidate.meshIds);
	const materialIds = normalizeStringArray(candidate.materialIds);
	const derivedFrom = normalizeDerivedFromArray(candidate.derivedFrom);

	if (
		humanLabel.length === 0 ||
		supports.length === 0 ||
		(nodeIds.length === 0 && meshIds.length === 0 && materialIds.length === 0) ||
		!Number.isFinite(confidence)
	) {
		return null;
	}

	return {
		id: idCandidate || slugifyPartId(humanLabel) || 'semantic_group',
		humanLabel,
		aliases,
		confidence: Math.min(1, Math.max(0, confidence)),
		category,
		supports,
		nodeIds,
		meshIds,
		materialIds,
		derivedFrom
	};
}

function buildPrompt(
	capabilities: VehicleInspectionCapabilities,
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	budget: SemanticPromptBudget
): string {
	const prioritizedMaterials = sortBySemanticPriority(capabilities.materials, (material) => material.name).slice(
		0,
		budget.maxMaterials
	);
	const prioritizedCandidates = sortBySemanticPriority(
		capabilities.controlCandidates,
		(candidate) => `${candidate.name} ${candidate.path}`
	).slice(0, budget.maxControlCandidates);
	const prioritizedNodes = sortBySemanticPriority(
		structure.nodes.filter((node) => node.meshId !== null || node.childCount > 0),
		(node) => `${node.name} ${node.path}`
	).slice(0, budget.maxNodes);
	const prioritizedMeshes = sortBySemanticPriority(structure.meshes, (mesh) => mesh.name).slice(
		0,
		budget.maxMeshes
	);

	return JSON.stringify(
		{
			assetId: capabilities.assetId,
			structuralGeneratedAt: capabilities.generatedAt,
			promptBudget: budget,
			materials: prioritizedMaterials.map((material) => ({
				id: material.id,
				name: truncateString(material.name, budget.maxStringLength),
				alphaMode: material.alphaMode,
				doubleSided: material.doubleSided,
				textureSlots: material.textureSlots.slice(0, 4),
				meshNames: limitSortedStrings(
					material.meshNames,
					budget.maxMeshNamesPerMaterial,
					budget.maxStringLength
				),
				nodePaths: limitSortedStrings(
					material.nodePaths,
					budget.maxNodePathsPerMaterial,
					budget.maxStringLength
				)
			})),
			controlCandidates: prioritizedCandidates.map((candidate) => ({
				nodeId: candidate.nodeId,
				name: truncateString(candidate.name, budget.maxStringLength),
				path: truncateString(candidate.path, budget.maxStringLength),
				meshId: candidate.meshId
			})),
			nodes: prioritizedNodes.map((node) => ({
				id: node.id,
				name: truncateString(node.name, budget.maxStringLength),
				path: truncateString(node.path, budget.maxStringLength),
				parentId: node.parentId,
				childCount: node.childCount,
				childIds: node.childIds.slice(0, budget.maxChildIdsPerNode),
				meshId: node.meshId
			})),
			meshes: prioritizedMeshes.map((mesh) => ({
				id: mesh.id,
				name: truncateString(mesh.name, budget.maxStringLength),
				materialIds: mesh.materialIds.slice(0, budget.maxMaterialIdsPerMesh),
				materialNames: limitSortedStrings(
					mesh.materialNames,
					budget.maxMaterialNamesPerMesh,
					budget.maxStringLength
				)
			})),
			targetSemanticGroups: [...VEHICLE_SEMANTIC_GROUP_CATEGORIES]
		},
		null,
		2
	);
}

async function requestSemanticSuggestions(
	capabilities: VehicleInspectionCapabilities,
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>
): Promise<VehicleSemanticSuggestionEnvelope> {
	const promptBudgets = [DEFAULT_PROMPT_BUDGET, REDUCED_PROMPT_BUDGET, MINIMAL_PROMPT_BUDGET];
	let lastError: unknown;

	for (const budget of promptBudgets) {
		try {
			const completion = await getClient().chat.completions.create({
				model: getSemanticModel(),
				temperature: 0.2,
				response_format: {
					type: 'json_schema',
					json_schema: {
						name: 'vehicle_semantic_overlay_suggestions',
						schema: {
							type: 'object',
							additionalProperties: false,
							properties: {
								materials: {
									type: 'array',
									items: {
										type: 'object',
										additionalProperties: false,
										properties: {
											targetType: { type: 'string', enum: ['material'] },
											targetId: { type: 'string' },
											targetName: { type: 'string' },
											humanLabel: { type: 'string' },
											aliases: {
												type: 'array',
												items: { type: 'string' }
											},
											semanticTags: {
												type: 'array',
												items: {
													type: 'string',
													enum: [...VEHICLE_SEMANTIC_TAGS]
												}
											},
											confidence: { type: 'number' }
										},
										required: [
											'targetType',
											'targetId',
											'targetName',
											'humanLabel',
											'aliases',
											'semanticTags',
											'confidence'
										]
									}
								},
								parts: {
									type: 'array',
									items: {
										type: 'object',
										additionalProperties: false,
										properties: {
											id: { type: 'string' },
											humanLabel: { type: 'string' },
											aliases: { type: 'array', items: { type: 'string' } },
											confidence: { type: 'number' },
											category: {
												type: 'string',
												enum: [...VEHICLE_SEMANTIC_PART_CATEGORIES]
											},
											nodeIds: { type: 'array', items: { type: 'string' } },
											meshIds: { type: 'array', items: { type: 'string' } },
											materialIds: { type: 'array', items: { type: 'string' } },
											anchorNodeId: { type: 'string' },
											side: { type: 'string', enum: ['left', 'right', 'center'] },
											region: { type: 'string', enum: ['front', 'rear', 'mid', 'roof', 'full'] }
										},
										required: [
											'id',
											'humanLabel',
											'aliases',
											'confidence',
											'category',
											'nodeIds',
											'meshIds',
											'materialIds'
										]
									}
								},
								groups: {
									type: 'array',
									items: {
										type: 'object',
										additionalProperties: false,
										properties: {
											id: { type: 'string' },
											humanLabel: { type: 'string' },
											aliases: { type: 'array', items: { type: 'string' } },
											confidence: { type: 'number' },
											category: {
												type: 'string',
												enum: [...VEHICLE_SEMANTIC_GROUP_CATEGORIES]
											},
											supports: {
												type: 'array',
												items: {
													type: 'string',
													enum: ['highlight', 'focus', 'isolate', 'explode', 'paint', 'tint']
												}
											},
											nodeIds: { type: 'array', items: { type: 'string' } },
											meshIds: { type: 'array', items: { type: 'string' } },
											materialIds: { type: 'array', items: { type: 'string' } },
											derivedFrom: {
												type: 'array',
												items: {
													type: 'string',
													enum: ['llm', 'synthetic', 'materials', 'parts']
												}
											}
										},
										required: [
											'id',
											'humanLabel',
											'aliases',
											'confidence',
											'category',
											'supports',
											'nodeIds',
											'meshIds',
											'materialIds'
										]
									}
								}
							},
							required: ['materials', 'parts', 'groups']
						}
					}
				},
				messages: [
					{
						role: 'developer',
						content: `You enrich deterministic GLB manifests with semantic material labels.
Only use material IDs supplied in the input.
Do not invent missing IDs, nodes, meshes, materials, or vehicle parts.
Prefer precision over recall. Skip uncertain labels instead of guessing.
Return only material-level suggestions for these stable semantic tags: ${VEHICLE_SEMANTIC_TAGS.join(', ')}.
Return part assemblies only when they can be grounded to real nodeIds, meshIds, or materialIds from the input.
Return semantic operational groups when they are useful abstractions over real IDs, even if they are not precise assemblies.
Good examples: wheels, doors, front lighting, rear lighting, glasshouse, body shell, front face, trim, interior, and inferred units like propeller or number plate.
Groups must declare which actions they support, such as highlight, focus, isolate, explode, paint, or tint.
Use aliases that help a planner match human requests like body color, glass tint, headlights, grille, or wheels.`
					},
					{
						role: 'user',
						content: buildPrompt(capabilities, structure, budget)
					}
				]
			});

			const content = completion.choices[0]?.message.content;
			if (!content) {
				throw new VehicleSemanticOverlayUpstreamError('OpenAI returned no semantic overlay content.');
			}

			const parsed = JSON.parse(content) as VehicleSemanticSuggestionEnvelope;
			return {
				materials: Array.isArray(parsed.materials) ? parsed.materials : [],
				parts: Array.isArray(parsed.parts) ? parsed.parts : [],
				groups: Array.isArray(parsed.groups) ? parsed.groups : []
			};
		} catch (error) {
			lastError = error;
			if (!isPromptTooLargeError(error) || budget === MINIMAL_PROMPT_BUDGET) {
				throw error;
			}
		}
	}

	throw lastError instanceof Error
		? lastError
		: new VehicleSemanticOverlayUpstreamError('Semantic overlay request failed.');
}

function validateMaterials(
	suggestions: VehicleSemanticMaterialSuggestion[],
	capabilities: VehicleInspectionCapabilities,
	minAcceptedConfidence: number
): {
	acceptedMaterials: VehicleSemanticMaterialSuggestion[];
	discardedSuggestions: VehicleSemanticOverlayDiscard[];
} {
	const materialById = new Map(capabilities.materials.map((material) => [material.id, material]));
	const accepted = new Map<string, VehicleSemanticMaterialSuggestion>();
	const discardedSuggestions: VehicleSemanticOverlayDiscard[] = [];

	for (const suggestion of suggestions) {
		const material = materialById.get(suggestion.targetId);
		if (!material) {
			discardedSuggestions.push({
				kind: 'material',
				payload: suggestion,
				reason: `Unknown structural material ID: ${suggestion.targetId}`
			});
			continue;
		}

		if (suggestion.targetName !== material.name) {
			discardedSuggestions.push({
				kind: 'material',
				payload: suggestion,
				reason: `Material name mismatch for ${suggestion.targetId}`
			});
			continue;
		}

		if (suggestion.confidence < minAcceptedConfidence) {
			discardedSuggestions.push({
				kind: 'material',
				payload: suggestion,
				reason: `Confidence ${suggestion.confidence.toFixed(2)} below threshold ${minAcceptedConfidence.toFixed(2)}`
			});
			continue;
		}

		const key = suggestion.targetId;
		const existing = accepted.get(key);
		if (!existing) {
			accepted.set(key, suggestion);
			continue;
		}

		accepted.set(key, {
			...existing,
			humanLabel: existing.humanLabel.length >= suggestion.humanLabel.length ? existing.humanLabel : suggestion.humanLabel,
			aliases: Array.from(new Set([...existing.aliases, ...suggestion.aliases])).sort((left, right) =>
				left.localeCompare(right)
			),
			semanticTags: Array.from(
				new Set<VehicleSemanticTag>([...existing.semanticTags, ...suggestion.semanticTags])
			).sort((left, right) => left.localeCompare(right)),
			confidence: Math.max(existing.confidence, suggestion.confidence)
		});
	}

	return {
		acceptedMaterials: Array.from(accepted.values()).sort((left, right) =>
			left.targetId.localeCompare(right.targetId)
		),
		discardedSuggestions
	};
}

function validateParts(
	parts: VehicleSemanticPartUnit[],
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	minAcceptedConfidence: number
): {
	acceptedParts: VehicleSemanticPartUnit[];
	discardedSuggestions: VehicleSemanticOverlayDiscard[];
} {
	const validNodeIds = new Set(structure.nodes.map((node) => node.id));
	const validMeshIds = new Set(structure.meshes.map((mesh) => mesh.id));
	const validMaterialIds = new Set(structure.materials.map((material) => material.id));
	const accepted = new Map<string, VehicleSemanticPartUnit>();
	const discardedSuggestions: VehicleSemanticOverlayDiscard[] = [];

	for (const part of parts) {
		if (part.confidence < minAcceptedConfidence) {
			discardedSuggestions.push({
				kind: 'part',
				payload: part,
				reason: `Confidence ${part.confidence.toFixed(2)} below threshold ${minAcceptedConfidence.toFixed(2)}`
			});
			continue;
		}

		if (
			part.nodeIds.some((nodeId) => !validNodeIds.has(nodeId)) ||
			part.meshIds.some((meshId) => !validMeshIds.has(meshId)) ||
			part.materialIds.some((materialId) => !validMaterialIds.has(materialId))
		) {
			discardedSuggestions.push({
				kind: 'part',
				payload: part,
				reason: 'Part references unknown structural IDs'
			});
			continue;
		}

		if (part.anchorNodeId && !validNodeIds.has(part.anchorNodeId)) {
			discardedSuggestions.push({
				kind: 'part',
				payload: part,
				reason: `Unknown anchor node ID: ${part.anchorNodeId}`
			});
			continue;
		}

		const existing = accepted.get(part.id);
		if (!existing) {
			accepted.set(part.id, part);
			continue;
		}

		accepted.set(part.id, {
			...existing,
			humanLabel: existing.humanLabel.length >= part.humanLabel.length ? existing.humanLabel : part.humanLabel,
			aliases: Array.from(new Set([...existing.aliases, ...part.aliases])).sort((left, right) =>
				left.localeCompare(right)
			),
			confidence: Math.max(existing.confidence, part.confidence),
			nodeIds: Array.from(new Set([...existing.nodeIds, ...part.nodeIds])).sort((left, right) =>
				left.localeCompare(right)
			),
			meshIds: Array.from(new Set([...existing.meshIds, ...part.meshIds])).sort((left, right) =>
				left.localeCompare(right)
			),
			materialIds: Array.from(new Set([...existing.materialIds, ...part.materialIds])).sort(
				(left, right) => left.localeCompare(right)
			),
			anchorNodeId: existing.anchorNodeId ?? part.anchorNodeId,
			side: existing.side ?? part.side,
			region: existing.region ?? part.region
		});
	}

	return {
		acceptedParts: Array.from(accepted.values()).sort((left, right) => left.id.localeCompare(right.id)),
		discardedSuggestions
	};
}

function validateGroups(
	groups: VehicleSemanticGroup[],
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	acceptedMaterials: VehicleSemanticMaterialSuggestion[],
	minAcceptedConfidence: number
): {
	acceptedGroups: VehicleSemanticGroup[];
	discardedSuggestions: VehicleSemanticOverlayDiscard[];
} {
	const validNodeIds = new Set(structure.nodes.map((node) => node.id));
	const validMeshIds = new Set(structure.meshes.map((mesh) => mesh.id));
	const validMaterialIds = new Set(structure.materials.map((material) => material.id));
	const structuralMaterialsById = new Map(structure.materials.map((material) => [material.id, material]));
	const semanticMaterialsById = new Map(acceptedMaterials.map((material) => [material.targetId, material]));
	const accepted = new Map<string, VehicleSemanticGroup>();
	const discardedSuggestions: VehicleSemanticOverlayDiscard[] = [];

	for (const group of groups) {
		const compatibleMaterialIds = group.materialIds.filter((materialId) => {
			const structuralMaterial = structuralMaterialsById.get(materialId);
			if (!structuralMaterial) {
				return false;
			}

			return isMaterialCompatibleWithGroupCategory(
				group.category,
				structuralMaterial,
				semanticMaterialsById.get(materialId)
			);
		});
		const normalizedGroup =
			compatibleMaterialIds.length === group.materialIds.length
				? group
				: {
						...group,
						materialIds: compatibleMaterialIds
					};

		if (group.confidence < minAcceptedConfidence) {
			discardedSuggestions.push({
				kind: 'group',
				payload: normalizedGroup,
				reason: `Confidence ${group.confidence.toFixed(2)} below threshold ${minAcceptedConfidence.toFixed(2)}`
			});
			continue;
		}

		if (
			normalizedGroup.nodeIds.some((nodeId) => !validNodeIds.has(nodeId)) ||
			normalizedGroup.meshIds.some((meshId) => !validMeshIds.has(meshId)) ||
			normalizedGroup.materialIds.some((materialId) => !validMaterialIds.has(materialId))
		) {
			discardedSuggestions.push({
				kind: 'group',
				payload: normalizedGroup,
				reason: 'Group references unknown structural IDs'
			});
			continue;
		}

		if (
			normalizedGroup.nodeIds.length === 0 &&
			normalizedGroup.meshIds.length === 0 &&
			normalizedGroup.materialIds.length === 0
		) {
			discardedSuggestions.push({
				kind: 'group',
				payload: normalizedGroup,
				reason: 'Group has no compatible structural targets after semantic filtering'
			});
			continue;
		}

		const existing = accepted.get(normalizedGroup.id);
		if (!existing) {
			accepted.set(normalizedGroup.id, normalizedGroup);
			continue;
		}

		accepted.set(normalizedGroup.id, {
			...existing,
			humanLabel:
				existing.humanLabel.length >= normalizedGroup.humanLabel.length
					? existing.humanLabel
					: normalizedGroup.humanLabel,
			aliases: Array.from(new Set([...existing.aliases, ...normalizedGroup.aliases])).sort((left, right) =>
				left.localeCompare(right)
			),
			confidence: Math.max(existing.confidence, normalizedGroup.confidence),
			supports: Array.from(new Set([...existing.supports, ...normalizedGroup.supports])).sort((left, right) =>
				left.localeCompare(right)
			),
			nodeIds: Array.from(new Set([...existing.nodeIds, ...normalizedGroup.nodeIds])).sort((left, right) =>
				left.localeCompare(right)
			),
			meshIds: Array.from(new Set([...existing.meshIds, ...normalizedGroup.meshIds])).sort((left, right) =>
				left.localeCompare(right)
			),
			materialIds: Array.from(new Set([...existing.materialIds, ...normalizedGroup.materialIds])).sort(
				(left, right) => left.localeCompare(right)
			),
			derivedFrom: Array.from(
				new Set([...(existing.derivedFrom ?? []), ...(normalizedGroup.derivedFrom ?? [])])
			).sort(
				(left, right) => left.localeCompare(right)
			)
		});
	}

	return {
		acceptedGroups: Array.from(accepted.values()).sort((left, right) => left.id.localeCompare(right.id)),
		discardedSuggestions
	};
}

function countPatternMatches(values: string[], pattern: RegExp): number {
	return values.reduce((count, value) => count + (pattern.test(value) ? 1 : 0), 0);
}

function isMaterialCompatibleWithGroupCategory(
	category: VehicleSemanticGroup['category'],
	material: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>['materials'][number],
	suggestion?: VehicleSemanticMaterialSuggestion
): boolean {
	const contexts = [material.name, ...material.meshNames, ...material.nodePaths].map((value) =>
		value.toLowerCase()
	);
	const positiveMatches = (pattern: RegExp) => countPatternMatches(contexts, pattern);

	const glassSignals = positiveMatches(/\b(window|windshield|windscreen|glass|rearglass|backglass|quarter)\b/i);
	const wheelSignals = positiveMatches(/\b(wheel|rim|tire|tyre|spoke|brake|caliper|rotor|disc)\b/i);
	const lightSignals = positiveMatches(/\b(light|lamp|headlight|taillight|tail light)\b/i);
	const grilleSignals = positiveMatches(/\b(grille|grill|fascia|bumper|nose|front)\b/i);
	const doorSignals = positiveMatches(/\b(door)\b/i);
	const bodySignals = positiveMatches(/\b(body|paint|colou?r|panel|hood|fender|quarter)\b/i);

	switch (category) {
		case 'wheels':
			return (
				(suggestion?.semanticTags.includes('wheel_outer_face') ?? false) ||
				(wheelSignals > 0 && glassSignals === 0 && lightSignals === 0)
			);
		case 'glasshouse':
			return (
				glassSignals > 0 &&
				glassSignals > wheelSignals + lightSignals + grilleSignals &&
				(suggestion?.semanticTags.includes('glass_candidate') ?? true)
			);
		case 'body_shell':
			return (
				(suggestion?.semanticTags.includes('body_paint_candidate') ?? false) ||
				(bodySignals > 0 && wheelSignals === 0 && lightSignals === 0)
			);
		case 'front_face':
			return (
				(suggestion?.semanticTags.includes('front_grille') ?? false) ||
				grilleSignals > 0 ||
				(lightSignals > 0 && positiveMatches(/\b(front)\b/i) > 0)
			);
		case 'doors':
			return doorSignals > 0;
		case 'trim':
			return !(
				(suggestion?.semanticTags.includes('body_paint_candidate') ?? false) ||
				(suggestion?.semanticTags.includes('glass_candidate') ?? false) ||
				(suggestion?.semanticTags.includes('wheel_outer_face') ?? false)
			);
		case 'interior':
			return positiveMatches(/\b(interior|seat|cabin|dashboard|console)\b/i) > 0;
		case 'front_lighting':
			return lightSignals > 0 && positiveMatches(/\b(front)\b/i) > 0;
		case 'rear_lighting':
			return lightSignals > 0 && positiveMatches(/\b(rear|tail)\b/i) > 0;
		case 'other':
			return true;
	}
}

function synthesizeSemanticGroups(
	materials: VehicleSemanticMaterialSuggestion[],
	parts: VehicleSemanticPartUnit[]
): VehicleSemanticGroup[] {
	const synthesized: VehicleSemanticGroup[] = [];
	const pushGroup = (group: VehicleSemanticGroup | null): void => {
		if (group) {
			synthesized.push(group);
		}
	};

	const synthFromMaterials = (
		id: string,
		humanLabel: string,
		category: VehicleSemanticGroup['category'],
		supports: VehicleSemanticActionSupport[],
		matcher: (material: VehicleSemanticMaterialSuggestion) => boolean,
		aliases: string[]
	): VehicleSemanticGroup | null => {
		const matched = materials.filter(matcher);
		if (matched.length === 0) {
			return null;
		}

		return {
			id,
			humanLabel,
			aliases,
			confidence: Math.max(...matched.map((entry) => entry.confidence)),
			category,
			supports,
			nodeIds: [],
			meshIds: [],
			materialIds: matched.map((entry) => entry.targetId).sort((left, right) => left.localeCompare(right)),
			derivedFrom: ['materials', 'synthetic']
		};
	};

	const synthFromParts = (
		id: string,
		humanLabel: string,
		category: VehicleSemanticGroup['category'],
		supports: VehicleSemanticActionSupport[],
		matcher: (part: VehicleSemanticPartUnit) => boolean,
		aliases: string[]
	): VehicleSemanticGroup | null => {
		const matched = parts.filter(matcher);
		if (matched.length === 0) {
			return null;
		}

		return {
			id,
			humanLabel,
			aliases,
			confidence: Math.max(...matched.map((entry) => entry.confidence)),
			category,
			supports,
			nodeIds: Array.from(new Set(matched.flatMap((entry) => entry.nodeIds))).sort((left, right) =>
				left.localeCompare(right)
			),
			meshIds: Array.from(new Set(matched.flatMap((entry) => entry.meshIds))).sort((left, right) =>
				left.localeCompare(right)
			),
			materialIds: Array.from(new Set(matched.flatMap((entry) => entry.materialIds))).sort(
				(left, right) => left.localeCompare(right)
			),
			derivedFrom: ['parts', 'synthetic']
		};
	};

	pushGroup(
		synthFromMaterials(
			'group_wheels',
			'wheels',
			'wheels',
			['highlight', 'focus', 'isolate', 'explode'],
			(material) => material.semanticTags.includes('wheel_outer_face'),
			['wheel', 'wheels', 'rim', 'rims']
		)
	);
	pushGroup(
		synthFromMaterials(
			'group_glasshouse',
			'glasshouse',
			'glasshouse',
			['highlight', 'focus', 'isolate', 'tint'],
			(material) => material.semanticTags.includes('glass_candidate'),
			['glass', 'windows', 'window glass']
		)
	);
	pushGroup(
		synthFromMaterials(
			'group_body_shell',
			'body shell',
			'body_shell',
			['highlight', 'focus', 'isolate', 'paint'],
			(material) => material.semanticTags.includes('body_paint_candidate'),
			['body', 'body paint', 'exterior paint']
		)
	);
	pushGroup(
		synthFromMaterials(
			'group_front_face',
			'front face',
			'front_face',
			['highlight', 'focus', 'isolate', 'explode'],
			(material) =>
				material.semanticTags.includes('front_grille') ||
				material.semanticTags.includes('left_headlight') ||
				material.semanticTags.includes('right_headlight'),
			['nose', 'front end', 'front fascia']
		)
	);
	pushGroup(
		synthFromParts(
			'group_doors',
			'doors',
			'doors',
			['highlight', 'focus', 'isolate', 'explode'],
			(part) => part.category === 'door' || /door/i.test(`${part.id} ${part.humanLabel} ${part.aliases.join(' ')}`),
			['door']
		)
	);

	return synthesized;
}

function normalizeOverlay(value: unknown): VehicleSemanticOverlay | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.assetId !== 'string' ||
		typeof candidate.structuralGeneratedAt !== 'string' ||
		typeof candidate.generatedAt !== 'string' ||
		typeof candidate.model !== 'string' ||
		typeof candidate.minAcceptedConfidence !== 'number'
	) {
		return null;
	}

	const acceptedMaterials = Array.isArray(candidate.acceptedMaterials)
		? candidate.acceptedMaterials
				.map((entry) => normalizeSuggestion(entry))
				.filter((entry): entry is VehicleSemanticMaterialSuggestion => entry !== null)
		: [];
	const acceptedParts = Array.isArray(candidate.acceptedParts)
		? candidate.acceptedParts
				.map((entry) => normalizePartUnit(entry))
				.filter((entry): entry is VehicleSemanticPartUnit => entry !== null)
		: [];
	const acceptedGroups = Array.isArray(candidate.acceptedGroups)
		? candidate.acceptedGroups
				.map((entry) => normalizeGroup(entry))
				.filter((entry): entry is VehicleSemanticGroup => entry !== null)
		: [];
	const discardedSuggestions = Array.isArray(candidate.discardedSuggestions)
		? candidate.discardedSuggestions
				.map((entry) => {
					if (!entry || typeof entry !== 'object') {
						return null;
					}

					const record = entry as Record<string, unknown>;
					const kind =
						record.kind === 'group'
							? 'group'
							: record.kind === 'part'
							? 'part'
							: record.kind === 'material'
								? 'material'
								: record.suggestion
									? 'material'
									: null;
					const reason = typeof record.reason === 'string' ? record.reason : '';
					const payload =
						kind === 'group'
							? normalizeGroup(record.payload)
							: kind === 'part'
							? normalizePartUnit(record.payload)
							: kind === 'material'
								? normalizeSuggestion(record.payload ?? record.suggestion)
								: null;
					if (!kind || !payload || reason.length === 0) {
						return null;
					}

					return { kind, payload, reason };
				})
				.filter((entry): entry is VehicleSemanticOverlayDiscard => entry !== null)
		: [];

	return {
		assetId: candidate.assetId as VehicleAssetId,
		structuralGeneratedAt: candidate.structuralGeneratedAt,
		generatedAt: candidate.generatedAt,
		model: candidate.model,
		minAcceptedConfidence: candidate.minAcceptedConfidence,
		acceptedMaterials,
		acceptedParts,
		acceptedGroups,
		discardedSuggestions
	};
}

export async function readVehicleSemanticOverlay(
	assetId: VehicleAssetId
): Promise<VehicleSemanticOverlay | null> {
	try {
		const raw = await readFile(resolveSemanticOverlayPath(assetId), 'utf8');
		return normalizeOverlay(JSON.parse(raw));
	} catch {
		return null;
	}
}

export async function writeVehicleSemanticOverlay(
	overlay: VehicleSemanticOverlay
): Promise<VehicleSemanticOverlay> {
	await mkdir(resolveSemanticOverlayDirectory(), { recursive: true });
	await writeFile(resolveSemanticOverlayPath(overlay.assetId), JSON.stringify(overlay, null, 2), 'utf8');
	return overlay;
}

export async function generateVehicleSemanticOverlay(
	assetId: VehicleAssetId,
	options: GenerateVehicleSemanticOverlayOptions = {}
): Promise<VehicleSemanticOverlay> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const structure = await deriveStructuralAssetSnapshot(assetId);
	const minAcceptedConfidence = options.minAcceptedConfidence ?? DEFAULT_MIN_ACCEPTED_CONFIDENCE;
	const existing = await readVehicleSemanticOverlay(assetId);

	if (
		existing &&
		!options.force &&
		existing.structuralGeneratedAt === capabilities.generatedAt &&
		existing.minAcceptedConfidence === minAcceptedConfidence
	) {
		return existing;
	}

	const raw = await requestSemanticSuggestions(capabilities, structure);
	const normalizedMaterials = raw.materials
		.map((entry) => normalizeSuggestion(entry))
		.filter((entry): entry is VehicleSemanticMaterialSuggestion => entry !== null);
	const normalizedParts = raw.parts
		.map((entry) => normalizePartUnit(entry))
		.filter((entry): entry is VehicleSemanticPartUnit => entry !== null);
	const normalizedGroups = raw.groups
		.map((entry) => normalizeGroup(entry))
		.filter((entry): entry is VehicleSemanticGroup => entry !== null);
	const validatedMaterials = validateMaterials(
		normalizedMaterials,
		capabilities,
		minAcceptedConfidence
	);
	const validatedParts = validateParts(normalizedParts, structure, minAcceptedConfidence);
	const validatedGroups = validateGroups(
		[...normalizedGroups, ...synthesizeSemanticGroups(validatedMaterials.acceptedMaterials, validatedParts.acceptedParts)],
		structure,
		validatedMaterials.acceptedMaterials,
		minAcceptedConfidence
	);

	return writeVehicleSemanticOverlay({
		assetId,
		structuralGeneratedAt: capabilities.generatedAt,
		generatedAt: new Date().toISOString(),
		model: getSemanticModel(),
		minAcceptedConfidence,
		acceptedMaterials: validatedMaterials.acceptedMaterials,
		acceptedParts: validatedParts.acceptedParts,
		acceptedGroups: validatedGroups.acceptedGroups,
		discardedSuggestions: [
			...validatedMaterials.discardedSuggestions,
			...validatedParts.discardedSuggestions,
			...validatedGroups.discardedSuggestions
		]
	});
}

function defaultSupportsForGroupCategory(
	category: VehicleSemanticGroup['category']
): VehicleSemanticActionSupport[] {
	switch (category) {
		case 'glasshouse':
			return ['focus', 'highlight', 'isolate', 'tint'];
		case 'body_shell':
			return ['focus', 'highlight', 'isolate', 'paint'];
		case 'other':
			return ['explode', 'focus', 'highlight', 'isolate'];
		default:
			return ['explode', 'focus', 'highlight', 'isolate'];
	}
}

function humanizeGroupCategory(category: VehicleSemanticGroup['category']): string {
	return category.replaceAll('_', ' ');
}

export async function annotateVehicleSemanticGroup(
	assetId: VehicleAssetId,
	annotation: VehicleSemanticGroupAnnotation
): Promise<VehicleSemanticOverlay> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const structure = await deriveStructuralAssetSnapshot(assetId);
	const node = structure.nodes.find((entry) => entry.id === annotation.nodeId);

	if (!node) {
		throw new Error(`Unknown node ID: ${annotation.nodeId}`);
	}

	const existing = await readVehicleSemanticOverlay(assetId);
	const baseOverlay: VehicleSemanticOverlay =
		existing && existing.structuralGeneratedAt === capabilities.generatedAt
			? existing
			: {
					assetId,
					structuralGeneratedAt: capabilities.generatedAt,
					generatedAt: new Date().toISOString(),
					model: getSemanticModel(),
					minAcceptedConfidence: DEFAULT_MIN_ACCEPTED_CONFIDENCE,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [],
					discardedSuggestions: []
				};

	const mesh = node.meshId ? structure.meshes.find((entry) => entry.id === node.meshId) : undefined;
	const materialIds = mesh?.materialIds ?? [];
	const aliases = normalizeStringArray(annotation.aliases);
	const humanLabel = annotation.humanLabel?.trim() || humanizeGroupCategory(annotation.category);
	const selectionKey =
		annotation.category === 'other'
			? `${annotation.category}:${slugifyPartId(humanLabel)}`
			: annotation.category;
	const existingIndex = baseOverlay.acceptedGroups.findIndex((group) => {
		const groupKey =
			group.category === 'other'
				? `${group.category}:${slugifyPartId(group.humanLabel)}`
				: group.category;
		return groupKey === selectionKey;
	});
	const nextGroup: VehicleSemanticGroup = {
		id:
			annotation.category === 'other'
				? slugifyPartId(humanLabel) || 'group_other'
				: `group_${annotation.category}`,
		humanLabel,
		aliases,
		confidence: 1,
		category: annotation.category,
		supports: defaultSupportsForGroupCategory(annotation.category),
		nodeIds: [node.id],
		meshIds: mesh ? [mesh.id] : [],
		materialIds,
		derivedFrom: ['user']
	};

	if (existingIndex >= 0) {
		const existingGroup = baseOverlay.acceptedGroups[existingIndex]!;
		baseOverlay.acceptedGroups[existingIndex] = {
			...existingGroup,
			humanLabel: nextGroup.humanLabel,
			aliases: Array.from(new Set([...existingGroup.aliases, ...nextGroup.aliases])).sort((left, right) =>
				left.localeCompare(right)
			),
			confidence: 1,
			supports: Array.from(new Set([...existingGroup.supports, ...nextGroup.supports])).sort((left, right) =>
				left.localeCompare(right)
			),
			nodeIds: Array.from(new Set([...existingGroup.nodeIds, node.id])).sort((left, right) =>
				left.localeCompare(right)
			),
			meshIds: Array.from(new Set([...existingGroup.meshIds, ...nextGroup.meshIds])).sort((left, right) =>
				left.localeCompare(right)
			),
			materialIds: Array.from(
				new Set([...existingGroup.materialIds, ...nextGroup.materialIds])
			).sort((left, right) => left.localeCompare(right)),
			derivedFrom: Array.from(
				new Set([...(existingGroup.derivedFrom ?? []), 'user'])
			).sort((left, right) => left.localeCompare(right)) as Array<
				'llm' | 'synthetic' | 'materials' | 'parts' | 'user'
			>
		};
	} else {
		baseOverlay.acceptedGroups = [...baseOverlay.acceptedGroups, nextGroup].sort((left, right) =>
			left.id.localeCompare(right.id)
		);
	}

	baseOverlay.generatedAt = new Date().toISOString();
	return writeVehicleSemanticOverlay(baseOverlay);
}

function createRefreshKey(
	assetId: VehicleAssetId,
	options: GenerateVehicleSemanticOverlayOptions
): string {
	return JSON.stringify({
		assetId,
		force: options.force === true,
		minAcceptedConfidence: options.minAcceptedConfidence ?? DEFAULT_MIN_ACCEPTED_CONFIDENCE
	});
}

export function refreshVehicleSemanticOverlayInBackground(
	assetId: VehicleAssetId,
	options: GenerateVehicleSemanticOverlayOptions = {}
): Promise<VehicleSemanticOverlay> {
	const refreshKey = createRefreshKey(assetId, options);
	const existing = inflightRefreshes.get(refreshKey);
	if (existing) {
		return existing;
	}

	const refreshPromise = generateVehicleSemanticOverlay(assetId, options)
		.catch((error) => {
			console.error(
				JSON.stringify({
					event: 'vehicle_semantic_overlay_refresh_failed',
					assetId,
					error: error instanceof Error ? error.message : 'unknown error'
				})
			);
			throw error;
		})
		.finally(() => {
			inflightRefreshes.delete(refreshKey);
		});

	inflightRefreshes.set(refreshKey, refreshPromise);
	return refreshPromise;
}

async function readFreshOverlay(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): Promise<VehicleSemanticOverlay | null> {
	const overlay = await readVehicleSemanticOverlay(assetId);

	return overlay?.structuralGeneratedAt === structuralGeneratedAt ? overlay : null;
}

export async function getVehicleSemanticOverlayStatus(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): Promise<VehicleSemanticOverlayStatus> {
	const overlay = await readVehicleSemanticOverlay(assetId);
	if (!overlay) {
		return 'missing';
	}

	return overlay.structuralGeneratedAt === structuralGeneratedAt ? 'fresh' : 'stale';
}

function normalizeSearchTerms(value: string): string[] {
	const baseTerms = value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 1);

	return Array.from(
		new Set(
			baseTerms.flatMap((term) =>
				term.endsWith('s') && term.length > 2 ? [term, term.slice(0, -1)] : [term, `${term}s`]
			)
		)
	);
}

function materialMatchesQuery(
	suggestion: VehicleSemanticMaterialSuggestion,
	query: string
): boolean {
	const queryTerms = normalizeSearchTerms(query);
	if (queryTerms.length === 0) {
		return false;
	}

	const haystack = [
		suggestion.humanLabel,
		suggestion.targetName,
		...suggestion.aliases,
		...suggestion.semanticTags.map((tag) => tag.replaceAll('_', ' '))
	]
		.join(' ')
		.toLowerCase();

	return queryTerms.some((term) => haystack.includes(term));
}

function partMatchesQuery(part: VehicleSemanticPartUnit, query: string): boolean {
	const queryTerms = normalizeSearchTerms(query);
	if (queryTerms.length === 0) {
		return false;
	}

	const haystack = [
		part.id.replaceAll('_', ' '),
		part.humanLabel,
		part.category,
		part.side ?? '',
		part.region ?? '',
		...part.aliases
	]
		.join(' ')
		.toLowerCase();

	return queryTerms.some((term) => haystack.includes(term));
}

function groupMatchesQuery(group: VehicleSemanticGroup, query: string): boolean {
	const queryTerms = normalizeSearchTerms(query);
	if (queryTerms.length === 0) {
		return false;
	}

	const haystack = [group.id.replaceAll('_', ' '), group.humanLabel, group.category, ...group.aliases]
		.join(' ')
		.toLowerCase();

	return queryTerms.some((term) => haystack.includes(term));
}

export async function listSemanticMaterialsByTags(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string,
	tags: VehicleSemanticTag[]
): Promise<VehicleSemanticMaterialSuggestion[]> {
	const overlay = await readFreshOverlay(assetId, structuralGeneratedAt);
	if (!overlay) {
		return [];
	}

	return overlay.acceptedMaterials.filter((material) =>
		material.semanticTags.some((tag) => tags.includes(tag))
	);
}

export async function listSemanticMaterialsByQuery(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string,
	query: string
): Promise<VehicleSemanticMaterialSuggestion[]> {
	const overlay = await readFreshOverlay(assetId, structuralGeneratedAt);
	if (!overlay) {
		return [];
	}

	return overlay.acceptedMaterials.filter((material) => materialMatchesQuery(material, query));
}

export async function listSemanticPartsByQuery(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string,
	query: string
): Promise<VehicleSemanticPartUnit[]> {
	const overlay = await readFreshOverlay(assetId, structuralGeneratedAt);
	if (!overlay) {
		return [];
	}

	return overlay.acceptedParts.filter((part) => partMatchesQuery(part, query));
}

export async function listSemanticGroupsByQuery(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string,
	query: string,
	support?: VehicleSemanticActionSupport
): Promise<VehicleSemanticGroup[]> {
	const overlay = await readFreshOverlay(assetId, structuralGeneratedAt);
	if (!overlay) {
		return [];
	}

	const structure = await deriveStructuralAssetSnapshot(assetId);
	const structuralMaterialsById = new Map(structure.materials.map((material) => [material.id, material]));
	const semanticMaterialsById = new Map(
		overlay.acceptedMaterials.map((material) => [material.targetId, material])
	);
	const sanitizedGroups = overlay.acceptedGroups
		.map((group) => ({
			...group,
			materialIds: group.materialIds.filter((materialId) => {
				const structuralMaterial = structuralMaterialsById.get(materialId);
				if (!structuralMaterial) {
					return false;
				}

				return isMaterialCompatibleWithGroupCategory(
					group.category,
					structuralMaterial,
					semanticMaterialsById.get(materialId)
				);
			})
		}))
		.filter(
			(group) =>
				group.nodeIds.length > 0 || group.meshIds.length > 0 || group.materialIds.length > 0
		);

	const matchedGroups = sanitizedGroups.filter(
		(group) => groupMatchesQuery(group, query) && (!support || group.supports.includes(support))
	);
	const rankedGroups = matchedGroups.sort((left, right) => {
		const leftCoverageScore =
			(left.nodeIds.length > 0 ? 1000 : 0) + (left.meshIds.length > 0 ? 100 : 0) + left.materialIds.length;
		const rightCoverageScore =
			(right.nodeIds.length > 0 ? 1000 : 0) + (right.meshIds.length > 0 ? 100 : 0) + right.materialIds.length;
		const preferStructuralCoverage =
			support === 'explode' || support === 'focus' || support === 'isolate';

		if (preferStructuralCoverage && leftCoverageScore !== rightCoverageScore) {
			return rightCoverageScore - leftCoverageScore;
		}

		const leftSyntheticScore = left.derivedFrom?.includes('synthetic') ? 1 : 0;
		const rightSyntheticScore = right.derivedFrom?.includes('synthetic') ? 1 : 0;
		if (leftSyntheticScore !== rightSyntheticScore) {
			return rightSyntheticScore - leftSyntheticScore;
		}

		if (!preferStructuralCoverage && leftCoverageScore !== rightCoverageScore) {
			return rightCoverageScore - leftCoverageScore;
		}

		if (left.confidence !== right.confidence) {
			return right.confidence - left.confidence;
		}

		return left.id.localeCompare(right.id);
	});
	const deduped = new Map<string, VehicleSemanticGroup>();

	for (const group of rankedGroups) {
		const selectionKey =
			group.category === 'other' ? `${group.category}:${slugifyPartId(group.humanLabel)}` : group.category;
		if (!deduped.has(selectionKey)) {
			deduped.set(selectionKey, group);
		}
	}

	return Array.from(deduped.values());
}
