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
	listSemanticGroupsByQuery,
	mutateVehicleSemanticAssignment,
	readVehicleSemanticOverlay,
	writeVehicleSemanticOverlay
} from './index';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import { readAssetSemanticAssignments } from '$lib/server/connectors/asset-semantic-assignments';
import {
	readAssetSemanticProposals,
	upsertPendingAssetSemanticProposals
} from '$lib/server/connectors/asset-semantic-proposals';
import { readSemanticGroupDefinitions } from '$lib/server/connectors/semantic-groups';

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
					supports: ['highlight', 'focus', 'isolate'],
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
					supports: ['highlight', 'focus', 'isolate'],
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
		expect(overlay?.acceptedGroups.some((group) => group.id === 'group_front_face')).toBe(true);
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
					supports: ['highlight', 'focus', 'isolate'],
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
	});

	it('prefers node-backed semantic groups for structural actions like isolate', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterial = capabilities.materials.find((material) => material.meshIds.length > 0);
		const wheelNode = structure.nodes.find((node) => node.meshId === wheelMaterial?.meshIds[0]);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(wheelMaterial).toBeDefined();
		expect(wheelNode).toBeDefined();

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
					supports: ['highlight', 'focus', 'isolate'],
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
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: wheelNode ? [wheelNode.id] : [],
					meshIds: wheelMaterial!.meshIds.slice(0, 1),
					materialIds: [wheelMaterial!.id],
					derivedFrom: ['llm']
				}
			],
			discardedSuggestions: []
		});

		await mutateVehicleSemanticAssignment('audi_r8', {
			action: 'assign',
			nodeIds: [wheelNode!.id],
			category: 'wheels',
			humanLabel: 'wheels',
			aliases: ['wheel']
		});

		const groups = await listSemanticGroupsByQuery(
			'audi_r8',
			capabilities.generatedAt,
			'wheels',
			'isolate'
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.id).toBe('group_wheels');
		expect(groups[0]?.nodeIds).toEqual([wheelNode!.id]);
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

		const overlay = await mutateVehicleSemanticAssignment('audi_r8', {
			action: 'assign',
			nodeIds: [targetNode!.id],
			category: 'doors',
			humanLabel: 'doors',
			aliases: ['door']
		});

		const group = overlay.acceptedGroups.find((entry) => entry.category === 'doors');
		expect(group).toBeDefined();
		expect(group?.nodeIds).toContain(targetNode!.id);
		expect(group?.derivedFrom).toContain('user');

		const assignments = await readAssetSemanticAssignments('audi_r8', capabilities.generatedAt);
		expect(assignments.assignments).toContainEqual(
			expect.objectContaining({
				nodeId: targetNode!.id,
				semanticGroupId: 'doors',
				status: 'reviewed'
			})
		);
	});

	it('reduces duplicate semantic groups by id when overlay reads merge stored and reviewed groups', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const targetNode = structure.nodes.find((node) => node.meshId !== null);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(targetNode).toBeDefined();

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [
				{
					id: 'group_body_shell',
					humanLabel: 'shell',
					aliases: ['outer shell'],
					confidence: 0.75,
					category: 'body_shell',
					supports: ['highlight'],
					nodeIds: [],
					meshIds: [],
					materialIds: [],
					derivedFrom: ['materials']
				}
			],
			discardedSuggestions: []
		});

		await mutateVehicleSemanticAssignment('audi_r8', {
			action: 'assign',
			nodeIds: [targetNode!.id],
			category: 'body_shell',
			humanLabel: 'body shell',
			aliases: ['shell']
		});

		const overlay = await readVehicleSemanticOverlay('audi_r8');
		const groups = overlay?.acceptedGroups.filter((group) => group.id === 'group_body_shell') ?? [];

		expect(groups).toHaveLength(1);
		expect(groups[0]?.humanLabel).toBe('body shell');
		expect(groups[0]?.supports).toEqual(expect.arrayContaining(['highlight', 'paint']));
		expect(groups[0]?.nodeIds).toContain(targetNode!.id);
		expect(groups[0]?.derivedFrom).toEqual(expect.arrayContaining(['user']));
	});

	it('reduces visible semantic groups with different ids when they share the same category', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));

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
			acceptedGroups: [
				{
					id: 'group_wheels',
					humanLabel: 'wheels',
					aliases: ['wheel'],
					confidence: 0.94,
					category: 'wheels',
					supports: ['focus', 'highlight', 'isolate'],
					nodeIds: ['node-a'],
					meshIds: ['mesh-a'],
					materialIds: ['material-a'],
					derivedFrom: ['synthetic']
				},
				{
					id: 'group-wheels',
					humanLabel: 'wheels',
					aliases: ['rims'],
					confidence: 0.98,
					category: 'wheels',
					supports: ['focus', 'highlight', 'isolate'],
					nodeIds: ['node-b'],
					meshIds: ['mesh-b'],
					materialIds: ['material-b'],
					derivedFrom: ['materials']
				}
			],
			discardedSuggestions: []
		});

		const overlay = await readVehicleSemanticOverlay('audi_r8');
		const wheelGroups = overlay?.acceptedGroups.filter((group) => group.category === 'wheels') ?? [];

		expect(wheelGroups).toHaveLength(1);
		expect(wheelGroups[0]?.nodeIds).toEqual(expect.arrayContaining(['node-a', 'node-b']));
		expect(wheelGroups[0]?.materialIds).toEqual(
			expect.arrayContaining(['material-a', 'material-b'])
		);
	});

	it('syncs a single planner-visible part with the reviewed semantic group for the same category', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const targetNode = structure.nodes.find((node) => node.meshId !== null);
		const baselineNode = structure.nodes.find(
			(node) => node.meshId !== null && node.id !== targetNode?.id
		);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(targetNode).toBeDefined();
		expect(baselineNode).toBeDefined();

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [
				{
					id: 'door_shell',
					humanLabel: 'door shell',
					aliases: ['door'],
					confidence: 0.9,
					category: 'door',
					nodeIds: [baselineNode!.id],
					meshIds: [],
					materialIds: []
				}
			],
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const overlay = await mutateVehicleSemanticAssignment('audi_r8', {
			action: 'assign',
			nodeIds: [targetNode!.id],
			category: 'doors',
			humanLabel: 'doors',
			aliases: ['door']
		});

		const part = overlay.acceptedParts.find((entry) => entry.id === 'door_shell');
		expect(part).toBeDefined();
		expect(part?.nodeIds).toContain(targetNode!.id);
	});

	it('resolves existing semantic groups by freeform name before writing reviewed assignments', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const targetNode = structure.nodes.find((node) => node.meshId !== null);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(targetNode).toBeDefined();

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

		await mutateVehicleSemanticAssignment('audi_r8', {
			action: 'assign',
			nodeIds: [targetNode!.id],
			semanticGroup: 'headlights'
		});

		const assignments = await readAssetSemanticAssignments('audi_r8', capabilities.generatedAt);
		expect(assignments.assignments).toContainEqual(
			expect.objectContaining({
				nodeId: targetNode!.id,
				semanticGroupId: 'front_lighting',
				status: 'reviewed'
			})
		);
	});

	it('creates a new shared other-group definition when no existing semantic group matches', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const targetNode = structure.nodes.find((node) => node.meshId !== null);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(targetNode).toBeDefined();

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

		await mutateVehicleSemanticAssignment('audi_r8', {
			action: 'assign',
			nodeIds: [targetNode!.id],
			semanticGroup: 'number plate'
		});

		const definitions = await readSemanticGroupDefinitions();
		expect(definitions.definitions).toContainEqual(
			expect.objectContaining({
				id: 'other_number_plate',
				category: 'other',
				humanLabel: 'number plate'
			})
		);

		const assignments = await readAssetSemanticAssignments('audi_r8', capabilities.generatedAt);
		expect(assignments.assignments).toContainEqual(
			expect.objectContaining({
				nodeId: targetNode!.id,
				semanticGroupId: 'other_number_plate',
				status: 'reviewed'
			})
		);
	});

	it('persists reviewed material assignments when annotation includes selected material context', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const targetNode = structure.nodes.find((node) => node.meshId !== null);
		const targetMesh = structure.meshes.find((mesh) => mesh.id === targetNode?.meshId);
		const targetMaterialId = targetMesh?.materialIds[0];
		const targetMaterialName = targetMesh?.materialNames[0];

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(targetNode).toBeDefined();
		expect(targetMesh).toBeDefined();
		expect(targetMaterialId).toBeDefined();

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

		const overlay = await mutateVehicleSemanticAssignment('audi_r8', {
			action: 'assign',
			nodeIds: [targetNode!.id],
			semanticGroup: 'glasshouse',
			materialSelections: [
				{
					nodeId: targetNode!.id,
					materialIndex: 0,
					materialName: targetMaterialName
				}
			]
		});

		const assignments = await readAssetSemanticAssignments('audi_r8', capabilities.generatedAt);
		expect(assignments.assignments).toContainEqual(
			expect.objectContaining({
				materialId: targetMaterialId,
				semanticGroupId: 'glasshouse',
				status: 'reviewed'
			})
		);
		const group = overlay.acceptedGroups.find((entry) => entry.category === 'glasshouse');
		expect(group?.materialIds).toContain(targetMaterialId);
	});

	it('keeps pending llm semantic proposals out of planner-visible group reads', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const targetNode = structure.nodes.find((node) => node.meshId !== null);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;
		expect(targetNode).toBeDefined();

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

		const baselineGroups = await listSemanticGroupsByQuery(
			'audi_r8',
			capabilities.generatedAt,
			'wheels',
			'highlight'
		);

		await upsertPendingAssetSemanticProposals({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			nodeIds: [targetNode!.id],
			semanticGroupId: 'wheels',
			confidence: 0.88
		});

		const proposals = await readAssetSemanticProposals('audi_r8', capabilities.generatedAt);
		expect(proposals.proposals).toContainEqual(
			expect.objectContaining({
				nodeId: targetNode!.id,
				semanticGroupId: 'wheels',
				status: 'pending',
				source: 'llm'
			})
		);

		const groups = await listSemanticGroupsByQuery(
			'audi_r8',
			capabilities.generatedAt,
			'wheels',
			'highlight'
		);

		expect(groups).toEqual(baselineGroups);
	});
});
