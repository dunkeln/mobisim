import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { readVehicleSemanticOverlay } from '$lib/server/connectors/vehicle-semantic-overlay';
import {
	resolveSemanticIngressDirectory,
	resolveSemanticIngressPath
} from '$lib/server/connectors/vehicle-registry/storage';
import type {
	AssignSemanticIngressInput,
	IngestSemanticIngressSamplesInput,
	SemanticIngressBinding,
	SemanticIngressNumericSample,
	SemanticIngressSnapshot,
	SemanticIngressStore
} from './types';

const MAX_SAMPLES_PER_INGRESS = 240;
const ingressSubscribers = new Map<string, Set<(sample: SemanticIngressNumericSample) => void>>();

function slugify(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}

function buildIngressPaths(
	assetId: string,
	ingressId: string,
	transport: SemanticIngressBinding['transport']
): Pick<SemanticIngressBinding, 'restPath' | 'ssePath' | 'streamPath'> {
	const basePath = `/api/vehicle-assets/${assetId}/semantic-ingress/${ingressId}`;
	if (transport === 'stream') {
		return {
			streamPath: `${basePath}/events`
		};
	}

	return {
		restPath: basePath,
		ssePath: `${basePath}/events`
	};
}

function normalizeBinding(value: unknown): SemanticIngressBinding | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const ingressId = typeof candidate.ingressId === 'string' ? candidate.ingressId.trim() : '';
	const assetId = typeof candidate.assetId === 'string' ? candidate.assetId.trim() : '';
	const structuralGeneratedAt =
		typeof candidate.structuralGeneratedAt === 'string' ? candidate.structuralGeneratedAt : '';
	const targetType =
		candidate.targetType === 'semantic_group' || candidate.targetType === 'semantic_node'
			? candidate.targetType
			: null;
	const targetId = typeof candidate.targetId === 'string' ? candidate.targetId.trim() : '';
	const targetLabel =
		typeof candidate.targetLabel === 'string' ? candidate.targetLabel.trim() || undefined : undefined;
	const transport =
		candidate.transport === 'rest_sse' || candidate.transport === 'stream'
			? candidate.transport
			: null;
	const assignedAt = typeof candidate.assignedAt === 'string' ? candidate.assignedAt : '';
	const assignedBy =
		candidate.assignedBy === 'model' || candidate.assignedBy === 'user' ? candidate.assignedBy : null;

	if (!ingressId || !assetId || !structuralGeneratedAt || !targetType || !targetId || !transport || !assignedAt || !assignedBy) {
		return null;
	}

	return {
		ingressId,
		assetId: assetId as SemanticIngressBinding['assetId'],
		structuralGeneratedAt,
		targetType,
		targetId,
		targetLabel,
		transport,
		assignedAt,
		assignedBy,
		restPath: typeof candidate.restPath === 'string' ? candidate.restPath : undefined,
		ssePath: typeof candidate.ssePath === 'string' ? candidate.ssePath : undefined,
		streamPath: typeof candidate.streamPath === 'string' ? candidate.streamPath : undefined
	};
}

function normalizeSample(value: unknown): SemanticIngressNumericSample | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const timestamp =
		typeof candidate.timestamp === 'string' && candidate.timestamp.trim().length > 0
			? candidate.timestamp
			: null;
	const valueNumber =
		typeof candidate.value === 'number' && Number.isFinite(candidate.value)
			? candidate.value
			: null;

	if (!timestamp || valueNumber === null) {
		return null;
	}

	return {
		timestamp,
		value: valueNumber,
		metric:
			typeof candidate.metric === 'string' ? candidate.metric.trim() || undefined : undefined,
		unit: typeof candidate.unit === 'string' ? candidate.unit.trim() || undefined : undefined,
		source:
			typeof candidate.source === 'string' ? candidate.source.trim() || undefined : undefined
	};
}

function ingressSubscriberKey(assetId: string, ingressId: string): string {
	return `${assetId}:${ingressId}`;
}

function publishIngressSamples(
	assetId: string,
	ingressId: string,
	samples: SemanticIngressNumericSample[]
): void {
	const subscribers = ingressSubscribers.get(ingressSubscriberKey(assetId, ingressId));
	if (!subscribers || subscribers.size === 0) {
		return;
	}

	for (const sample of samples) {
		for (const subscriber of subscribers) {
			subscriber(sample);
		}
	}
}

