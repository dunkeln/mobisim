import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listReviewedSemanticGroupExamples, upsertReviewedAssetSemanticAssignments } from './index';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';

const semanticDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		semanticDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
	delete process.env.SEMANTIC_MANIFEST_LOCAL_DIR;
});

describe('asset semantic assignments', () => {
	it('derives reusable reviewed semantic examples from reviewed assignments', async () => {
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const targetNode = structure.nodes.find((node) => node.meshId !== null);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(targetNode).toBeDefined();

		await upsertReviewedAssetSemanticAssignments({
			assetId: 'audi_r8',
			structuralGeneratedAt: structure.generatedAt,
			nodeIds: [targetNode!.id],
			semanticGroupId: 'doors',
			reviewer: 'user'
		});

		const examples = await listReviewedSemanticGroupExamples();

		expect(examples.doors).toBeDefined();
		expect(examples.doors).toHaveLength(1);
		expect(examples.doors?.[0]).toEqual(
			expect.objectContaining({
				semanticGroupId: 'doors',
				assetId: 'audi_r8'
			})
		);
		expect(examples.doors?.[0]?.nodeNames.length).toBeGreaterThan(0);
		expect(examples.doors?.[0]?.pathHints.length).toBeGreaterThan(0);
	}, 15000);

	it('can exclude the active asset when deriving reviewed examples for prompt input', async () => {
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const targetNode = structure.nodes.find((node) => node.meshId !== null);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(targetNode).toBeDefined();

		await upsertReviewedAssetSemanticAssignments({
			assetId: 'audi_r8',
			structuralGeneratedAt: structure.generatedAt,
			nodeIds: [targetNode!.id],
			semanticGroupId: 'doors',
			reviewer: 'user'
		});

		const examples = await listReviewedSemanticGroupExamples({ excludeAssetId: 'audi_r8' });

		expect(examples.doors ?? []).toHaveLength(0);
	}, 15000);
});
