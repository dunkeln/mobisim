import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import {
	readAssetSemanticAssignments,
	listReviewedSemanticGroupExamples
} from '$lib/server/connectors/asset-semantic-assignments';
import { upsertPendingAssetSemanticProposals } from '$lib/server/connectors/asset-semantic-proposals';
import {
	findSemanticGroupDefinition,
	ensureSemanticGroupDefinition,
	resolveSemanticGroupDefinition,
	readSemanticGroupDefinitions
} from '$lib/server/connectors/semantic-groups';
import {
	deleteJsonObject,
	readJsonObject,
	writeJsonObject
} from '$lib/server/connectors/vehicle-registry/s3';
import {
	resolveSemanticOverlayKey
} from '$lib/server/connectors/vehicle-registry/storage';
import type { VehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess/types';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	GenerateVehicleSemanticOverlayOptions,
	VehicleSemanticActionSupport,
	VehicleSemanticAssignmentMutation,
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

export function buildVehicleSemanticOverlaySnapshot(input: {
	overlay: VehicleSemanticOverlay | null;
	overlayStatus: VehicleSemanticOverlayStatus;
	commandStatus?: string;
	appliedCommand?: string;
}) {
	return {
		overlay: input.overlay,
		overlayRevision: input.overlay?.revision ?? null,
		overlayStatus: input.overlayStatus,
		...(input.commandStatus ? { commandStatus: input.commandStatus } : {}),
		...(input.appliedCommand ? { appliedCommand: input.appliedCommand } : {})
	};
}

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
		const scoreDelta =
			scoreSemanticPriority(getValue(right)) - scoreSemanticPriority(getValue(left));
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

function normalizeSuggestion(value: unknown): VehicleSemanticMaterialSuggestion | null {
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
	return (
		value === 'front' || value === 'rear' || value === 'mid' || value === 'roof' || value === 'full'
	);
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
		value === 'paint' ||
		value === 'tint'
	);
}

function isVehicleSemanticGroupCategory(value: unknown): value is VehicleSemanticGroup['category'] {
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
	const category = isVehicleSemanticPartCategory(candidate.category) ? candidate.category : 'other';
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

function normalizeOtherCategoryDetail(input: {
	id: string;
	humanLabel: string;
	categoryDetail?: string | undefined;
}): string {
	const explicit = input.categoryDetail?.trim();
	if (explicit && explicit.toLowerCase() !== 'other') {
		return explicit;
	}

	if (input.id === 'vehicle' || input.humanLabel.trim().toLowerCase() === 'vehicle') {
		return 'asset';
	}

	const label = input.humanLabel.trim();
	if (label.length > 0 && label.toLowerCase() !== 'other') {
		return label;
	}

	return 'misc';
}

function getCanonicalSemanticGroupId(input: {
	id: string;
	category: VehicleSemanticGroup['category'];
	humanLabel: string;
	categoryDetail?: string;
}): string {
	if (input.category !== 'other') {
		return input.category;
	}

	const detail = normalizeOtherCategoryDetail({
		id: input.id,
		humanLabel: input.humanLabel,
		categoryDetail: input.categoryDetail
	});
	return slugifyPartId(detail) || 'group';
}

function normalizeGroup(value: unknown): VehicleSemanticGroup | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const humanLabel = typeof candidate.humanLabel === 'string' ? candidate.humanLabel.trim() : '';
	const idCandidate = typeof candidate.id === 'string' ? candidate.id.trim() : '';
	const categoryDetail =
		typeof candidate.categoryDetail === 'string'
			? candidate.categoryDetail.trim() || undefined
			: undefined;
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
	const materialIds = normalizeStringArray(candidate.materialIds);

	if (
		humanLabel.length === 0 ||
		supports.length === 0 ||
		(nodeIds.length === 0 && materialIds.length === 0) ||
		!Number.isFinite(confidence)
	) {
		return null;
	}

	if (
		typeof candidate.author !== 'string' ||
		(candidate.author !== 'user' && candidate.author !== 'agent')
	) {
		return null;
	}

	const normalizedId =
		category !== 'other' && idCandidate.length > 0
			? slugifyPartId(idCandidate)
			: getCanonicalSemanticGroupId({
					id: idCandidate,
					category,
					humanLabel,
					categoryDetail
				});

	return {
		id: normalizedId,
		humanLabel:
			category === 'other'
				? normalizeOtherCategoryDetail({
						id: idCandidate,
						humanLabel,
						categoryDetail
					})
				: humanLabel,
		categoryDetail:
			category === 'other'
				? normalizeOtherCategoryDetail({
						id: idCandidate,
						humanLabel,
						categoryDetail
					})
				: undefined,
		aliases,
		confidence: Math.min(1, Math.max(0, confidence)),
		category,
		supports,
		nodeIds,
		meshIds: [],
		materialIds,
		author: candidate.author
	};
}

