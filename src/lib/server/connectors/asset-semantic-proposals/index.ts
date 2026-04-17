import {
	readJsonObject,
	writeJsonObject
} from '$lib/server/connectors/vehicle-registry/s3';
import {
	resolveSemanticProposalsKey
} from '$lib/server/connectors/vehicle-registry/storage';
import { readSemanticGroupDefinitions } from '$lib/server/connectors/semantic-groups';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { AssetSemanticProposal, AssetSemanticProposalsStore } from './types';

function normalizeProposal(value: unknown): AssetSemanticProposal | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	const nodeId = typeof candidate.nodeId === 'string' ? candidate.nodeId.trim() : '';
	const semanticGroupId =
		typeof candidate.semanticGroupId === 'string' ? candidate.semanticGroupId.trim() : '';
	const proposedAt = typeof candidate.proposedAt === 'string' ? candidate.proposedAt : '';
	const confidence =
		typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
			? candidate.confidence
			: Number.NaN;

	if (
		!nodeId ||
		!semanticGroupId ||
		!proposedAt ||
		candidate.source !== 'llm' ||
		(candidate.status !== 'pending' &&
			candidate.status !== 'accepted' &&
			candidate.status !== 'rejected') ||
		!Number.isFinite(confidence)
	) {
		return null;
	}

	return {
		nodeId,
		semanticGroupId,
		status: candidate.status,
		source: 'llm',
		confidence: Math.min(1, Math.max(0, confidence)),
		proposedAt
	};
}

async function validateProposals(
	proposals: AssetSemanticProposal[]
): Promise<AssetSemanticProposal[]> {
	const definitions = (await readSemanticGroupDefinitions()).definitions;
	const knownGroupIds = new Set(definitions.map((definition) => definition.id));
	const deduped = new Map<string, AssetSemanticProposal>();

	for (const proposal of proposals) {
		if (!knownGroupIds.has(proposal.semanticGroupId)) {
			continue;
		}

		const key = `${proposal.nodeId}:${proposal.semanticGroupId}`;
		const existing = deduped.get(key);
		if (
			!existing ||
			proposal.confidence > existing.confidence ||
			(proposal.confidence === existing.confidence &&
				proposal.proposedAt.localeCompare(existing.proposedAt) > 0)
		) {
			deduped.set(key, proposal);
		}
	}

	return Array.from(deduped.values()).sort((left, right) => {
		const nodeDelta = left.nodeId.localeCompare(right.nodeId);
		if (nodeDelta !== 0) {
			return nodeDelta;
		}

		return left.semanticGroupId.localeCompare(right.semanticGroupId);
	});
}

export async function readAssetSemanticProposals(
	assetId: VehicleAssetId,
	structuralGeneratedAt: string
): Promise<AssetSemanticProposalsStore> {
	try {
		const raw = await readJsonObject<{ proposals?: unknown[] }>(
			resolveSemanticProposalsKey(assetId, structuralGeneratedAt)
		);
		if (!raw) {
			throw new Error('missing');
		}

		const proposals = Array.isArray(raw.proposals)
			? raw.proposals
					.map((entry) => normalizeProposal(entry))
					.filter((entry): entry is AssetSemanticProposal => entry !== null)
			: [];

		return {
			assetId,
			structuralGeneratedAt,
			proposals: await validateProposals(proposals)
		};
	} catch {
		return {
			assetId,
			structuralGeneratedAt,
			proposals: []
		};
	}
}

export async function writeAssetSemanticProposals(
	store: AssetSemanticProposalsStore
): Promise<AssetSemanticProposalsStore> {
	const nextStore = {
		assetId: store.assetId,
		structuralGeneratedAt: store.structuralGeneratedAt,
		proposals: await validateProposals(store.proposals)
	};
	await writeJsonObject(resolveSemanticProposalsKey(store.assetId, store.structuralGeneratedAt), nextStore);
	return nextStore;
}

export async function upsertPendingAssetSemanticProposals(input: {
	assetId: VehicleAssetId;
	structuralGeneratedAt: string;
	nodeIds: string[];
	semanticGroupId: string;
	confidence: number;
}): Promise<AssetSemanticProposalsStore> {
	const existing = await readAssetSemanticProposals(input.assetId, input.structuralGeneratedAt);
	const proposedAt = new Date().toISOString();
	const nextProposals = [
		...existing.proposals,
		...Array.from(new Set(input.nodeIds)).map<AssetSemanticProposal>((nodeId) => ({
			nodeId,
			semanticGroupId: input.semanticGroupId,
			status: 'pending',
			source: 'llm',
			confidence: Math.min(1, Math.max(0, input.confidence)),
			proposedAt
		}))
	];

	return writeAssetSemanticProposals({
		assetId: input.assetId,
		structuralGeneratedAt: input.structuralGeneratedAt,
		proposals: nextProposals
	});
}
