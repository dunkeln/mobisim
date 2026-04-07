import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	getVehicleHeadlightSupport,
	parsePaintRequest,
	resolveNormalizedVehiclePaintIntent,
	planVehicleHighlightIntent,
	planVehicleHeadlightIntent,
	planVehiclePartIntent,
	resolveVehicleIntent
} from '$lib/server/connectors/vehicle-intents';
import { writeVehicleSemanticOverlay } from '$lib/server/connectors/vehicle-semantic-overlay';

const semanticDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		semanticDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
	delete process.env.SEMANTIC_MANIFEST_LOCAL_DIR;
});

describe('vehicle part intent planner', () => {
	it('parses dark colors and chrome finishes separately for body paint requests', () => {
		const parsed = parsePaintRequest('make it dark purple chrome');

		expect(parsed).not.toBeNull();
		expect(parsed?.color[0]).toBeLessThan(0.3);
		expect(parsed?.color[2]).toBeLessThan(0.45);
		expect(parsed?.finish?.label).toBe('chrome');
		expect(parsed?.finish?.metalness).toBe(1);
		expect(parsed?.finish?.roughness).toBe(0.08);
	});

	it('resolves normalized paint intents deterministically', () => {
		const resolved = resolveNormalizedVehiclePaintIntent({
			colorFamily: 'purple',
			shade: 'dark',
			saturation: 'balanced',
			finish: 'chrome'
		});

		expect(resolved).not.toBeNull();
		expect(resolved?.color[0]).toBeLessThan(0.35);
		expect(resolved?.color[2]).toBeLessThan(0.5);
		expect(resolved?.finish?.label).toBe('chrome');
		expect(resolved?.finish?.envMapIntensity).toBe(1.85);
	});

	it('resolves semantic part units for isolate mode as context dimming plus highlight', async () => {
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
					aliases: ['grille', 'front grill'],
					confidence: 0.94,
					category: 'grille',
					nodeIds: [],
					meshIds: bodyMaterial!.meshIds.slice(0, 1),
					materialIds: [bodyMaterial!.id],
					region: 'front',
					side: 'center'
				}
			],
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const plan = await planVehiclePartIntent('audi_r8', 'isolate the front grille', 'isolate');

		expect(plan.mode).toBe('isolate');
		expect(plan.matchedPartIds.length).toBeGreaterThan(0);
		expect(plan.matchedPartLabels.length).toBeGreaterThan(0);
		expect(plan.matchedMaterialIds).toContain(bodyMaterial!.id);
		expect(plan.matchedMaterialNames).toContain(bodyMaterial!.name);
		expect(plan.matchedNodeIds.length).toBeGreaterThan(0);
		expect(plan.matchedPaths.length).toBeGreaterThan(0);
		expect(plan.operations.length).toBeGreaterThan(0);
		expect(
			plan.operations.some(
				(operation) => operation.targetType === 'material' && operation.op === 'set_alpha'
			)
		).toBe(true);
		expect(
			plan.operations.some(
				(operation) =>
					operation.targetType === 'material' && operation.op === 'set_overlay_highlight'
			)
		).toBe(true);
	});

	it('prefers semantic part matches for highlight planning before raw material heuristics', async () => {
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
					confidence: 0.91,
					category: 'grille',
					nodeIds: [],
					meshIds: bodyMaterial!.meshIds.slice(0, 1),
					materialIds: [bodyMaterial!.id],
					region: 'front',
					side: 'center'
				}
			],
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const plan = await planVehicleHighlightIntent('audi_r8', 'grille');

		expect(plan.operations.length).toBeGreaterThan(0);
		expect(plan.operations.every((operation) => operation.targetType === 'material')).toBe(true);
		expect(plan.operations.some((operation) => operation.targetId === bodyMaterial!.id)).toBe(true);
		expect(plan.matchedMaterialNames).toEqual([bodyMaterial!.name]);
		expect(plan.matchedPaths.length).toBeGreaterThan(0);
	});

	it('routes isolate requests to context dimming plus highlight without node hiding', async () => {
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
					confidence: 0.91,
					category: 'grille',
					nodeIds: [],
					meshIds: bodyMaterial!.meshIds.slice(0, 1),
					materialIds: [bodyMaterial!.id],
					region: 'front',
					side: 'center'
				}
			],
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'isolate the grille');

		expect(plan.operations.length).toBeGreaterThan(0);
		expect(plan.operations.some((operation) => operation.targetType === 'node')).toBe(false);
		expect(
			plan.operations.some(
				(operation) => operation.targetType === 'material' && operation.op === 'set_alpha'
			)
		).toBe(true);
		expect(
			plan.operations.some(
				(operation) => operation.targetType === 'material' && operation.op === 'set_overlay_highlight'
			)
		).toBe(true);
	});

	it('emits deterministic node translations for explode requests', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const structure = await deriveStructuralAssetSnapshot('audi_r8');
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
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const plan = await planVehiclePartIntent('audi_r8', 'explode the front grille', 'explode');

		expect(plan.mode).toBe('explode');
		expect(plan.matchedPartIds).toEqual(['front_grille']);
		expect(plan.matchedNodeIds.length).toBeGreaterThan(0);
		const nodeOperations = plan.operations.filter((operation) => operation.targetType === 'node');
		expect(nodeOperations.length).toBe(plan.matchedNodeIds.length);
		expect(nodeOperations.every((operation) => operation.op === 'set_translation')).toBe(true);
		expect(nodeOperations.every((operation) => Array.isArray(operation.value))).toBe(true);

		const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
		const matchedNodes = plan.matchedNodeIds
			.map((nodeId) => nodeById.get(nodeId))
			.filter((node): node is NonNullable<typeof node> => node !== undefined);
		const matchedBounds = matchedNodes.reduce(
			(accumulator, node) => {
				const min = node.bounds?.min ?? node.worldTranslation;
				const max = node.bounds?.max ?? node.worldTranslation;
				return {
					min: [
						Math.min(accumulator.min[0], min[0]),
						Math.min(accumulator.min[1], min[1]),
						Math.min(accumulator.min[2], min[2])
					] as [number, number, number],
					max: [
						Math.max(accumulator.max[0], max[0]),
						Math.max(accumulator.max[1], max[1]),
						Math.max(accumulator.max[2], max[2])
					] as [number, number, number]
				};
			},
			{
				min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY] as [
					number,
					number,
					number
				],
				max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] as [
					number,
					number,
					number
				]
			}
		);
		const matchedCentroid: [number, number, number] = [
			(matchedBounds.min[0] + matchedBounds.max[0]) / 2,
			(matchedBounds.min[1] + matchedBounds.max[1]) / 2,
			(matchedBounds.min[2] + matchedBounds.max[2]) / 2
		];
		let minimumExplodedY = Number.POSITIVE_INFINITY;
		const groundLift =
			plan.operations.find(
				(operation) =>
					operation.targetType === 'viewer' &&
					operation.targetId === 'scene_y_offset' &&
					operation.op === 'set_target'
			)?.value ?? 0;
		const yLift = typeof groundLift === 'number' ? groundLift : 0;
		for (const operation of nodeOperations) {
			const node = nodeById.get(operation.targetId);
			expect(node).toBeDefined();
			expect(Array.isArray(operation.value)).toBe(true);
			if (!node || !Array.isArray(operation.value)) {
				continue;
			}

			const originalSelectionDistance = Math.hypot(
				(node.bounds?.center[0] ?? node.worldTranslation[0]) - matchedCentroid[0],
				(node.bounds?.center[1] ?? node.worldTranslation[1]) - matchedCentroid[1],
				(node.bounds?.center[2] ?? node.worldTranslation[2]) - matchedCentroid[2]
			);
			const movedSelectionDistance = Math.hypot(
				(node.bounds?.center[0] ?? node.worldTranslation[0]) +
					((operation.value[0] ?? 0) - node.translation[0]) -
					matchedCentroid[0],
				(node.bounds?.center[1] ?? node.worldTranslation[1]) +
					((operation.value[1] ?? 0) - node.translation[1]) -
					matchedCentroid[1],
				(node.bounds?.center[2] ?? node.worldTranslation[2]) +
					((operation.value[2] ?? 0) - node.translation[2]) -
					matchedCentroid[2]
			);
			const translationDeltaMagnitude = Math.hypot(
				(operation.value[0] ?? 0) - node.translation[0],
				(operation.value[1] ?? 0) - node.translation[1],
				(operation.value[2] ?? 0) - node.translation[2]
			);

			expect(movedSelectionDistance).toBeGreaterThan(0);
			if (originalSelectionDistance > 0.01) {
				expect(translationDeltaMagnitude).toBeGreaterThanOrEqual(
					Math.max(0, originalSelectionDistance / 3 - 0.0002)
				);
			} else {
				expect(translationDeltaMagnitude).toBeGreaterThan(0);
			}
			minimumExplodedY = Math.min(
				minimumExplodedY,
				(node.bounds?.min[1] ?? node.worldTranslation[1]) +
					((operation.value[1] ?? 0) - node.translation[1]) +
					yLift
			);
		}
		expect(minimumExplodedY).toBeGreaterThanOrEqual(0);

		const translationDeltas = nodeOperations.map((operation) => {
			const node = nodeById.get(operation.targetId);
			if (!node || !Array.isArray(operation.value)) {
				return 'missing';
			}

			return JSON.stringify([
				Number(((operation.value[0] ?? 0) - node.translation[0]).toFixed(4)),
				Number(((operation.value[1] ?? 0) - node.translation[1]).toFixed(4)),
				Number(((operation.value[2] ?? 0) - node.translation[2]).toFixed(4))
			]);
		});
		expect(new Set(translationDeltas).size).toBeGreaterThan(1);
	});

	it('routes explode requests to node translations without adding highlight overlays', async () => {
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
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'explode the grille');

		expect(plan.operations.length).toBeGreaterThan(0);
		expect(
			plan.operations
				.filter((operation) => operation.targetType === 'node')
				.every((operation) => operation.op === 'set_translation')
		).toBe(true);
		expect(
			plan.operations.some(
				(operation) => operation.targetType === 'material' && operation.op === 'set_overlay_highlight'
			)
		).toBe(false);
	});

	it('plans xray as a viewer-level toggle', async () => {
		const plan = await resolveVehicleIntent('audi_r8', 'enable xray view');

		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]?.targetType).toBe('viewer');
		expect(plan.operations[0]?.targetId).toBe('xray');
		expect(plan.operations[0]?.op).toBe('set_enabled');
		expect(plan.operations[0]?.value).toBe(true);
	});

	it('prefers semantic groups for wheel queries before falling back to tighter part units', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterial = capabilities.materials.find((material) => material.meshIds.length > 0);

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
					confidence: 0.95
				}
			],
			acceptedParts: [
				{
					id: 'front_grille',
					humanLabel: 'front grille',
					aliases: ['grille'],
					confidence: 0.91,
					category: 'grille',
					nodeIds: [],
					meshIds: wheelMaterial!.meshIds.slice(0, 1),
					materialIds: [wheelMaterial!.id],
					region: 'front',
					side: 'center'
				}
			],
			acceptedGroups: [
				{
					id: 'group_wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims', 'tires'],
					confidence: 0.94,
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
					aliases: ['wheel', 'rims'],
					confidence: 0.98,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate', 'explode'],
					nodeIds: ['node-1'],
					meshIds: wheelMaterial!.meshIds.slice(0, 1),
					materialIds: [wheelMaterial!.id, 'material-contaminated'],
					derivedFrom: ['llm']
				}
			],
			discardedSuggestions: []
		});

		const plan = await planVehiclePartIntent('audi_r8', 'isolate the wheels', 'isolate');

		expect(plan.matchedPartIds).toEqual(['group-wheels']);
		expect(plan.matchedPartLabels).toEqual(['wheels']);
		expect(plan.matchedMaterialIds).toEqual([wheelMaterial!.id]);
		expect(
			plan.operations.some(
				(operation) => operation.targetType === 'material' && operation.op === 'set_overlay_highlight'
			)
		).toBe(true);
	});

	it('plans deterministic headlight emissive operations when semantic headlight materials exist', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const headlightMaterials = capabilities.materials.slice(0, 2);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: headlightMaterials.map((material, index) => ({
				targetType: 'material',
				targetId: material.id,
				targetName: material.name,
				humanLabel: index === 0 ? 'left headlight' : 'right headlight',
				aliases: ['headlight', 'headlamp'],
				semanticTags: [index === 0 ? 'left_headlight' : 'right_headlight'],
				confidence: 0.93
			})),
			acceptedParts: [],
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const support = await getVehicleHeadlightSupport('audi_r8');
		const plan = await planVehicleHeadlightIntent('audi_r8', true);

		expect(support.supported).toBe(true);
		expect(support.materialIds).toEqual(headlightMaterials.map((material) => material.id));
		expect(plan.supported).toBe(true);
		expect(plan.operations).toHaveLength(headlightMaterials.length);
		expect(
			plan.operations.every(
				(operation) =>
					operation.targetType === 'material' &&
					operation.op === 'set_emissive_factor' &&
					Array.isArray(operation.value) &&
					operation.value[0] === 1
			)
		).toBe(true);
	});
});
