import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	deriveVehicleInspectionCapabilities,
	planVehicleBodyPaint,
	planVehicleWindowTint
} from '$lib/server/connectors/gltf-preprocess';
import {
	annotateVehicleSemanticGroup,
	listSemanticGroupsByQuery,
	readVehicleSemanticOverlay,
	writeVehicleSemanticOverlay
} from './index';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';

const semanticDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		semanticDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
	delete process.env.SEMANTIC_MANIFEST_LOCAL_DIR;
});

describe('vehicle semantic overlays', () => {
	it('extends material summaries with structural usage paths', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const firstMaterial = capabilities.materials[0];

		expect(firstMaterial).toBeDefined();
		expect(Array.isArray(firstMaterial!.meshIds)).toBe(true);
		expect(Array.isArray(firstMaterial!.meshNames)).toBe(true);
		expect(Array.isArray(firstMaterial!.nodePaths)).toBe(true);
	});

	it('prefers stored semantic candidates over raw naming heuristics', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const bodyMaterial = capabilities.materials[0];
		const glassMaterial = capabilities.materials[1];

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [
				{
					targetType: 'material',
					targetId: bodyMaterial!.id,
					targetName: bodyMaterial!.name,
					humanLabel: 'body paint',
					aliases: ['body color', 'paint'],
					semanticTags: ['body_paint_candidate'],
					confidence: 0.92
				},
				{
					targetType: 'material',
					targetId: glassMaterial!.id,
					targetName: glassMaterial!.name,
					humanLabel: 'glass',
					aliases: ['window tint', 'glass tint'],
					semanticTags: ['glass_candidate'],
					confidence: 0.91
				}
			],
			acceptedParts: [
				{
					id: 'front_grille',
					humanLabel: 'front grille',
					aliases: ['grille', 'front grill'],
					confidence: 0.88,
					category: 'grille',
					nodeIds: [],
					meshIds: bodyMaterial!.meshIds.slice(0, 1),
					materialIds: [bodyMaterial!.id],
					region: 'front',
					side: 'center'
				}
			],
			acceptedGroups: [
				{
					id: 'group_front_face',
					humanLabel: 'front face',
					aliases: ['front end', 'nose'],
					confidence: 0.9,
					category: 'front_face',
					supports: ['highlight', 'focus', 'isolate', 'explode'],
					nodeIds: [],
					meshIds: bodyMaterial!.meshIds.slice(0, 1),
					materialIds: [bodyMaterial!.id],
					derivedFrom: ['llm']
				}
			],
			discardedSuggestions: []
		});

		const paintPlan = await planVehicleBodyPaint('audi_r8', [0.2, 0.3, 0.4, 1]);
		const tintPlan = await planVehicleWindowTint('audi_r8', 'smoke tint', [0.1, 0.1, 0.1, 0.7]);

		expect(paintPlan.matchedMaterialNames).toEqual([bodyMaterial!.name]);
		expect(paintPlan.operations).toHaveLength(1);
		expect(paintPlan.operations[0]?.targetId).toBe(bodyMaterial!.id);

		expect(tintPlan.matchedMaterialNames).toEqual([glassMaterial!.name]);
		expect(tintPlan.operations).toHaveLength(1);
		expect(tintPlan.operations[0]?.targetId).toBe(glassMaterial!.id);
	});

	it('persists semantic part units alongside material suggestions', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const bodyMaterial = capabilities.materials[0];

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [
				{
					id: 'front_grille',
					humanLabel: 'front grille',
					aliases: ['grille'],
					confidence: 0.93,
					category: 'grille',
					nodeIds: [],
					meshIds: bodyMaterial!.meshIds.slice(0, 1),
					materialIds: [bodyMaterial!.id],
					region: 'front',
					side: 'center'
				}
			],
			acceptedGroups: [
				{
					id: 'group_front_face',
					humanLabel: 'front face',
					aliases: ['front end'],
					confidence: 0.89,
					category: 'front_face',
					supports: ['highlight', 'focus', 'isolate', 'explode'],
					nodeIds: [],
					meshIds: bodyMaterial!.meshIds.slice(0, 1),
					materialIds: [bodyMaterial!.id],
					derivedFrom: ['synthetic', 'parts']
				}
			],
			discardedSuggestions: [
				{
					kind: 'part',
					payload: {
						id: 'bad_part',
						humanLabel: 'bad part',
						aliases: [],
						confidence: 0.2,
						category: 'other',
						nodeIds: [],
						meshIds: [],
						materialIds: [bodyMaterial!.id]
					},
					reason: 'Confidence below threshold'
				}
			]
		});

		const overlay = await readVehicleSemanticOverlay('audi_r8');

		expect(overlay?.acceptedParts).toHaveLength(1);
		expect(overlay?.acceptedParts[0]?.id).toBe('front_grille');
		expect(overlay?.acceptedGroups).toHaveLength(1);
		expect(overlay?.acceptedGroups[0]?.id).toBe('group_front_face');
		expect(overlay?.discardedSuggestions[0]?.kind).toBe('part');
	});

	it('prefers one high-precision semantic group per category when duplicates match the same query', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterial =
			capabilities.materials.find((material) =>
				/\b(wheel|rim|tire|tyre|spoke|brake)\b/i.test(
					`${material.name} ${material.meshNames.join(' ')} ${material.nodePaths.join(' ')}`
				)
			) ?? capabilities.materials.find((material) => material.meshIds.length > 0);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(wheelMaterial).toBeDefined();

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
				acceptedMaterials: [
					{
						targetType: 'material',
						targetId: wheelMaterial!.id,
						targetName: wheelMaterial!.name,
						humanLabel: 'wheel outer face',
						aliases: ['wheel', 'rim'],
						semanticTags: ['wheel_outer_face'],
					confidence: 0.92
				}
			],
			acceptedParts: [],
			acceptedGroups: [
				{
					id: 'group_wheels',
					humanLabel: 'wheels',
					aliases: ['wheel'],
						confidence: 0.91,
						category: 'wheels',
						supports: ['highlight', 'focus', 'isolate', 'explode'],
						nodeIds: [],
						meshIds: wheelMaterial!.meshIds.slice(0, 1),
						materialIds: [wheelMaterial!.id],
						derivedFrom: ['synthetic']
					},
				{
					id: 'group-wheels',
					humanLabel: 'wheels',
					aliases: ['wheel'],
						confidence: 0.96,
						category: 'wheels',
						supports: ['highlight', 'focus', 'isolate'],
						nodeIds: [],
						meshIds: wheelMaterial!.meshIds.slice(0, 1),
						materialIds: ['material-contaminated'],
						derivedFrom: ['llm']
					}
			],
			discardedSuggestions: []
		});

	const groups = await listSemanticGroupsByQuery(
		'audi_r8',
		capabilities.generatedAt,
		'wheels',
		'highlight'
	);

	expect(groups).toHaveLength(1);
	expect(groups[0]?.id).toBe('group_wheels');
	expect(groups[0]?.materialIds).toEqual([wheelMaterial!.id]);
	});

	it('prefers node-backed semantic groups for structural actions like explode', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterial = capabilities.materials.find((material) => material.meshIds.length > 0);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [
				{
					targetType: 'material',
					targetId: wheelMaterial!.id,
					targetName: wheelMaterial!.name,
					humanLabel: 'wheel outer face',
					aliases: ['wheel', 'rim'],
					semanticTags: ['wheel_outer_face'],
					confidence: 0.92
				}
			],
			acceptedParts: [],
			acceptedGroups: [
				{
					id: 'group_wheels',
					humanLabel: 'wheels',
					aliases: ['wheel'],
					confidence: 0.95,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate', 'explode'],
					nodeIds: [],
					meshIds: wheelMaterial!.meshIds.slice(0, 1),
					materialIds: [wheelMaterial!.id],
					derivedFrom: ['synthetic']
				},
				{
					id: 'group-wheels',
					humanLabel: 'wheels',
					aliases: ['wheel'],
					confidence: 0.9,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate', 'explode'],
					nodeIds: ['node-1'],
					meshIds: wheelMaterial!.meshIds.slice(0, 1),
					materialIds: [wheelMaterial!.id],
					derivedFrom: ['llm']
				}
			],
			discardedSuggestions: []
		});

		const groups = await listSemanticGroupsByQuery(
			'audi_r8',
			capabilities.generatedAt,
			'wheels',
			'explode'
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.id).toBe('group-wheels');
	});

	it('persists explicit user semantic group annotations by node id', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const targetNode = structure.nodes.find((node) => node.meshId !== null);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const overlay = await annotateVehicleSemanticGroup('audi_r8', {
			nodeId: targetNode!.id,
			category: 'doors',
			humanLabel: 'doors',
			aliases: ['door']
		});

		const group = overlay.acceptedGroups.find((entry) => entry.category === 'doors');
		expect(group).toBeDefined();
		expect(group?.nodeIds).toContain(targetNode!.id);
		expect(group?.derivedFrom).toContain('user');
	});
});