async function buildPrompt(
	capabilities: VehicleInspectionCapabilities,
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	budget: SemanticPromptBudget
): Promise<string> {
	const [{ definitions }, reviewedExamplesByGroup] = await Promise.all([
		readSemanticGroupDefinitions(),
		listReviewedSemanticGroupExamples({
			excludeAssetId: capabilities.assetId,
			maxExamplesPerGroup: 2
		})
	]);
	const prioritizedMaterials = sortBySemanticPriority(
		capabilities.materials,
		(material) => material.name
	).slice(0, budget.maxMaterials);
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
			semanticGroupDefinitions: definitions.map((definition) => ({
				id: definition.id,
				humanLabel: definition.humanLabel,
				aliases: definition.aliases.slice(0, 6),
				category: definition.category,
				supports: definition.supports,
				assignmentMode: definition.assignmentMode,
				exclusiveFamily: definition.exclusiveFamily
			})),
			reviewedSemanticExamples: Object.fromEntries(
				Object.entries(reviewedExamplesByGroup).map(([semanticGroupId, examples]) => [
					semanticGroupId,
					examples.map((example) => ({
						assetId: example.assetId,
						nodeNames: example.nodeNames.map((value) =>
							truncateString(value, budget.maxStringLength)
						),
						pathHints: example.pathHints.map((value) =>
							truncateString(value, budget.maxStringLength)
						),
						meshNames: example.meshNames.map((value) =>
							truncateString(value, budget.maxStringLength)
						),
						materialNames: example.materialNames.map((value) =>
							truncateString(value, budget.maxStringLength)
						)
					}))
				])
			),
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
													enum: ['highlight', 'focus', 'isolate', 'paint', 'tint']
												}
											},
											nodeIds: { type: 'array', items: { type: 'string' } },
											materialIds: { type: 'array', items: { type: 'string' } },
											author: {
												type: 'string',
												enum: ['agent']
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
											'materialIds',
											'author'
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
						content: `You enrich deterministic GLB manifests with semantic material labels and node-to-group proposals.
Only use material IDs supplied in the input.
Do not invent missing IDs, nodes, meshes, materials, or vehicle parts.
Prefer precision over recall. Skip uncertain labels instead of guessing.
Return only material-level suggestions for these stable semantic tags: ${VEHICLE_SEMANTIC_TAGS.join(', ')}.
Return part assemblies only when they can be grounded to real nodeIds, meshIds, or materialIds from the input.
Return semantic operational groups only when they can be grounded to real nodeIds or materialIds and align with the shared semantic group definitions in the input.
Use reviewed semantic examples as reusable hints for how existing group definitions map onto node names, paths, meshes, and materials across assets.
Prefer proposing assignments to existing definitions over inventing new abstractions.
Good examples: wheels, doors, front lighting, rear lighting, glasshouse, body shell, front face, trim, interior, and inferred units like propeller or number plate when the definition exists or must be justified.
Groups must declare which actions they support, such as highlight, focus, isolate, paint, or tint.
Use aliases that help a planner match human requests like body color, glass tint, headlights, grille, or wheels.`
					},
					{
						role: 'user',
						content: await buildPrompt(capabilities, structure, budget)
					}
				]
			});

			const content = completion.choices[0]?.message.content;
			if (!content) {
				throw new VehicleSemanticOverlayUpstreamError(
					'OpenAI returned no semantic overlay content.'
				);
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
			humanLabel:
				existing.humanLabel.length >= suggestion.humanLabel.length
					? existing.humanLabel
					: suggestion.humanLabel,
			aliases: Array.from(new Set([...existing.aliases, ...suggestion.aliases])).sort(
				(left, right) => left.localeCompare(right)
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
			humanLabel:
				existing.humanLabel.length >= part.humanLabel.length
					? existing.humanLabel
					: part.humanLabel,
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
		acceptedParts: Array.from(accepted.values()).sort((left, right) =>
			left.id.localeCompare(right.id)
		),
		discardedSuggestions
	};
}