async function readStore(
	assetId: AssignSemanticIngressInput['assetId'],
	structuralGeneratedAt: string
): Promise<SemanticIngressStore> {
	try {
		const raw = JSON.parse(
			await readFile(resolveSemanticIngressPath(assetId, structuralGeneratedAt), 'utf8')
		) as {
			assetId?: string;
			structuralGeneratedAt?: string;
			bindings?: unknown[];
			samplesByIngress?: Record<string, unknown>;
		};

		return {
			assetId,
			structuralGeneratedAt,
			bindings: Array.isArray(raw.bindings)
				? raw.bindings
						.map((entry) => normalizeBinding(entry))
						.filter((entry): entry is SemanticIngressBinding => entry !== null)
				: [],
			samplesByIngress:
				raw.samplesByIngress && typeof raw.samplesByIngress === 'object'
					? Object.fromEntries(
							Object.entries(raw.samplesByIngress).map(([ingressId, samples]) => [
								ingressId,
								Array.isArray(samples)
									? samples
											.map((sample) => normalizeSample(sample))
											.filter((sample): sample is SemanticIngressNumericSample => sample !== null)
											.slice(-MAX_SAMPLES_PER_INGRESS)
									: []
							])
						)
					: {}
		};
	} catch {
		return {
			assetId,
			structuralGeneratedAt,
			bindings: [],
			samplesByIngress: {}
		};
	}
}

async function readLatestStoreForAsset(
	assetId: AssignSemanticIngressInput['assetId']
): Promise<SemanticIngressStore | null> {
	try {
		const directory = resolveSemanticIngressDirectory(assetId);
		const entries = await readdir(directory);
		const storeCandidates = await Promise.all(
			entries
				.filter((entry) => entry.endsWith('.json'))
				.map(async (entry) => {
					const fullPath = resolveSemanticIngressPath(assetId, entry.replace(/\.json$/i, ''));
					const metadata = await stat(fullPath);
					return {
						fullPath,
						structuralGeneratedAt: entry.replace(/\.json$/i, ''),
						mtimeMs: metadata.mtimeMs
					};
				})
		);

		const latest = storeCandidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
		if (!latest) {
			return null;
		}

		return readStore(assetId, latest.structuralGeneratedAt);
	} catch {
		return null;
	}
}

async function writeStore(store: SemanticIngressStore): Promise<SemanticIngressStore> {
	await mkdir(resolveSemanticIngressDirectory(store.assetId), { recursive: true });
	await writeFile(
		resolveSemanticIngressPath(store.assetId, store.structuralGeneratedAt),
		JSON.stringify(store, null, 2),
		'utf8'
	);
	return store;
}

function trimSamples(
	samples: SemanticIngressNumericSample[]
): SemanticIngressNumericSample[] {
	return samples
		.slice()
		.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
		.slice(-MAX_SAMPLES_PER_INGRESS);
}

async function assertTargetExists(input: AssignSemanticIngressInput, structuralGeneratedAt: string): Promise<void> {
	if (input.targetType === 'semantic_node') {
		const structure = await deriveStructuralAssetSnapshot(input.assetId);
		const exists = structure.nodes.some((node) => node.id === input.targetId);
		if (!exists) {
			throw new Error(`Semantic node ${input.targetId} was not found on the active asset.`);
		}
		return;
	}

	const overlay = await readVehicleSemanticOverlay(input.assetId);
	const exists = overlay?.acceptedGroups.some((group) => group.id === input.targetId) ?? false;
	if (!exists) {
		throw new Error(`Semantic group ${input.targetId} was not found on the active asset.`);
	}
	if (overlay?.structuralGeneratedAt !== structuralGeneratedAt) {
		throw new Error('Semantic overlay is stale for ingress assignment. Refresh semantics first.');
	}
}

