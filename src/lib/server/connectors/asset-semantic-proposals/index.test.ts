import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAssetSemanticProposals, upsertPendingAssetSemanticProposals } from './index';

const semanticDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		semanticDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
	delete process.env.SEMANTIC_MANIFEST_LOCAL_DIR;
});

describe('asset semantic proposals', () => {
	it('dedupes pending llm proposals by node and semantic group', async () => {
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		await upsertPendingAssetSemanticProposals({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'structural:test',
			nodeIds: ['node-1'],
			semanticGroupId: 'wheels',
			confidence: 0.45
		});
		await upsertPendingAssetSemanticProposals({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'structural:test',
			nodeIds: ['node-1', 'node-2'],
			semanticGroupId: 'wheels',
			confidence: 0.9
		});

		const store = await readAssetSemanticProposals('audi_r8', 'structural:test');

		expect(store.proposals).toHaveLength(2);
		expect(store.proposals[0]).toEqual(
			expect.objectContaining({
				nodeId: 'node-1',
				semanticGroupId: 'wheels',
				status: 'pending',
				source: 'llm',
				confidence: 0.9
			})
		);
		expect(store.proposals[1]).toEqual(
			expect.objectContaining({
				nodeId: 'node-2',
				semanticGroupId: 'wheels',
				status: 'pending',
				source: 'llm',
				confidence: 0.9
			})
		);
	});
});
