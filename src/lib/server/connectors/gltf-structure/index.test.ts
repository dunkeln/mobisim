import { describe, expect, it } from 'vitest';
import { deriveStructuralAssetSnapshot } from './index';

describe('deriveStructuralAssetSnapshot', () => {
	it('builds a canonical structural snapshot for a local vehicle asset', async () => {
		const snapshot = await deriveStructuralAssetSnapshot('audi_r8');

		expect(snapshot.assetId).toBe('audi_r8');
		expect(snapshot.scenes.length).toBeGreaterThan(0);
		expect(snapshot.nodes.length).toBeGreaterThan(0);
		expect(snapshot.meshes.length).toBeGreaterThan(0);
		expect(snapshot.materials.length).toBeGreaterThan(0);
		expect(snapshot.nodes.every((node) => node.id.length > 0 && node.path.length > 0)).toBe(true);
		expect(snapshot.nodes.every((node) => Array.isArray(node.worldTranslation))).toBe(true);
		expect(snapshot.nodes.some((node) => node.bounds?.center !== undefined)).toBe(true);
		expect(snapshot.meshes.every((mesh) => Array.isArray(mesh.materialIds))).toBe(true);
		expect(snapshot.materials.every((material) => Array.isArray(material.nodeIds))).toBe(true);
		expect(snapshot.materials.every((material) => Array.isArray(material.meshIds))).toBe(true);
	});

	it('keeps structural parent-child membership and material ownership aligned', async () => {
		const snapshot = await deriveStructuralAssetSnapshot('audi_r8');
		const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
		const meshIds = new Set(snapshot.meshes.map((mesh) => mesh.id));

		for (const node of snapshot.nodes) {
			if (node.parentId) {
				expect(nodeById.has(node.parentId)).toBe(true);
			}

			for (const childId of node.childIds) {
				expect(nodeById.has(childId)).toBe(true);
			}

			if (node.meshId) {
				expect(meshIds.has(node.meshId)).toBe(true);
			}
		}

		for (const material of snapshot.materials) {
			for (const meshId of material.meshIds) {
				expect(meshIds.has(meshId)).toBe(true);
			}

			for (const nodeId of material.nodeIds) {
				expect(nodeById.has(nodeId)).toBe(true);
			}
		}
	});

	it('uses a stable structural version for generatedAt across repeated reads', async () => {
		const first = await deriveStructuralAssetSnapshot('audi_r8');
		const second = await deriveStructuralAssetSnapshot('audi_r8');

		expect(first.generatedAt).toBe(second.generatedAt);
		expect(first.generatedAt.startsWith('structural:')).toBe(true);
	});
});
