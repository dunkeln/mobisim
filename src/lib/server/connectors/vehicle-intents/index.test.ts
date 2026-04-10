import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	parsePaintRequest,
	resolveNormalizedVehiclePaintIntent,
	planVehicleHighlightIntent,
	planVehiclePartIntent,
	planVehicleSetLogicIntent,
	resolveVehicleIntent
} from '$lib/server/connectors/vehicle-intents';
import {
	readVehicleSemanticOverlay,
	writeVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';

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

	it('parses nuanced off-white automotive paint requests without requiring a normalized palette color', () => {
		const parsed = parsePaintRequest('make it an off white gloss');

		expect(parsed).not.toBeNull();
		expect(parsed?.color[0]).toBeGreaterThan(0.88);
		expect(parsed?.color[1]).toBeGreaterThan(0.86);
		expect(parsed?.color[2]).toBeGreaterThan(0.78);
		expect(parsed?.finish?.label).toBe('gloss');
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
				(operation) => operation.targetType === 'node' && operation.op === 'set_alpha'
			)
		).toBe(true);
		expect(
			plan.operations.some(
				(operation) =>
					operation.targetType === 'node' && operation.op === 'set_overlay_highlight'
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
		expect(plan.operations.every((operation) => operation.targetType === 'node')).toBe(true);
		expect(plan.matchedMaterialNames).toEqual([bodyMaterial!.name]);
		expect(plan.matchedPaths.length).toBeGreaterThan(0);
	});

	it('treats select phrasing as a highlight intent for visible part focus', async () => {
		const plan = await planVehicleHighlightIntent('audi_r8', 'select the wheels');

		expect(plan.operations.length).toBeGreaterThan(0);
		expect(
			plan.operations.some(
				(operation) =>
					operation.targetType === 'node' && operation.op === 'set_overlay_highlight'
			)
		).toBe(true);
		expect(plan.summary.toLowerCase()).toContain('highlight');
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
		expect(plan.operations.some((operation) => operation.targetType === 'node')).toBe(true);
		expect(
			plan.operations.some(
				(operation) => operation.targetType === 'node' && operation.op === 'set_alpha'
			)
		).toBe(true);
		expect(
			plan.operations.some(
				(operation) =>
					operation.targetType === 'node' && operation.op === 'set_overlay_highlight'
			)
		).toBe(true);
	});

	it('routes remove requests to reduced-alpha material edits without node translations', async () => {
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

		const plan = await planVehiclePartIntent('audi_r8', 'remove the front grille', 'remove');

		expect(plan.mode).toBe('remove');
		expect(plan.matchedPartIds).toEqual(['front_grille']);
		expect(plan.matchedNodeIds.length).toBeGreaterThan(0);
		expect(plan.operations.some((operation) => operation.targetType === 'node')).toBe(true);
		expect(
			plan.operations.some(
				(operation) =>
					operation.targetType === 'node' &&
					operation.op === 'set_alpha' &&
					typeof operation.value === 'number'
			)
		).toBe(true);
		expect(plan.operations.every((operation) => operation.op === 'set_alpha')).toBe(true);
	});

	it('plans remove-everything-except requests through a typed set-logic job', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterials = capabilities.materials.slice(0, 2);

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
					id: 'wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims'],
					confidence: 0.96,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: wheelMaterials.flatMap((material) => material.meshIds),
					materialIds: wheelMaterials.map((material) => material.id),
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await planVehicleSetLogicIntent(
			'audi_r8',
			'remove everything and keep the wheels'
		);

		expect(plan).not.toBeNull();
		expect(plan?.plannerJob.intent).toBe('remove_all_except');
		expect(plan?.plannerJob.keep).toEqual([{ kind: 'semantic_query', query: 'wheels' }]);
		expect(plan?.plannerJob.steps.map((step) => step.kind)).toEqual([
			'resolve_keep_targets',
			'enumerate_all_materials',
			'subtract_keep_targets',
			'apply_remove_material_alpha'
		]);
		expect(plan?.verification.preservedMaterialIds).toEqual(
			wheelMaterials.map((material) => material.id).sort((left, right) => left.localeCompare(right))
		);
		expect(plan?.verification.verificationPassed).toBe(true);
		expect(
			plan?.operations.every(
				(operation) =>
					operation.targetType === 'node' &&
					operation.op === 'set_alpha'
			)
		).toBe(true);
		expect(plan?.summary.toLowerCase()).toContain('except wheels');
	});

	it('routes remove-everything-except requests through the main intent resolver', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterials = capabilities.materials.slice(0, 2);

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
					id: 'wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims'],
					confidence: 0.96,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: wheelMaterials.flatMap((material) => material.meshIds),
					materialIds: wheelMaterials.map((material) => material.id),
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'keep only the wheels');

		expect(plan.operations.length).toBeGreaterThan(0);
		expect(
			plan.operations.every(
				(operation) =>
					operation.targetType === 'node' &&
					operation.op === 'set_alpha'
			)
		).toBe(true);
		expect(plan.summary.toLowerCase()).toContain('except wheels');
	});

	it('unions multiple keep-targets before subtracting the removal set', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterials = capabilities.materials.slice(0, 2);
		const glassMaterials = capabilities.materials.slice(2, 4);

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
					id: 'wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims'],
					confidence: 0.96,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: wheelMaterials.flatMap((material) => material.meshIds),
					materialIds: wheelMaterials.map((material) => material.id),
					author: 'user'
				},
				{
					id: 'glasshouse',
					humanLabel: 'glasshouse',
					aliases: ['glass', 'windows'],
					confidence: 0.94,
					category: 'glasshouse',
					supports: ['highlight', 'focus', 'isolate', 'tint'],
					nodeIds: [],
					meshIds: glassMaterials.flatMap((material) => material.meshIds),
					materialIds: glassMaterials.map((material) => material.id),
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await planVehicleSetLogicIntent(
			'audi_r8',
			'remove everything except wheels and glass'
		);

		expect(plan).not.toBeNull();
		expect(plan?.plannerJob.keep).toEqual([
			{
				kind: 'union',
				items: [
					{ kind: 'semantic_query', query: 'wheels' },
					{ kind: 'semantic_query', query: 'glass' }
				]
			}
		]);
		expect(plan?.verification.preservedMaterialIds).toEqual(
			[...wheelMaterials, ...glassMaterials]
				.map((material) => material.id)
				.sort((left, right) => left.localeCompare(right))
		);
		expect(
			plan?.operations.every(
				(operation) =>
					operation.targetType === 'node' &&
					operation.op === 'set_alpha'
			)
		).toBe(true);
	});

	it('supports subtract expressions for keep-set overrides', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterials = capabilities.materials.slice(0, 2);
		const glassMaterials = capabilities.materials.slice(2, 4);
		const grilleMaterials = capabilities.materials.slice(4, 5);

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
					id: 'wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims'],
					confidence: 0.96,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: wheelMaterials.flatMap((material) => material.meshIds),
					materialIds: wheelMaterials.map((material) => material.id),
					author: 'user'
				},
				{
					id: 'glasshouse',
					humanLabel: 'glasshouse',
					aliases: ['glass', 'windows'],
					confidence: 0.94,
					category: 'glasshouse',
					supports: ['highlight', 'focus', 'isolate', 'tint'],
					nodeIds: [],
					meshIds: glassMaterials.flatMap((material) => material.meshIds),
					materialIds: glassMaterials.map((material) => material.id),
					author: 'user'
				},
				{
					id: 'front_face',
					humanLabel: 'grille',
					aliases: ['front grille', 'grille'],
					confidence: 0.92,
					category: 'front_face',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: grilleMaterials.flatMap((material) => material.meshIds),
					materialIds: grilleMaterials.map((material) => material.id),
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await planVehicleSetLogicIntent(
			'audi_r8',
			'remove everything except wheels and glass, but remove grille too'
		);

		expect(plan).not.toBeNull();
		expect(plan?.plannerJob.keep).toEqual([
			{
				kind: 'subtract',
				left: {
					kind: 'union',
					items: [
						{ kind: 'semantic_query', query: 'wheels' },
						{ kind: 'semantic_query', query: 'glass' }
					]
				},
				right: {
					kind: 'semantic_query',
					query: 'grille'
				}
			}
		]);
		expect(plan?.verification.preservedMaterialIds).toEqual(
			[...wheelMaterials, ...glassMaterials]
				.map((material) => material.id)
				.filter((materialId) => !grilleMaterials.some((material) => material.id === materialId))
				.sort((left, right) => left.localeCompare(right))
		);
		expect(plan?.verification.mutatedMaterialIds).toContain(grilleMaterials[0]!.id);
	});

	it('intersects semantic targets with highlighted materials when the request says highlighted', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const headlightMaterials = capabilities.materials.slice(0, 2);
		const highlightedMaterialId = headlightMaterials[0]!.id;

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
					id: 'front_lighting',
					humanLabel: 'headlights',
					aliases: ['headlight', 'front lights'],
					confidence: 0.95,
					category: 'front_lighting',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: headlightMaterials.flatMap((material) => material.meshIds),
					materialIds: headlightMaterials.map((material) => material.id),
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await planVehicleSetLogicIntent('audi_r8', 'show only highlighted headlights', {
			presentation: {
				highlightedTargets: [
					{
						targetId: highlightedMaterialId,
						targetType: 'material'
					}
				]
			}
		});

		expect(plan).not.toBeNull();
		expect(plan?.plannerJob.keep).toEqual([
			{
				kind: 'intersect',
				left: {
					kind: 'semantic_query',
					query: 'headlights'
				},
				right: {
					kind: 'highlighted_materials'
				}
			}
		]);
		expect(plan?.plannerJob.steps.map((step) => step.kind)).toContain('read_highlighted_materials');
		expect(plan?.verification.preservedMaterialIds).toEqual([highlightedMaterialId]);
	});

	it('records preserve-current-paint as an explicit planner constraint', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const wheelMaterials = capabilities.materials.slice(0, 2);

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
					id: 'wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims'],
					confidence: 0.96,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: wheelMaterials.flatMap((material) => material.meshIds),
					materialIds: wheelMaterials.map((material) => material.id),
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await planVehicleSetLogicIntent(
			'audi_r8',
			'remove everything except wheels and preserve current paint'
		);

		expect(plan).not.toBeNull();
		expect(plan?.plannerJob.constraints).toEqual([{ kind: 'preserve_current_paint' }]);
		expect(plan?.operations.every((operation) => operation.op === 'set_alpha')).toBe(true);
	});

	it('routes remove requests to reduced-alpha material edits only', async () => {
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

		const plan = await resolveVehicleIntent('audi_r8', 'remove the grille');

		expect(plan.operations.length).toBeGreaterThan(0);
		expect(plan.operations.some((operation) => operation.targetType === 'node')).toBe(true);
		expect(
			plan.operations.every(
				(operation) =>
					operation.targetType === 'node' &&
					operation.op === 'set_alpha'
			)
		).toBe(true);
	});

	it('plans xray as a viewer-level toggle', async () => {
		const plan = await resolveVehicleIntent('audi_r8', 'enable xray view');

		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]?.targetType).toBe('viewer');
		expect(plan.operations[0]?.targetId).toBe('xray');
		expect(plan.operations[0]?.op).toBe('set_enabled');
		expect(plan.operations[0]?.value).toBe(true);
	});

	it('plans uv debug as a viewer-level toggle', async () => {
		const plan = await resolveVehicleIntent('audi_r8', 'enable uv debug');

		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]?.targetType).toBe('viewer');
		expect(plan.operations[0]?.targetId).toBe('uv_debug');
		expect(plan.operations[0]?.op).toBe('set_enabled');
		expect(plan.operations[0]?.value).toBe(true);
	});

	it('uses only semantic headlight material tags for glow', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const semanticHeadlightMaterial = capabilities.materials[0];

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		expect(semanticHeadlightMaterial).toBeDefined();

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [
				{
					targetType: 'material',
					targetId: semanticHeadlightMaterial!.id,
					targetName: semanticHeadlightMaterial!.name,
					humanLabel: 'left headlight lens',
					aliases: ['headlight'],
					semanticTags: ['left_headlight'],
					confidence: 0.98
				}
			],
			acceptedParts: [
				{
					id: 'left_headlight_cluster',
					humanLabel: 'left headlight cluster',
					aliases: ['headlight'],
					confidence: 0.95,
					category: 'light',
					nodeIds: [],
					meshIds: semanticHeadlightMaterial!.meshIds.slice(0, 1),
					materialIds: [semanticHeadlightMaterial!.id],
					region: 'front',
					side: 'left'
				}
			],
			acceptedGroups: [
				{
					id: 'front_lighting',
					humanLabel: 'front lighting',
					aliases: ['headlights', 'front lights'],
					confidence: 1,
					category: 'front_lighting',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: semanticHeadlightMaterial!.meshIds.slice(0, 1),
					materialIds: [semanticHeadlightMaterial!.id],
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'turn on the headlights');
		expect(plan.operations.length).toBeGreaterThan(0);
		expect(plan.operations.every((operation) => operation.op === 'set_emissive_factor')).toBe(true);
		expect(plan.operations.every((operation) => operation.targetType === 'material')).toBe(true);
	});

	it('fails closed for headlights when no semantic lighting targets exist', async () => {
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
			acceptedGroups: [],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'turn on the headlights');

		expect(plan.operations).toHaveLength(0);
		expect(plan.summary).toBe(
			'No accepted executable semantic lighting targets were found for front_lighting.'
		);
	});

	it('executes front lighting from user-authored node-backed groups', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const nodeBackedMaterial = capabilities.materials.find((material) => material.meshIds.length > 0);

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		expect(nodeBackedMaterial).toBeDefined();

		const structure = await deriveStructuralAssetSnapshot('audi_r8');
		const targetMeshId = nodeBackedMaterial!.meshIds[0];
		const targetNodeIds = structure.nodes
			.filter((node) => node.meshId === targetMeshId)
			.map((node) => node.id);

		expect(targetNodeIds.length).toBeGreaterThan(0);

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
					id: 'front_lighting',
					humanLabel: 'front lighting',
					aliases: ['headlights', 'front lights'],
					confidence: 1,
					category: 'front_lighting',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: targetNodeIds,
					meshIds: [targetMeshId!],
					materialIds: [],
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'turn on the front lights');

		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]?.targetId).toBe(nodeBackedMaterial!.id);
		expect(plan.operations[0]?.op).toBe('set_emissive_factor');
		expect(plan.operations[0]?.targetType).toBe('material');
	});

	it('uses only eligible materials inside front lighting groups for headlight glow', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const eligibleMaterial = capabilities.materials[0];
		const contaminantMaterial = capabilities.materials[1];

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
					targetId: eligibleMaterial!.id,
					targetName: eligibleMaterial!.name,
					humanLabel: 'left headlight lens',
					aliases: ['headlight'],
					semanticTags: ['left_headlight'],
					confidence: 0.96
				}
			],
			acceptedParts: [
				{
					id: 'left_headlight_cluster',
					humanLabel: 'left headlight cluster',
					aliases: ['left headlight'],
					confidence: 0.95,
					category: 'light',
					nodeIds: [],
					meshIds: eligibleMaterial!.meshIds.slice(0, 1),
					materialIds: [eligibleMaterial!.id],
					region: 'front',
					side: 'left'
				}
			],
			acceptedGroups: [
				{
					id: 'front_lighting',
					humanLabel: 'front lighting',
					aliases: ['headlights', 'front lights'],
					confidence: 1,
					category: 'front_lighting',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: [
						...eligibleMaterial!.meshIds.slice(0, 1),
						...contaminantMaterial!.meshIds.slice(0, 1)
					],
					materialIds: [eligibleMaterial!.id, contaminantMaterial!.id],
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'turn on the headlights');

		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]?.targetId).toBe(eligibleMaterial!.id);
		expect(plan.operations[0]?.op).toBe('set_emissive_factor');
		expect(plan.operations[0]?.value?.toString()).toBe('1,0.95,0.82');
	});

	it('respects explicit rear-light exclusions for generic light requests', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const frontMaterial = capabilities.materials[0];
		const rearMaterial = capabilities.materials[1];

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
					targetId: frontMaterial!.id,
					targetName: frontMaterial!.name,
					humanLabel: 'right headlight lens',
					aliases: ['headlight'],
					semanticTags: ['right_headlight'],
					confidence: 0.96
				}
			],
			acceptedParts: [
				{
					id: 'right_headlight_cluster',
					humanLabel: 'right headlight cluster',
					aliases: ['front lights'],
					confidence: 0.95,
					category: 'light',
					nodeIds: [],
					meshIds: frontMaterial!.meshIds.slice(0, 1),
					materialIds: [frontMaterial!.id],
					region: 'front',
					side: 'right'
				},
				{
					id: 'rear_lamp_cluster',
					humanLabel: 'rear lamp cluster',
					aliases: ['rear lights'],
					confidence: 0.95,
					category: 'light',
					nodeIds: [],
					meshIds: rearMaterial!.meshIds.slice(0, 1),
					materialIds: [rearMaterial!.id],
					region: 'rear',
					side: 'center'
				}
			],
			acceptedGroups: [
				{
					id: 'front_lighting',
					humanLabel: 'front lighting',
					aliases: ['headlights', 'front lights'],
					confidence: 1,
					category: 'front_lighting',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: frontMaterial!.meshIds.slice(0, 1),
					materialIds: [frontMaterial!.id],
					author: 'user'
				},
				{
					id: 'rear_lighting',
					humanLabel: 'rear lighting',
					aliases: ['rear lights', 'taillights'],
					confidence: 1,
					category: 'rear_lighting',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: rearMaterial!.meshIds.slice(0, 1),
					materialIds: [rearMaterial!.id],
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'turn off the lights except the rear lights');

		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]?.targetId).toBe(frontMaterial!.id);
		expect(plan.operations[0]?.value?.toString()).toBe('0,0,0');
	});

	it('uses semantic rear lighting parts for taillight glow', async () => {
		const capabilities = await deriveVehicleInspectionCapabilities('audi_r8');
		const semanticDir = await mkdtemp(path.join(os.tmpdir(), 'mobisim-semantic-'));
		const semanticTaillightMaterial = capabilities.materials[0];

		semanticDirs.push(semanticDir);
		process.env.SEMANTIC_MANIFEST_LOCAL_DIR = semanticDir;

		expect(semanticTaillightMaterial).toBeDefined();

		await writeVehicleSemanticOverlay({
			assetId: 'audi_r8',
			structuralGeneratedAt: capabilities.generatedAt,
			generatedAt: new Date().toISOString(),
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [
				{
					id: 'rear_lamp_cluster',
					humanLabel: 'rear lamp cluster',
					aliases: ['rear lights', 'taillights'],
					confidence: 0.95,
					category: 'light',
					nodeIds: [],
					meshIds: [],
					materialIds: [semanticTaillightMaterial!.id],
					region: 'rear',
					side: 'center'
				}
			],
			acceptedGroups: [
				{
					id: 'rear_lighting',
					humanLabel: 'rear lighting',
					aliases: ['taillights', 'rear lights'],
					confidence: 0.95,
					category: 'rear_lighting',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: semanticTaillightMaterial!.meshIds.slice(0, 1),
					materialIds: [semanticTaillightMaterial!.id],
					author: 'user'
				}
			],
			discardedSuggestions: []
		});

		const plan = await resolveVehicleIntent('audi_r8', 'turn on the rear lights');
		expect(plan.operations.length).toBeGreaterThan(0);
		expect(plan.operations.every((operation) => operation.op === 'set_emissive_factor')).toBe(true);
		expect(plan.operations.every((operation) => operation.targetType === 'material')).toBe(true);
		expect(plan.operations.every((operation) => operation.value?.toString() === '1,0.14,0.1')).toBe(
			true
		);
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
					id: 'wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims', 'tires'],
					confidence: 0.94,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: wheelMaterial!.meshIds.slice(0, 1),
					materialIds: [wheelMaterial!.id],
					author: 'agent'
				},
				{
					id: 'wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims'],
					confidence: 0.98,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: ['node-1'],
					meshIds: wheelMaterial!.meshIds.slice(0, 1),
					materialIds: [wheelMaterial!.id, 'material-contaminated'],
					author: 'agent'
				}
			],
			discardedSuggestions: []
		});

		const plan = await planVehiclePartIntent('audi_r8', 'isolate the wheels', 'isolate');

		expect(plan.matchedPartIds).toEqual(['wheels']);
		expect(plan.matchedPartLabels).toEqual(['wheels']);
		expect(plan.matchedMaterialIds).toEqual([wheelMaterial!.id]);
		expect(
			plan.operations.some(
				(operation) =>
					operation.targetType === 'node' && operation.op === 'set_overlay_highlight'
			)
		).toBe(true);
	});
});
