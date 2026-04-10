import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	deriveVehicleInspectionCapabilities,
	planVehicleBodyPaint,
	planVehiclePartHighlight,
	planVehicleWindowTint,
	validateVehicleInspectionPatchManifest
} from './index';
import { writeVehicleSemanticOverlay } from '$lib/server/connectors/vehicle-semantic-overlay';

const semanticDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		semanticDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
	delete process.env.SEMANTIC_MANIFEST_LOCAL_DIR;
});

describe('deriveVehicleInspectionCapabilities', () => {
	it('builds a deterministic inspection capability summary for a local vehicle asset', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');

		expect(capabilities.assetId).toBe('audi_r8');
		expect(capabilities.scenes.length).toBeGreaterThan(0);
		expect(capabilities.sceneCount).toBe(capabilities.scenes.length);
		expect(capabilities.nodeCount).toBeGreaterThan(0);
		expect(capabilities.meshCount).toBeGreaterThan(0);
		expect(capabilities.materialCount).toBeGreaterThan(0);
		expect(capabilities.controlCandidates.length).toBeGreaterThan(0);
		expect(capabilities.wireframeMeshes.length).toBeGreaterThan(0);
		expect(capabilities.uvDebugMeshes.length).toBeGreaterThan(0);
		expect(capabilities.controlCandidates.every((node) => node.path.length > 0)).toBe(true);
	});

	it('validates a user patch manifest against derived regions', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const firstNode = capabilities.controlCandidates[0];
		const firstMaterial = capabilities.materials[0];
		const firstUvMesh = capabilities.uvDebugMeshes[0];

		expect(firstNode).toBeDefined();
		expect(firstMaterial).toBeDefined();
		expect(firstUvMesh).toBeDefined();

		const validation = await validateVehicleInspectionPatchManifest({
			assetId: 'audi_r8',
			userId: 'user-a',
			presetId: 'preset-a',
			operations: [
				{
					targetType: 'node',
					targetId: firstNode!.nodeId,
					op: 'set_visibility',
					value: false
				},
				{
					targetType: 'material',
					targetId: firstMaterial!.id,
					op: 'set_alpha',
					value: 0.05
				},
				{
					targetType: 'viewer',
					targetId: 'uv_debug',
					op: 'set_target',
					value: firstUvMesh!.meshId
				},
				{
					targetType: 'node',
					targetId: 'missing-node',
					op: 'set_visibility',
					value: true
				}
			]
		});

		expect(validation.accepted).toHaveLength(3);
		expect(validation.rejected).toHaveLength(1);
		expect(validation.rejected[0]?.reason).toContain('Unknown node target');
	});

	it('plans a primary-color highlight for a requested part query', async () => {
		const plan = await planVehiclePartHighlight('audi_r8', 'wheel');

		expect(plan.assetId).toBe('audi_r8');
		expect(plan.partQuery).toBe('wheel');
		expect(plan.operations.length).toBeGreaterThan(0);
		expect(
			plan.operations.every(
				(operation) =>
					operation.targetType === 'node' &&
					operation.op === 'set_overlay_highlight' &&
					Array.isArray(operation.value) &&
					operation.value[3] === 0.48
			)
		).toBe(true);
	});

	it('plans body paint operations for configured body materials', async () => {
		const plan = await planVehicleBodyPaint('audi_r8', [0.85, 0.08, 0.12, 1]);

		expect(plan.assetId).toBe('audi_r8');
		expect(plan.matchedMaterialNames.length).toBeGreaterThan(0);
		expect(plan.operations.length).toBeGreaterThan(0);
		expect(
			plan.operations.every(
				(operation) =>
					operation.targetType === 'material' &&
					operation.op === 'set_base_color_factor' &&
					Array.isArray(operation.value) &&
					operation.value[3] === 1
			)
		).toBe(true);
	});

	it('adds finish operations for expressive body paint requests', async () => {
		const plan = await planVehicleBodyPaint('audi_r8', [0.22, 0.12, 0.34, 1], {
			metalness: 1,
			roughness: 0.08,
			envMapIntensity: 1.85
		});

		expect(plan.operations.some((operation) => operation.op === 'set_metalness_factor')).toBe(true);
		expect(plan.operations.some((operation) => operation.op === 'set_roughness_factor')).toBe(true);
		expect(plan.operations.some((operation) => operation.op === 'set_env_map_intensity')).toBe(
			true
		);
	});

	it('resolves body paint from a reviewed body-shell semantic group even without paint-tagged materials', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const bodyMaterial = capabilities.materials[0];
		const distractorMaterial = capabilities.materials[1];

		expect(bodyMaterial).toBeDefined();
		expect(distractorMaterial).toBeDefined();

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
					id: 'body_shell',
					humanLabel: 'body shell',
					aliases: ['body', 'paint'],
					confidence: 1,
					category: 'body_shell',
					supports: ['focus', 'highlight', 'isolate', 'paint'],
					nodeIds: [],
					meshIds: bodyMaterial!.meshIds.slice(0, 1),
					materialIds: [bodyMaterial!.id],
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await planVehicleBodyPaint('audi_r8', [0.85, 0.08, 0.12, 1]);
		const paintedMaterialIds = new Set(
			plan.operations
				.filter((operation) => operation.op === 'set_base_color_factor')
				.map((operation) => operation.targetId)
		);

		expect(plan.matchedMaterialNames).toContain(bodyMaterial!.name);
		expect(paintedMaterialIds.has(bodyMaterial!.id)).toBe(true);
		expect(paintedMaterialIds.has(distractorMaterial!.id)).toBe(false);
	});

	it('plans window tint operations for configured glass materials', async () => {
		const plan = await planVehicleWindowTint('audi_r8', '5% dark tint', [0.04, 0.04, 0.05, 0.94]);

		expect(plan.assetId).toBe('audi_r8');
		expect(plan.resolvedLabel).toBe('5% dark tint');
		expect(plan.matchedMaterialNames.length).toBeGreaterThan(0);
		expect(plan.operations.length).toBeGreaterThan(0);
		expect(
			plan.operations.every(
				(operation) =>
					operation.targetType === 'material' &&
					operation.op === 'set_base_color_factor' &&
					Array.isArray(operation.value) &&
					operation.value[3] === 0.94
			)
		).toBe(true);
	});
});
