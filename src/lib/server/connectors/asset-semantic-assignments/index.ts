import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	resolveSemanticAssignmentsDirectory,
	resolveSemanticAssignmentsPath,
	resolveSemanticAssignmentsRootDirectory
} from '$lib/server/connectors/vehicle-registry/storage';
import { readSemanticGroupDefinitions } from '$lib/server/connectors/semantic-groups';
import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	AssetSemanticAssignmentsStore,
	ReviewedAssetSemanticAssignment,
	ReviewedSemanticGroupExample
} from './types';

function normalizeAssignment(value: unknown): ReviewedAssetSemanticAssignment | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const nodeId = typeof candidate.nodeId === 'string' ? candidate.nodeId.trim() : '';
	const materialId = typeof candidate.materialId === 'string' ? candidate.materialId.trim() : '';
	const semanticGroupId =
		typeof candidate.semanticGroupId === 'string' ? candidate.semanticGroupId.trim() : '';
	const reviewedAt = typeof candidate.reviewedAt === 'string' ? candidate.reviewedAt : '';
	const reviewer =
		candidate.reviewer === 'system' ? 'system' : candidate.reviewer === 'user' ? 'user' : null;

	if ((!nodeId && !materialId) || !semanticGroupId || !reviewedAt || !reviewer) {
		return null;
	}

	return {
		nodeId: nodeId || undefined,
		materialId: materialId || undefined,
		semanticGroupId,
		status: 'reviewed',
		reviewer,
		reviewedAt,
		confidence: 1
	};
}

async function validateAssignments(
	assignments: ReviewedAssetSemanticAssignment[]
): Promise<ReviewedAssetSemanticAssignment[]> {
	const definitions = (await readSemanticGroupDefinitions()).definitions;
	const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
	const deduped = new Map<string, ReviewedAssetSemanticAssignment>();
	const exclusiveByNodeAndFamily = new Map<string, ReviewedAssetSemanticAssignment>();

	for (const assignment of assignments) {
		const definition = definitionById.get(assignment.semanticGroupId);
		if (!definition) {
			continue;
		}

		const targetKey = assignment.nodeId
			? `node:${assignment.nodeId}`
			: assignment.materialId
				? `material:${assignment.materialId}`
				: '';
		if (!targetKey) {
			continue;
		}

		const dedupeKey = `${targetKey}:${assignment.semanticGroupId}`;
		deduped.set(dedupeKey, assignment);
	}

	for (const assignment of deduped.values()) {
		const definition = definitionById.get(assignment.semanticGroupId);
		if (!definition) {
			continue;
		}

		const targetKey = assignment.nodeId
			? `node:${assignment.nodeId}`
			: assignment.materialId
				? `material:${assignment.materialId}`
				: '';
		if (!targetKey) {
			continue;
		}

		if (definition.assignmentMode === 'exclusive' && definition.exclusiveFamily) {
			exclusiveByNodeAndFamily.set(`${targetKey}:${definition.exclusiveFamily}`, assignment);
			continue;
		}

		exclusiveByNodeAndFamily.set(`${targetKey}:${assignment.semanticGroupId}`, assignment);
	}

	return Array.from(exclusiveByNodeAndFamily.values()).sort((left, right) => {
		const leftTarget = left.nodeId ?? left.materialId ?? '';
		const rightTarget = right.nodeId ?? right.materialId ?? '';
		const targetDelta = leftTarget.localeCompare(rightTarget);
		if (targetDelta !== 0) {
			return targetDelta;
		}

		return left.semanticGroupId.localeCompare(right.semanticGroupId);
	});
}

export async function readAssetSemanticAssignments(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): Promise<AssetSemanticAssignmentsStore> {
	try {
		const raw = JSON.parse(
			await readFile(resolveSemanticAssignmentsPath(assetId, structuralGeneratedAt), 'utf8')
		) as {
			assetId?: VehicleAssetId;
			structuralGeneratedAt?: string;
			assignments?: unknown[];
		};

		const assignments = Array.isArray(raw.assignments)
			? raw.assignments
					.map((entry) => normalizeAssignment(entry))
					.filter((entry): entry is ReviewedAssetSemanticAssignment => entry !== null)
			: [];

		return {
			assetId,
			structuralGeneratedAt,
			assignments: await validateAssignments(assignments)
		};
	} catch {
		return {
			assetId,
			structuralGeneratedAt,
			assignments: []
		};
	}
}

export async function writeAssetSemanticAssignments(
	store: AssetSemanticAssignmentsStore
): Promise<AssetSemanticAssignmentsStore> {
	const nextStore = {
		assetId: store.assetId,
		structuralGeneratedAt: store.structuralGeneratedAt,
		assignments: await validateAssignments(store.assignments)
	};
	await mkdir(resolveSemanticAssignmentsDirectory(store.assetId), { recursive: true });
	await writeFile(
		resolveSemanticAssignmentsPath(store.assetId, store.structuralGeneratedAt),
		JSON.stringify(nextStore, null, 2),
		'utf8'
	);
	return nextStore;
}