function validateGroups(
	groups: VehicleSemanticGroup[],
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	acceptedMaterials: VehicleSemanticMaterialSuggestion[],
	acceptedParts: VehicleSemanticPartUnit[],
	minAcceptedConfidence: number
): {
	acceptedGroups: VehicleSemanticGroup[];
	discardedSuggestions: VehicleSemanticOverlayDiscard[];
} {
	const validNodeIds = new Set(structure.nodes.map((node) => node.id));
	const validMeshIds = new Set(structure.meshes.map((mesh) => mesh.id));
	const validMaterialIds = new Set(structure.materials.map((material) => material.id));
	const structuralMaterialsById = new Map(
		structure.materials.map((material) => [material.id, material])
	);
	const semanticMaterialsById = new Map(
		acceptedMaterials.map((material) => [material.targetId, material])
	);

	const groupIntersectsPart = (
		group: VehicleSemanticGroup,
		part: VehicleSemanticPartUnit
	): boolean =>
		group.nodeIds.some((nodeId) => part.nodeIds.includes(nodeId)) ||
		group.materialIds.some((materialId) => part.materialIds.includes(materialId));

	const hasStructuralGroupCoverage = (
		group: VehicleSemanticGroup,
		materialIds: string[]
	): boolean => {
		const supportingParts = acceptedParts.filter((part) => groupIntersectsPart(group, part));
		return group.nodeIds.length > 0 || materialIds.length > 0 || supportingParts.length > 0;
	};

	const hasExecutableGroupCoverage = (
		group: VehicleSemanticGroup,
		compatibleMaterialIds: string[]
	): boolean => {
		const supportingParts = acceptedParts.filter((part) => groupIntersectsPart(group, part));
		switch (group.category) {
			case 'front_lighting':
				return compatibleMaterialIds.some((materialId) => {
					const material = semanticMaterialsById.get(materialId);
					return (
						material?.semanticTags.includes('left_headlight') === true ||
						material?.semanticTags.includes('right_headlight') === true
					);
				});
			case 'rear_lighting':
				return (
					compatibleMaterialIds.length > 0 &&
					supportingParts.some(
						(part) =>
							part.category === 'light' &&
							part.region === 'rear' &&
							part.materialIds.some((materialId) => compatibleMaterialIds.includes(materialId))
					)
				);
			case 'wheels':
				return supportingParts.some(
					(part) =>
						part.category === 'wheel' &&
						part.materialIds.some((materialId) => compatibleMaterialIds.includes(materialId))
				);
			case 'doors':
				return supportingParts.some((part) => part.category === 'door');
			default:
				return (
					group.nodeIds.length > 0 ||
					compatibleMaterialIds.length > 0 ||
					supportingParts.length > 0
				);
		}
	};

	const accepted: VehicleSemanticGroup[] = [];
	const discardedSuggestions: VehicleSemanticOverlayDiscard[] = [];

	for (const group of groups) {
		const structurallyValidMaterialIds = group.materialIds.filter((materialId) =>
			validMaterialIds.has(materialId)
		);
		const compatibleMaterialIds = structurallyValidMaterialIds.filter((materialId) => {
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
		const retainedMaterialIds =
			group.author === 'user' ? structurallyValidMaterialIds : compatibleMaterialIds;
		const normalizedGroup =
			retainedMaterialIds.length === group.materialIds.length
				? group
				: {
						...group,
						materialIds: retainedMaterialIds
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
			normalizedGroup.materialIds.some((materialId) => !validMaterialIds.has(materialId))
		) {
			discardedSuggestions.push({
				kind: 'group',
				payload: normalizedGroup,
				reason: 'Group references unknown structural IDs'
			});
			continue;
		}

		const hasCoverage =
			group.author === 'user'
				? hasStructuralGroupCoverage(normalizedGroup, retainedMaterialIds)
				: hasExecutableGroupCoverage(normalizedGroup, compatibleMaterialIds);
		if (!hasCoverage) {
			discardedSuggestions.push({
				kind: 'group',
				payload: normalizedGroup,
				reason: 'Group has no executable semantic coverage after validation'
			});
			continue;
		}

		accepted.push(normalizedGroup);
	}

	return {
		acceptedGroups: reduceSemanticGroups(accepted),
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

	const glassSignals = positiveMatches(
		/\b(window|windshield|windscreen|glass|rearglass|backglass|quarter)\b/i
	);
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
			materialIds: matched
				.map((entry) => entry.targetId)
				.sort((left, right) => left.localeCompare(right)),
			author: 'agent' as const
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
			meshIds: [],
			materialIds: Array.from(new Set(matched.flatMap((entry) => entry.materialIds))).sort(
				(left, right) => left.localeCompare(right)
			),
			author: 'agent' as const
		};
	};

	pushGroup(
		synthFromMaterials(
			'wheels',
			'wheels',
			'wheels',
			['highlight', 'focus', 'isolate'],
			(material) => material.semanticTags.includes('wheel_outer_face'),
			['wheel', 'wheels', 'rim', 'rims']
		)
	);
	pushGroup(
		synthFromMaterials(
			'glasshouse',
			'glasshouse',
			'glasshouse',
			['highlight', 'focus', 'isolate', 'tint'],
			(material) => material.semanticTags.includes('glass_candidate'),
			['glass', 'windows', 'window glass']
		)
	);
	pushGroup(
		synthFromMaterials(
			'body_shell',
			'body shell',
			'body_shell',
			['highlight', 'focus', 'isolate', 'paint'],
			(material) => material.semanticTags.includes('body_paint_candidate'),
			['body', 'body paint', 'exterior paint']
		)
	);
	pushGroup(
		synthFromMaterials(
			'front_face',
			'front face',
			'front_face',
			['highlight', 'focus', 'isolate'],
			(material) =>
				material.semanticTags.includes('front_grille') ||
				material.semanticTags.includes('left_headlight') ||
				material.semanticTags.includes('right_headlight'),
			['nose', 'front end', 'front fascia']
		)
	);
	pushGroup(
		synthFromParts(
			'doors',
			'doors',
			'doors',
			['highlight', 'focus', 'isolate'],
			(part) =>
				part.category === 'door' ||
				/door/i.test(`${part.id} ${part.humanLabel} ${part.aliases.join(' ')}`),
			['door']
		)
	);

	return synthesized;
}

function mapGroupCategoryToPartCategory(
	category: VehicleSemanticGroup['category']
): VehicleSemanticPartCategory {
	switch (category) {
		case 'wheels':
			return 'wheel';
		case 'doors':
			return 'door';
		case 'front_lighting':
		case 'rear_lighting':
			return 'light';
		case 'glasshouse':
			return 'glass';
		case 'body_shell':
			return 'body';
		case 'trim':
			return 'trim';
		case 'interior':
			return 'interior';
		case 'front_face':
		case 'other':
		default:
			return 'other';
	}
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
		revision:
			typeof candidate.revision === 'number' && Number.isFinite(candidate.revision)
				? Math.max(0, Math.trunc(candidate.revision))
				: 0,
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

async function readStoredVehicleSemanticOverlay(
	assetId: VehicleAssetId
): Promise<VehicleSemanticOverlay | null> {
	try {
		const raw = await readJsonObject<VehicleSemanticOverlay>(resolveSemanticOverlayKey(assetId));
		return raw ? normalizeOverlay(raw) : null;
	} catch {
		return null;
	}
}

async function deriveReviewedSemanticGroups(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string,
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>
): Promise<VehicleSemanticGroup[]> {
	const [{ assignments }, { definitions }] = await Promise.all([
		readAssetSemanticAssignments(assetId, structuralGeneratedAt),
		readSemanticGroupDefinitions()
	]);
	const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const materialById = new Map(structure.materials.map((material) => [material.id, material]));
	const groupedAssignments = new Map<string, { nodeIds: string[]; materialIds: string[] }>();

	for (const assignment of assignments) {
		const existing = groupedAssignments.get(assignment.semanticGroupId) ?? {
			nodeIds: [],
			materialIds: []
		};
		if (assignment.nodeId) {
			existing.nodeIds.push(assignment.nodeId);
		}
		if (assignment.materialId) {
			existing.materialIds.push(assignment.materialId);
		}
		groupedAssignments.set(assignment.semanticGroupId, existing);
	}

	const groups: VehicleSemanticGroup[] = [];

	for (const [semanticGroupId, assignedTargets] of groupedAssignments) {
		const definition = definitionById.get(semanticGroupId);
		if (!definition) {
			continue;
		}

		const nodeIds = Array.from(
			new Set([
				...assignedTargets.nodeIds.filter((nodeId) => nodeById.has(nodeId)),
				...assignedTargets.materialIds.flatMap(
					(materialId) => materialById.get(materialId)?.nodeIds ?? []
				)
			])
		).sort((left, right) => left.localeCompare(right));
		const directMaterialIds = Array.from(
			new Set(assignedTargets.materialIds.filter((materialId) => materialById.has(materialId)))
		).sort((left, right) => left.localeCompare(right));
		if (nodeIds.length === 0 && directMaterialIds.length === 0) {
			continue;
		}

		const materialIds = directMaterialIds;

		groups.push({
			id: definition.id,
			humanLabel: definition.humanLabel,
			categoryDetail: definition.categoryDetail,
			aliases: definition.aliases,
			confidence: 1,
			category: definition.category,
			supports: definition.supports,
			nodeIds,
			meshIds: [],
			materialIds,
			author: 'user' as const
		});
	}

	return groups.sort((left, right) => left.id.localeCompare(right.id));
}

function resolveGroupNodeIds(
	group: VehicleSemanticGroup,
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>
): string[] {
	const materialById = new Map(structure.materials.map((material) => [material.id, material]));

	return Array.from(
		new Set([
			...group.nodeIds,
			...group.materialIds.flatMap((materialId) => materialById.get(materialId)?.nodeIds ?? [])
		])
	).sort((left, right) => left.localeCompare(right));
}

async function persistSemanticGroupProposals(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string,
	groups: VehicleSemanticGroup[],
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>
): Promise<VehicleSemanticOverlayDiscard[]> {
	const discards: VehicleSemanticOverlayDiscard[] = [];

	for (const group of groups) {
		const definition = await ensureSemanticGroupDefinition({
			category: group.category,
			humanLabel: group.humanLabel,
			aliases: group.aliases
		});
		const nodeIds = resolveGroupNodeIds(group, structure);

		if (nodeIds.length === 0) {
			discards.push({
				kind: 'group',
				payload: group,
				reason: 'LLM semantic group proposal could not be grounded to structural node IDs'
			});
			continue;
		}

		await upsertPendingAssetSemanticProposals({
			assetId,
			structuralGeneratedAt,
			nodeIds,
			semanticGroupId: definition.id,
			confidence: group.confidence
		});
	}

	return discards;
}

export async function readVehicleSemanticOverlay(
	assetId: VehicleAssetId
): Promise<VehicleSemanticOverlay | null> {
	return readStoredVehicleSemanticOverlay(assetId);
}

export async function writeVehicleSemanticOverlay(
	overlay: Omit<VehicleSemanticOverlay, 'revision'> & { revision?: number }
): Promise<VehicleSemanticOverlay> {
	const current = await readStoredVehicleSemanticOverlay(overlay.assetId);
	const canonicalGroups = reduceSemanticGroups(
		overlay.acceptedGroups
			.map((group) => ({
				...group,
				meshIds: [],
				id: getCanonicalSemanticGroupId({
					id: group.id,
					category: group.category,
					humanLabel: group.humanLabel,
					categoryDetail: group.categoryDetail
				})
			}))
			.filter((group) => group.nodeIds.length > 0 || group.materialIds.length > 0)
	);
	const nextOverlay: VehicleSemanticOverlay = {
		...overlay,
		acceptedGroups: canonicalGroups,
		revision: (current?.revision ?? 0) + 1
	};
	await writeJsonObject(resolveSemanticOverlayKey(overlay.assetId), nextOverlay);
	return nextOverlay;
}

export async function deleteVehicleSemanticOverlay(
	assetId: VehicleAssetId
): Promise<boolean> {
	const existing = await readStoredVehicleSemanticOverlay(assetId);
	if (!existing) {
		return false;
	}

	await deleteJsonObject(resolveSemanticOverlayKey(assetId));
	return true;
}

export async function generateVehicleSemanticOverlay(
	assetId: VehicleAssetId,
	options: GenerateVehicleSemanticOverlayOptions = {}
): Promise<VehicleSemanticOverlay> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const structure = await deriveStructuralAssetSnapshot(assetId);
	const minAcceptedConfidence = options.minAcceptedConfidence ?? DEFAULT_MIN_ACCEPTED_CONFIDENCE;
	const existing = await readStoredVehicleSemanticOverlay(assetId);

	if (
		existing &&
		!options.force &&
		existing.structuralGeneratedAt === capabilities.generatedAt &&
		existing.minAcceptedConfidence === minAcceptedConfidence
	) {
		const sanitizedStructure = await deriveStructuralAssetSnapshot(existing.assetId);
		const sanitizedValidation = validateGroups(
			existing.acceptedGroups,
			sanitizedStructure,
			existing.acceptedMaterials,
			existing.acceptedParts,
			existing.minAcceptedConfidence
		);
		if (
			JSON.stringify(existing.acceptedGroups) !== JSON.stringify(sanitizedValidation.acceptedGroups) ||
			sanitizedValidation.discardedSuggestions.length !== existing.discardedSuggestions.length
		) {
			return writeVehicleSemanticOverlay({
				...existing,
				acceptedGroups: sanitizedValidation.acceptedGroups,
				discardedSuggestions: [
					...existing.discardedSuggestions,
					...sanitizedValidation.discardedSuggestions
				]
			});
		}

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
	const proposalDiscards = await persistSemanticGroupProposals(
		assetId,
		capabilities.generatedAt,
		normalizedGroups,
		structure
	);
	const validatedMaterials = validateMaterials(
		normalizedMaterials,
		capabilities,
		minAcceptedConfidence
	);
	const validatedParts = validateParts(normalizedParts, structure, minAcceptedConfidence);
	const validatedModelGroups = validateGroups(
		normalizedGroups,
		structure,
		validatedMaterials.acceptedMaterials,
		validatedParts.acceptedParts,
		minAcceptedConfidence
	);
	const validatedSynthesizedGroups = validateGroups(
		synthesizeSemanticGroups(validatedMaterials.acceptedMaterials, validatedParts.acceptedParts),
		structure,
		validatedMaterials.acceptedMaterials,
		validatedParts.acceptedParts,
		minAcceptedConfidence
	);

	// Read existing overlay to preserve user-authored groups
	const existingOverlay = await readStoredVehicleSemanticOverlay(assetId);
	const preservedUserGroups = existingOverlay?.acceptedGroups.filter((g) => g.author === 'user') ?? [];

	const mergedGroupValidation = validateGroups(
		reduceVisibleSemanticGroups(
			reduceSemanticGroups([
				...validatedModelGroups.acceptedGroups,
				...validatedSynthesizedGroups.acceptedGroups,
				...preservedUserGroups
			])
		),
		structure,
		validatedMaterials.acceptedMaterials,
		validatedParts.acceptedParts,
		minAcceptedConfidence
	);
	const mergedGroups = mergedGroupValidation.acceptedGroups;

	return writeVehicleSemanticOverlay({
		assetId,
		structuralGeneratedAt: capabilities.generatedAt,
		generatedAt: new Date().toISOString(),
		model: getSemanticModel(),
		minAcceptedConfidence,
		acceptedMaterials: validatedMaterials.acceptedMaterials,
		acceptedParts: validatedParts.acceptedParts,
		acceptedGroups: reduceSemanticGroups(
			mergedGroups
				.map((group) => ({
					...group,
					meshIds: [],
					id: getCanonicalSemanticGroupId({
						id: group.id,
						category: group.category,
						humanLabel: group.humanLabel,
						categoryDetail: group.categoryDetail
					})
				}))
				.filter((group) => group.nodeIds.length > 0 || group.materialIds.length > 0)
		),
		discardedSuggestions: [
			...validatedMaterials.discardedSuggestions,
			...validatedParts.discardedSuggestions,
			...validatedModelGroups.discardedSuggestions,
			...validatedSynthesizedGroups.discardedSuggestions,
			...mergedGroupValidation.discardedSuggestions,
			...proposalDiscards
		]
	});
}

function buildMutationMaterialIds(input: {
	nodes: Array<{ id: string; meshId?: string | null }>;
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>;
	materialSelections?: VehicleSemanticAssignmentMutation['materialSelections'];
	materialIds?: string[];
}): string[] {
	const meshById = new Map(input.structure.meshes.map((mesh) => [mesh.id, mesh]));
	return Array.from(
		new Set([
			...(input.materialIds ?? []),
			...(input.materialSelections ?? []).flatMap((selection) => {
				const node = input.nodes.find((entry) => entry.id === selection.nodeId);
				if (!node?.meshId) {
					return [];
				}

				const mesh = meshById.get(node.meshId);
				if (!mesh) {
					return [];
				}

				if (
					typeof selection.materialIndex === 'number' &&
					selection.materialIndex >= 0 &&
					selection.materialIndex < mesh.materialIds.length
				) {
					return [mesh.materialIds[selection.materialIndex]!];
				}

				if (selection.materialName) {
					return mesh.materialIds.filter((materialId, index) => {
						const materialName = mesh.materialNames[index];
						return materialName === selection.materialName;
					});
				}

				return [];
			})
		])
	).sort((left, right) => left.localeCompare(right));
}

export async function mutateVehicleSemanticAssignment(
	assetId: VehicleAssetId,
	mutation: VehicleSemanticAssignmentMutation
): Promise<VehicleSemanticOverlay> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const structure = await deriveStructuralAssetSnapshot(assetId);
	const annotationNodeIds = Array.from(new Set(mutation.nodeIds)).sort((left, right) =>
		left.localeCompare(right)
	);
	const nodes = annotationNodeIds
		.map((nodeId) => structure.nodes.find((entry) => entry.id === nodeId))
		.filter((node): node is NonNullable<typeof node> => node !== undefined);

	if (nodes.length !== annotationNodeIds.length) {
		const knownNodeIds = new Set(nodes.map((node) => node.id));
		const unknownNodeIds = annotationNodeIds.filter((nodeId) => !knownNodeIds.has(nodeId));
		throw new Error(`Unknown node ID: ${unknownNodeIds.join(', ')}`);
	}

	const overlay = await readVehicleSemanticOverlay(assetId);
	const baseOverlay: VehicleSemanticOverlay =
		overlay && overlay.structuralGeneratedAt === capabilities.generatedAt
			? overlay
			: {
					assetId,
					revision: (await readStoredVehicleSemanticOverlay(assetId))?.revision ?? 0,
					structuralGeneratedAt: capabilities.generatedAt,
					generatedAt: new Date().toISOString(),
					model: getSemanticModel(),
					minAcceptedConfidence: DEFAULT_MIN_ACCEPTED_CONFIDENCE,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [],
					discardedSuggestions: []
				};

	const materialIds = buildMutationMaterialIds({
		nodes,
		structure,
		materialSelections: mutation.materialSelections,
		materialIds: mutation.materialIds
	});

	if (annotationNodeIds.length === 0 && materialIds.length === 0) {
		throw new Error('At least one runtime node or material target is required.');
	}

	// Resolve the target group definition
	const definition = await (mutation.action === 'unassign'
		? findSemanticGroupDefinition({
				semanticGroup: mutation.semanticGroup,
				category: mutation.category
			})
		: resolveSemanticGroupDefinition({
				semanticGroup: mutation.semanticGroup,
				category: mutation.category,
				humanLabel: mutation.humanLabel,
				aliases: mutation.aliases
			}));

	if (!definition) {
		throw new Error('Could not resolve semantic group definition');
	}

	// Compute the group ID using the same scheme as deriveReviewedSemanticGroups
	const groupId = definition.id;

	const targetGroup = baseOverlay.acceptedGroups.find((group) => group.id === groupId);

	if (mutation.action === 'reassign') {
		const { definitions } = await readSemanticGroupDefinitions();
		const definitionById = new Map(definitions.map((entry) => [entry.id, entry]));
		for (const group of baseOverlay.acceptedGroups) {
			const groupDef = definitionById.get(group.id);
			if (
				groupDef &&
				groupDef.exclusiveFamily &&
				groupDef.exclusiveFamily === definition.exclusiveFamily &&
				groupDef.id !== definition.id
			) {
				group.nodeIds = group.nodeIds.filter((nodeId) => !annotationNodeIds.includes(nodeId));
				group.materialIds = group.materialIds.filter((materialId) => !materialIds.includes(materialId));
				group.meshIds = [];
			}
		}
	}

	if (mutation.action === 'assign' || mutation.action === 'reassign') {
		const nextTargetGroup =
			targetGroup ??
			({
				id: groupId,
				humanLabel: definition.humanLabel,
				categoryDetail: definition.categoryDetail,
				aliases: definition.aliases,
				confidence: 1,
				category: definition.category,
				supports: definition.supports,
				nodeIds: [],
				meshIds: [],
				materialIds: [],
				author: 'user'
			} as VehicleSemanticGroup);

		nextTargetGroup.author = 'user';
		nextTargetGroup.nodeIds = Array.from(new Set([...nextTargetGroup.nodeIds, ...annotationNodeIds])).sort(
			(left, right) => left.localeCompare(right)
		);
		nextTargetGroup.materialIds = Array.from(new Set([...nextTargetGroup.materialIds, ...materialIds])).sort(
			(left, right) => left.localeCompare(right)
		);
		nextTargetGroup.meshIds = [];

		if (!targetGroup) {
			baseOverlay.acceptedGroups.push(nextTargetGroup);
		}
	} else {
		if (targetGroup) {
			targetGroup.nodeIds = targetGroup.nodeIds.filter((nodeId) => !annotationNodeIds.includes(nodeId));
			targetGroup.materialIds = targetGroup.materialIds.filter((materialId) => !materialIds.includes(materialId));
			if (targetGroup.author === 'user' && targetGroup.nodeIds.length === 0 && targetGroup.materialIds.length === 0) {
				baseOverlay.acceptedGroups = baseOverlay.acceptedGroups.filter((group) => group.id !== groupId);
			} else {
				targetGroup.meshIds = [];
			}
		}
	}

	return writeVehicleSemanticOverlay(baseOverlay);
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

	const haystack = [
		group.id.replaceAll('_', ' '),
		group.humanLabel,
		group.categoryDetail ?? '',
		group.category,
		...group.aliases
	]
		.join(' ')
		.toLowerCase();

	return queryTerms.some((term) => haystack.includes(term));
}

export async function listSemanticMaterialsByTags(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string,
	tags: VehicleSemanticTag[]
): Promise<VehicleSemanticMaterialSuggestion[]> {
	const overlay = await readVehicleSemanticOverlay(assetId);
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
	const overlay = await readVehicleSemanticOverlay(assetId);
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
	const overlay = await readVehicleSemanticOverlay(assetId);
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
	const overlay = await readVehicleSemanticOverlay(assetId);
	if (!overlay) {
		return [];
	}

	const structure = await deriveStructuralAssetSnapshot(assetId);
	const validMaterialIds = new Set(structure.materials.map((material) => material.id));
	const validNodeIds = new Set(structure.nodes.map((node) => node.id));
	const matchedGroups = overlay.acceptedGroups
		.map((group) => ({
			...group,
			nodeIds: group.nodeIds.filter((nodeId) => validNodeIds.has(nodeId)),
			materialIds: group.materialIds.filter((materialId) => validMaterialIds.has(materialId))
		}))
		.filter((group) => group.nodeIds.length > 0 || group.materialIds.length > 0)
		.filter(
		(group) => groupMatchesQuery(group, query) && (!support || group.supports.includes(support))
		);
	return reduceVisibleSemanticGroups(matchedGroups, support);
}

function mergeSemanticGroup(
	existing: VehicleSemanticGroup,
	incoming: VehicleSemanticGroup
): VehicleSemanticGroup {
	return {
		...existing,
		humanLabel:
			existing.humanLabel.length >= incoming.humanLabel.length
				? existing.humanLabel
				: incoming.humanLabel,
		aliases: Array.from(new Set([...existing.aliases, ...incoming.aliases])).sort((left, right) =>
			left.localeCompare(right)
		),
		confidence: Math.max(existing.confidence, incoming.confidence),
		categoryDetail:
			existing.category === 'other' || incoming.category === 'other'
				? normalizeOtherCategoryDetail({
						id: existing.id,
						humanLabel:
							existing.humanLabel.length >= incoming.humanLabel.length
								? existing.humanLabel
								: incoming.humanLabel,
						categoryDetail: existing.categoryDetail ?? incoming.categoryDetail
					})
				: undefined,
		supports: Array.from(new Set([...existing.supports, ...incoming.supports])).sort(
			(left, right) => left.localeCompare(right)
		),
		nodeIds: Array.from(new Set([...existing.nodeIds, ...incoming.nodeIds])).sort((left, right) =>
			left.localeCompare(right)
		),
		meshIds: [],
		materialIds: Array.from(new Set([...existing.materialIds, ...incoming.materialIds])).sort(
			(left, right) => left.localeCompare(right)
		),
		author: (existing.author === 'user' || incoming.author === 'user') ? 'user' : 'agent'
	};
}

function reduceSemanticGroups(groups: VehicleSemanticGroup[]): VehicleSemanticGroup[] {
	const reduced = new Map<string, VehicleSemanticGroup>();

	for (const group of groups) {
		const existing = reduced.get(group.id);
		reduced.set(group.id, existing ? mergeSemanticGroup(existing, group) : group);
	}

	return Array.from(reduced.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function getSemanticGroupSelectionKey(group: VehicleSemanticGroup): string {
	return group.category === 'other'
		? slugifyPartId(group.categoryDetail ?? group.humanLabel)
		: group.category;
}

function reduceVisibleSemanticGroups(
	groups: VehicleSemanticGroup[],
	support?: VehicleSemanticActionSupport
): VehicleSemanticGroup[] {
	const rankedGroups = [...groups].sort((left, right) => {
		const leftCoverageScore = (left.nodeIds.length > 0 ? 1000 : 0) + left.materialIds.length;
		const rightCoverageScore =
			(right.nodeIds.length > 0 ? 1000 : 0) + right.materialIds.length;
		const preferStructuralCoverage = support === 'focus' || support === 'isolate';

		if (preferStructuralCoverage && leftCoverageScore !== rightCoverageScore) {
			return rightCoverageScore - leftCoverageScore;
		}

		const leftAgentScore = left.author === 'agent' ? 1 : 0;
		const rightAgentScore = right.author === 'agent' ? 1 : 0;
		if (leftAgentScore !== rightAgentScore) {
			return rightAgentScore - leftAgentScore;
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
		const selectionKey = getSemanticGroupSelectionKey(group);
		const existing = deduped.get(selectionKey);
		deduped.set(selectionKey, existing ? mergeSemanticGroup(existing, group) : group);
	}

	return Array.from(deduped.values());
}