export async function assignSemanticIngress(
	input: AssignSemanticIngressInput
): Promise<SemanticIngressBinding> {
	const capabilities = await deriveVehicleInspectionCapabilities(input.assetId);
	await assertTargetExists(input, capabilities.generatedAt);
	const store = await readStore(input.assetId, capabilities.generatedAt);
	const ingressId = `${input.targetType}-${slugify(input.targetId)}-${input.transport}`;
	const assignedAt = new Date().toISOString();

	const nextBinding: SemanticIngressBinding = {
		ingressId,
		assetId: input.assetId,
		structuralGeneratedAt: capabilities.generatedAt,
		targetType: input.targetType,
		targetId: input.targetId,
		targetLabel: input.targetLabel,
		transport: input.transport,
		assignedAt,
		assignedBy: input.assignedBy ?? 'user',
		...buildIngressPaths(input.assetId, ingressId, input.transport)
	};

	const filteredBindings = store.bindings.filter(
		(binding) =>
			!(
				binding.targetType === nextBinding.targetType &&
				binding.targetId === nextBinding.targetId &&
				binding.transport === nextBinding.transport
			)
	);

	await writeStore({
		assetId: input.assetId,
		structuralGeneratedAt: capabilities.generatedAt,
		bindings: [...filteredBindings, nextBinding].sort((left, right) =>
			left.ingressId.localeCompare(right.ingressId)
		),
		samplesByIngress: store.samplesByIngress ?? {}
	});

	return nextBinding;
}

export async function listSemanticIngressBindings(
	assetId: AssignSemanticIngressInput['assetId']
): Promise<SemanticIngressStore> {
	return (
		(await readLatestStoreForAsset(assetId)) ?? {
			assetId,
			structuralGeneratedAt: '',
			bindings: [],
			samplesByIngress: {}
		}
	);
}

export async function getSemanticIngressBinding(
	assetId: AssignSemanticIngressInput['assetId'],
	ingressId: string
): Promise<SemanticIngressBinding | null> {
	const store = await listSemanticIngressBindings(assetId);
	return store.bindings.find((binding) => binding.ingressId === ingressId) ?? null;
}

export async function getSemanticIngressSnapshot(
	assetId: AssignSemanticIngressInput['assetId'],
	ingressId: string
): Promise<SemanticIngressSnapshot | null> {
	const store = await listSemanticIngressBindings(assetId);
	const binding = store.bindings.find((entry) => entry.ingressId === ingressId);
	if (!binding) {
		return null;
	}

	return {
		binding,
		samples: trimSamples(store.samplesByIngress?.[ingressId] ?? [])
	};
}

export async function ingestSemanticIngressSamples(
	input: IngestSemanticIngressSamplesInput
): Promise<SemanticIngressSnapshot> {
	const capabilities = await deriveVehicleInspectionCapabilities(input.assetId);
	const store = await readStore(input.assetId, capabilities.generatedAt);
	const binding = store.bindings.find((entry) => entry.ingressId === input.ingressId);
	if (!binding) {
		throw new Error(`Semantic ingress binding ${input.ingressId} was not found on the active asset.`);
	}

	const normalizedSamples = trimSamples(
		input.samples
			.map((sample: SemanticIngressNumericSample) => normalizeSample(sample))
			.filter((sample: SemanticIngressNumericSample | null): sample is SemanticIngressNumericSample => sample !== null)
	);
	if (normalizedSamples.length === 0) {
		throw new Error('At least one valid numeric telemetry sample is required.');
	}

	const nextSamples = trimSamples([
		...(store.samplesByIngress?.[input.ingressId] ?? []),
		...normalizedSamples
	]);
	await writeStore({
		assetId: input.assetId,
		structuralGeneratedAt: capabilities.generatedAt,
		bindings: store.bindings,
		samplesByIngress: {
			...(store.samplesByIngress ?? {}),
			[input.ingressId]: nextSamples
		}
	});
	publishIngressSamples(input.assetId, input.ingressId, normalizedSamples);

	return {
		binding,
		samples: nextSamples
	};
}

export function subscribeSemanticIngressSamples(
	assetId: AssignSemanticIngressInput['assetId'],
	ingressId: string,
	listener: (sample: SemanticIngressNumericSample) => void
): () => void {
	const key = ingressSubscriberKey(assetId, ingressId);
	const listeners = ingressSubscribers.get(key) ?? new Set<(sample: SemanticIngressNumericSample) => void>();
	listeners.add(listener);
	ingressSubscribers.set(key, listeners);

	return () => {
		const current = ingressSubscribers.get(key);
		if (!current) {
			return;
		}

		current.delete(listener);
		if (current.size === 0) {
			ingressSubscribers.delete(key);
		}
	};
}