export async function upsertReviewedAssetSemanticAssignments(input: {
	assetId: VehicleAssetId;
	structuralGeneratedAt: string;
	nodeIds?: string[];
	materialIds?: string[];
	semanticGroupId: string;
	reviewer?: 'user' | 'system';
}): Promise<AssetSemanticAssignmentsStore> {
	const existing = await readAssetSemanticAssignments(input.assetId, input.structuralGeneratedAt);
	const nextAssignments = [
		...existing.assignments,
		...Array.from(new Set(input.nodeIds ?? [])).map<ReviewedAssetSemanticAssignment>((nodeId) => ({
			nodeId,
			semanticGroupId: input.semanticGroupId,
			status: 'reviewed',
			reviewer: input.reviewer ?? 'user',
			reviewedAt: new Date().toISOString(),
			confidence: 1
		})),
		...Array.from(new Set(input.materialIds ?? [])).map<ReviewedAssetSemanticAssignment>(
			(materialId) => ({
				materialId,
				semanticGroupId: input.semanticGroupId,
				status: 'reviewed',
				reviewer: input.reviewer ?? 'user',
				reviewedAt: new Date().toISOString(),
				confidence: 1
			})
		)
	];

	return writeAssetSemanticAssignments({
		assetId: input.assetId,
		structuralGeneratedAt: input.structuralGeneratedAt,
		assignments: nextAssignments
	});
}

function summarizePathHints(paths: string[]): string[] {
	return Array.from(
		new Set(
			paths.flatMap((value) => {
				const parts = value.split('/').filter((segment) => segment.length > 0);
				if (parts.length === 0) {
					return [];
				}

				return [parts.at(-1)!, parts.slice(-2).join('/')];
			})
		)
	)
		.filter((value) => value.length > 0)
		.sort((left, right) => left.localeCompare(right))
		.slice(0, 4);
}

export async function listReviewedSemanticGroupExamples(
	options: {
		excludeAssetId?: VehicleAssetId;
		maxExamplesPerGroup?: number;
	} = {}
): Promise<Record<string, ReviewedSemanticGroupExample[]>> {
	const maxExamplesPerGroup = options.maxExamplesPerGroup ?? 3;
	const definitions = (await readSemanticGroupDefinitions()).definitions;
	const knownGroupIds = new Set(definitions.map((definition) => definition.id));
	const grouped = new Map<string, ReviewedSemanticGroupExample[]>();

	let assetEntries: string[] = [];
	try {
		assetEntries = await readdir(resolveSemanticAssignmentsRootDirectory());
	} catch {
		return {};
	}

	for (const assetEntry of assetEntries) {
		if (!(assetEntry in VEHICLE_CATALOG)) {
			continue;
		}

		const assetId = assetEntry as VehicleAssetId;
		if (assetId === options.excludeAssetId) {
			continue;
		}

		const structure = await deriveStructuralAssetSnapshot(assetId);
		const assignmentStore = await readAssetSemanticAssignments(assetId, structure.generatedAt);
		if (assignmentStore.assignments.length === 0) {
			continue;
		}

		const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
		const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));

		for (const semanticGroupId of new Set(
			assignmentStore.assignments.map((entry) => entry.semanticGroupId)
		)) {
			if (!knownGroupIds.has(semanticGroupId)) {
				continue;
			}

			const nodeIds = assignmentStore.assignments
				.filter((entry) => entry.semanticGroupId === semanticGroupId && entry.nodeId)
				.map((entry) => entry.nodeId!)
				.filter((nodeId) => nodeById.has(nodeId));
			const materialIds = assignmentStore.assignments
				.filter((entry) => entry.semanticGroupId === semanticGroupId && entry.materialId)
				.map((entry) => entry.materialId!);
			if (nodeIds.length === 0 && materialIds.length === 0) {
				continue;
			}

			const nodes = nodeIds.map((nodeId) => nodeById.get(nodeId)!);
			const meshNames = Array.from(
				new Set(
					nodes.flatMap((node) => {
						if (!node.meshId) {
							return [];
						}

						return [meshById.get(node.meshId)?.name ?? ''];
					})
				)
			)
				.filter((value) => value.length > 0)
				.sort((left, right) => left.localeCompare(right))
				.slice(0, 4);
			const materialNames = Array.from(
				new Set([
					...nodes.flatMap((node) => {
						if (!node.meshId) {
							return [];
						}

						return (
							meshById.get(node.meshId)?.materialIds.flatMap((materialId) => {
								const material = structure.materials.find((entry) => entry.id === materialId);
								return material ? [material.name] : [];
							}) ?? []
						);
					}),
					...materialIds.flatMap((materialId) => {
						const material = structure.materials.find((entry) => entry.id === materialId);
						return material ? [material.name] : [];
					})
				])
			)
				.sort((left, right) => left.localeCompare(right))
				.slice(0, 4);

			const current = grouped.get(semanticGroupId) ?? [];
			if (current.length >= maxExamplesPerGroup) {
				continue;
			}

			current.push({
				semanticGroupId,
				assetId,
				nodeNames: Array.from(new Set(nodes.map((node) => node.name)))
					.sort((left, right) => left.localeCompare(right))
					.slice(0, 4),
				pathHints: summarizePathHints(nodes.map((node) => node.path)),
				meshNames,
				materialNames
			});
			grouped.set(semanticGroupId, current);
		}
	}

	return Object.fromEntries(
		Array.from(grouped.entries()).map(([semanticGroupId, examples]) => [
			semanticGroupId,
			examples.sort((left, right) => left.assetId.localeCompare(right.assetId))
		])
	);
}
