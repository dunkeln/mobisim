import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import type { Node, Material, Mesh, Primitive, Scene } from '@gltf-transform/core';
import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';
import { resolveLocalAssetPath } from '$lib/server/connectors/vehicle-registry/storage';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type {
	VehicleBodyPaintPlan,
	VehicleInspectionCapabilities,
	VehicleInspectionControlCandidate,
	VehicleInspectionDebugMesh,
	VehicleInspectionMaterialSummary,
	VehicleInspectionPatchManifest,
	VehiclePartHighlightPlan,
	VehicleInspectionPatchValidationResult,
	VehicleInspectionSceneSummary,
	VehicleWindowTintPlan
} from './types';

type GltfPreprocessNode = {
	id: string;
	name: string;
	path: string;
	childCount: number;
	meshId: string | null;
	translation: [number, number, number];
	rotation: [number, number, number, number];
	scale: [number, number, number];
};

type GltfPreprocessMesh = {
	id: string;
	name: string;
	primitiveCount: number;
	attributeSemantics: string[];
	materialNames: string[];
	hasTexcoord0: boolean;
	hasTexcoord1: boolean;
	wireframeCapable: boolean;
	uvDebugCapable: boolean;
};

type GltfPreprocessMaterial = {
	id: string;
	name: string;
	alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
	doubleSided: boolean;
	textureSlots: string[];
};

type GltfPreprocessManifest = {
	assetId: VehicleAssetId;
	assetPath: string;
	generatedAt: string;
	scenes: VehicleInspectionSceneSummary[];
	nodes: GltfPreprocessNode[];
	meshes: GltfPreprocessMesh[];
	materials: GltfPreprocessMaterial[];
};

type CacheEntry = {
	cacheKey: string;
	manifest: GltfPreprocessManifest;
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const preprocessCache = new Map<VehicleAssetId, CacheEntry>();

function toVec3(values: number[]): [number, number, number] {
	return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function toQuat(values: number[]): [number, number, number, number] {
	return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
}

function createNodeId(index: number): string {
	return `node-${index}`;
}

function createMeshId(index: number): string {
	return `mesh-${index}`;
}

function createMaterialId(index: number): string {
	return `material-${index}`;
}

function formatNodeName(node: Node, fallbackIndex: number): string {
	return node.getName().trim() || `Node ${fallbackIndex}`;
}

function formatMeshName(mesh: Mesh, fallbackIndex: number): string {
	return mesh.getName().trim() || `Mesh ${fallbackIndex}`;
}

function formatMaterialName(material: Material, fallbackIndex: number): string {
	return material.getName().trim() || `Material ${fallbackIndex}`;
}

function collectTextureSlots(material: Material): string[] {
	const slots: string[] = [];

	if (material.getBaseColorTexture()) slots.push('baseColorTexture');
	if (material.getEmissiveTexture()) slots.push('emissiveTexture');
	if (material.getMetallicRoughnessTexture()) slots.push('metallicRoughnessTexture');
	if (material.getNormalTexture()) slots.push('normalTexture');
	if (material.getOcclusionTexture()) slots.push('occlusionTexture');

	return slots;
}

function collectPrimitiveSemantics(primitive: Primitive): string[] {
	return primitive
		.listSemantics()
		.slice()
		.sort((left, right) => left.localeCompare(right));
}

function collectSceneSummaries(scenes: Scene[]): VehicleInspectionSceneSummary[] {
	return scenes.map((scene, index) => {
		const bounds = getBounds(scene);

		return {
			id: `scene-${index}`,
			name: scene.getName().trim() || `Scene ${index}`,
			rootNodeNames: scene
				.listChildren()
				.map((child, childIndex) => formatNodeName(child, childIndex)),
			bounds: {
				min: toVec3(bounds.min),
				max: toVec3(bounds.max)
			}
		};
	});
}

function collectNodeSummaries(
	scenes: Scene[],
	meshIds: WeakMap<Mesh, string>
): GltfPreprocessNode[] {
	const nodes: GltfPreprocessNode[] = [];
	const seenNodes = new Set<Node>();

	const visitNode = (node: Node, parentPath: string, index: number): void => {
		if (seenNodes.has(node)) return;
		seenNodes.add(node);

		const name = formatNodeName(node, index);
		const path = parentPath ? `${parentPath}/${name}` : name;
		nodes.push({
			id: createNodeId(nodes.length),
			name,
			path,
			childCount: node.listChildren().length,
			meshId: node.getMesh() ? (meshIds.get(node.getMesh() as Mesh) ?? null) : null,
			translation: toVec3(node.getTranslation()),
			rotation: toQuat(node.getRotation()),
			scale: toVec3(node.getScale())
		});

		node.listChildren().forEach((child, childIndex) => visitNode(child, path, childIndex));
	};

	scenes.forEach((scene) => {
		scene
			.listChildren()
			.forEach((node, nodeIndex) => visitNode(node, scene.getName().trim(), nodeIndex));
	});

	nodes.sort((left, right) => left.path.localeCompare(right.path));
	return nodes;
}

function collectMeshSummaries(meshes: Mesh[]): {
	meshes: GltfPreprocessMesh[];
	meshIds: WeakMap<Mesh, string>;
} {
	const meshIds = new WeakMap<Mesh, string>();
	const summaries = meshes.map((mesh, index) => {
		const id = createMeshId(index);
		meshIds.set(mesh, id);

		const primitives = mesh.listPrimitives();
		const semantics = new Set<string>();
		const materialNames = new Set<string>();
		let hasTexcoord0 = false;
		let hasTexcoord1 = false;

		for (const primitive of primitives) {
			for (const semantic of collectPrimitiveSemantics(primitive)) {
				semantics.add(semantic);
				if (semantic === 'TEXCOORD_0') hasTexcoord0 = true;
				if (semantic === 'TEXCOORD_1') hasTexcoord1 = true;
			}

			const material = primitive.getMaterial();
			if (material) {
				materialNames.add(material.getName().trim() || 'Unnamed Material');
			}
		}

		return {
			id,
			name: formatMeshName(mesh, index),
			primitiveCount: primitives.length,
			attributeSemantics: Array.from(semantics).sort((left, right) => left.localeCompare(right)),
			materialNames: Array.from(materialNames).sort((left, right) => left.localeCompare(right)),
			hasTexcoord0,
			hasTexcoord1,
			wireframeCapable: primitives.length > 0,
			uvDebugCapable: hasTexcoord0 || hasTexcoord1
		};
	});

	return { meshes: summaries, meshIds };
}

function collectMaterialSummaries(materials: Material[]): GltfPreprocessMaterial[] {
	return materials.map((material, index) => ({
		id: createMaterialId(index),
		name: formatMaterialName(material, index),
		alphaMode: material.getAlphaMode(),
		doubleSided: material.getDoubleSided(),
		textureSlots: collectTextureSlots(material)
	}));
}

async function createCacheKey(assetPath: string): Promise<string> {
	const assetStats = await stat(assetPath);
	return `${assetPath}:${assetStats.size}:${assetStats.mtimeMs}`;
}

async function preprocessVehicleAsset(assetId: VehicleAssetId): Promise<GltfPreprocessManifest> {
	const assetPath = resolveLocalAssetPath(assetId);
	await access(assetPath, constants.R_OK);

	const cacheKey = await createCacheKey(assetPath);
	const cached = preprocessCache.get(assetId);
	if (cached && cached.cacheKey === cacheKey) {
		return cached.manifest;
	}

	const document = await io.read(assetPath);
	await document.transform(dedup(), prune());

	const root = document.getRoot();
	const scenes = root.listScenes();
	const { meshes, meshIds } = collectMeshSummaries(root.listMeshes());
	const manifest: GltfPreprocessManifest = {
		assetId,
		assetPath,
		generatedAt: new Date().toISOString(),
		scenes: collectSceneSummaries(scenes),
		nodes: collectNodeSummaries(scenes, meshIds),
		meshes,
		materials: collectMaterialSummaries(root.listMaterials())
	};

	preprocessCache.set(assetId, { cacheKey, manifest });
	return manifest;
}

function deriveControlCandidates(nodes: GltfPreprocessNode[]): VehicleInspectionControlCandidate[] {
	return nodes
		.filter((node) => node.meshId !== null || node.childCount > 0)
		.map((node) => ({
			nodeId: node.id,
			name: node.name,
			path: node.path,
			meshId: node.meshId,
			availableControls: ['translation', 'rotation', 'scale', 'visibility']
		}));
}

function deriveDebugMeshes(meshes: GltfPreprocessMesh[]): {
	wireframeMeshes: VehicleInspectionDebugMesh[];
	uvDebugMeshes: VehicleInspectionDebugMesh[];
} {
	const toDebugMesh = (mesh: GltfPreprocessMesh): VehicleInspectionDebugMesh => ({
		meshId: mesh.id,
		name: mesh.name,
		attributeSemantics: mesh.attributeSemantics,
		materialNames: mesh.materialNames
	});

	return {
		wireframeMeshes: meshes.filter((mesh) => mesh.wireframeCapable).map(toDebugMesh),
		uvDebugMeshes: meshes.filter((mesh) => mesh.uvDebugCapable).map(toDebugMesh)
	};
}

function deriveMaterialSummaries(
	materials: GltfPreprocessMaterial[]
): VehicleInspectionMaterialSummary[] {
	return materials.map((material) => ({
		id: material.id,
		name: material.name,
		alphaMode: material.alphaMode,
		doubleSided: material.doubleSided,
		textureSlots: material.textureSlots
	}));
}

const PRIMARY_HIGHLIGHT_FACTOR: [number, number, number, number] = [0.5566, 0.5308, 0.7892, 0.48];
const HIGHLIGHT_TERM_SYNONYMS: Record<string, string[]> = {
	wheel: ['wheel', 'wheels', 'tire', 'tires', 'rim', 'rims'],
	wheels: ['wheel', 'wheels', 'tire', 'tires', 'rim', 'rims'],
	headlight: ['headlight', 'headlights', 'headlamp', 'headlamps', 'lamp', 'light'],
	headlights: ['headlight', 'headlights', 'headlamp', 'headlamps', 'lamp', 'light'],
	glass: ['glass', 'window', 'windows', 'windshield'],
	door: ['door', 'doors'],
	hood: ['hood', 'bonnet'],
	trunk: ['trunk', 'boot']
};

function normalizeHighlightTerms(partQuery: string): string[] {
	const baseTerms = partQuery
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 1);

	const expandedTerms = new Set(baseTerms);

	for (const term of baseTerms) {
		for (const synonym of HIGHLIGHT_TERM_SYNONYMS[term] ?? []) {
			expandedTerms.add(synonym);
		}

		if (term.endsWith('s') && term.length > 2) {
			expandedTerms.add(term.slice(0, -1));
		} else {
			expandedTerms.add(`${term}s`);
		}
	}

	return Array.from(expandedTerms);
}

function includesAnyTerm(value: string, terms: string[]): boolean {
	const normalizedValue = value.toLowerCase();
	return terms.some((term) => normalizedValue.includes(term));
}

function inferBodyPaintMaterialNames(capabilities: VehicleInspectionCapabilities): string[] {
	const configuredNames = VEHICLE_CATALOG[capabilities.assetId].bodyPaintMaterialNames;
	if (configuredNames && configuredNames.length > 0) {
		const configuredNameSet = new Set(configuredNames);
		const matchedConfiguredNames = capabilities.materials
			.filter((material) => configuredNameSet.has(material.name))
			.map((material) => material.name);

		if (matchedConfiguredNames.length > 0) {
			return matchedConfiguredNames;
		}
	}

	const materialNameMatches = capabilities.materials
		.filter((material) => {
			const name = material.name.toLowerCase();
			return (
				(name.includes('paint') || name.includes('body')) &&
				!name.includes('glass') &&
				!name.includes('tire') &&
				!name.includes('rim')
			);
		})
		.map((material) => material.name);

	if (materialNameMatches.length > 0) {
		return materialNameMatches;
	}

	const bodyLikeMeshIds = new Set(
		capabilities.controlCandidates
			.filter((candidate) => {
				const path = candidate.path.toLowerCase();
				return (
					path.includes('body') ||
					path.includes('door') ||
					path.includes('hood') ||
					path.includes('bonnet') ||
					path.includes('bumper') ||
					path.includes('fender') ||
					path.includes('quarter') ||
					path.includes('mirror') ||
					path.includes('panel')
				);
			})
			.map((candidate) => candidate.meshId)
			.filter((meshId): meshId is string => meshId !== null)
	);

	if (bodyLikeMeshIds.size === 0) {
		return [];
	}

	const bodyLikeMaterialNames = new Set<string>();
	for (const mesh of capabilities.wireframeMeshes) {
		if (!bodyLikeMeshIds.has(mesh.meshId)) {
			continue;
		}

		for (const materialName of mesh.materialNames) {
			if (
				!materialName.toLowerCase().includes('glass') &&
				!materialName.toLowerCase().includes('chrome') &&
				!materialName.toLowerCase().includes('mirror')
			) {
				bodyLikeMaterialNames.add(materialName);
			}
		}
	}

	return capabilities.materials
		.filter((material) => bodyLikeMaterialNames.has(material.name))
		.map((material) => material.name);
}

function inferWindowTintMaterialNames(capabilities: VehicleInspectionCapabilities): string[] {
	const configuredNames = VEHICLE_CATALOG[capabilities.assetId].windowTintMaterialNames;
	if (configuredNames && configuredNames.length > 0) {
		const configuredNameSet = new Set(configuredNames);
		const matchedConfiguredNames = capabilities.materials
			.filter((material) => configuredNameSet.has(material.name))
			.map((material) => material.name);

		if (matchedConfiguredNames.length > 0) {
			return matchedConfiguredNames;
		}
	}

	return capabilities.materials
		.filter((material) => {
			const name = material.name.toLowerCase();
			return (
				name.includes('glass') ||
				name.includes('window') ||
				name.includes('windshield') ||
				name.includes('screen')
			);
		})
		.map((material) => material.name);
}

function isVec3(value: unknown): value is [number, number, number] {
	return (
		Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number')
	);
}

function isVec4(value: unknown): value is [number, number, number, number] {
	return (
		Array.isArray(value) && value.length === 4 && value.every((entry) => typeof entry === 'number')
	);
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function validatePatchOperation(
	operation: VehicleInspectionPatchOperation,
	index: number,
	nodeIds: Set<string>,
	materialIds: Set<string>,
	debugMeshIds: Set<string>
): { accepted?: VehicleInspectionPatchOperation; reason?: string } {
	switch (operation.targetType) {
		case 'node':
			if (!nodeIds.has(operation.targetId)) {
				return { reason: `Unknown node target: ${operation.targetId}` };
			}

			switch (operation.op) {
				case 'set_translation':
				case 'set_rotation':
				case 'set_scale':
					return isVec3(operation.value)
						? { accepted: operation }
						: { reason: `Node operation ${operation.op} requires a 3-number tuple` };
				case 'set_visibility':
					return isBoolean(operation.value)
						? { accepted: operation }
						: { reason: 'Node visibility requires a boolean value' };
			}
			break;
		case 'material':
			if (!materialIds.has(operation.targetId)) {
				return { reason: `Unknown material target: ${operation.targetId}` };
			}

			switch (operation.op) {
				case 'set_base_color_factor':
				case 'set_overlay_highlight':
					return isVec4(operation.value)
						? { accepted: operation }
						: { reason: `${operation.op} requires a 4-number tuple` };
				case 'set_emissive_factor':
					return isVec3(operation.value)
						? { accepted: operation }
						: { reason: 'Emissive factor requires a 3-number tuple' };
				case 'set_alpha':
					return isNumber(operation.value)
						? { accepted: operation }
						: { reason: 'Alpha requires a numeric value' };
				case 'set_double_sided':
					return isBoolean(operation.value)
						? { accepted: operation }
						: { reason: 'Double-sided requires a boolean value' };
			}
			break;
		case 'viewer':
			switch (operation.targetId) {
				case 'postprocess':
					return operation.op === 'set_enabled' && isBoolean(operation.value)
						? { accepted: operation }
						: { reason: 'Postprocess viewer op requires set_enabled(boolean)' };
				case 'wireframe':
				case 'uv_debug':
					if (operation.op === 'set_enabled' && isBoolean(operation.value)) {
						return { accepted: operation };
					}

					if (
						operation.op === 'set_target' &&
						(operation.value === null ||
							(typeof operation.value === 'string' && debugMeshIds.has(operation.value)))
					) {
						return { accepted: operation };
					}

					return {
						reason: `${operation.targetId} viewer op requires set_enabled(boolean) or set_target(meshId|null)`
					};
			}
	}

	return { reason: `Unsupported patch operation at index ${index}` };
}

export async function deriveVehicleInspectionCapabilities(
	assetId: VehicleAssetId
): Promise<VehicleInspectionCapabilities> {
	const manifest = await preprocessVehicleAsset(assetId);
	const { wireframeMeshes, uvDebugMeshes } = deriveDebugMeshes(manifest.meshes);

	return {
		assetId: manifest.assetId,
		generatedAt: manifest.generatedAt,
		sceneCount: manifest.scenes.length,
		nodeCount: manifest.nodes.length,
		meshCount: manifest.meshes.length,
		materialCount: manifest.materials.length,
		scenes: manifest.scenes,
		controlCandidates: deriveControlCandidates(manifest.nodes),
		wireframeMeshes,
		uvDebugMeshes,
		materials: deriveMaterialSummaries(manifest.materials)
	};
}

export async function planVehiclePartHighlight(
	assetId: VehicleAssetId,
	partQuery: string
): Promise<VehiclePartHighlightPlan> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const terms = normalizeHighlightTerms(partQuery);

	if (terms.length === 0) {
		return {
			assetId,
			partQuery,
			matchedPaths: [],
			matchedMaterialNames: [],
			operations: []
		};
	}

	const matchedNodes = capabilities.controlCandidates.filter(
		(candidate) => includesAnyTerm(candidate.name, terms) || includesAnyTerm(candidate.path, terms)
	);
	const matchedMeshIds = new Set(
		matchedNodes
			.map((candidate) => candidate.meshId)
			.filter((meshId): meshId is string => meshId !== null)
	);
	const matchedPaths = matchedNodes.map((candidate) => candidate.path);

	const meshMaterialNames = new Set<string>();
	for (const mesh of capabilities.wireframeMeshes) {
		if (!matchedMeshIds.has(mesh.meshId)) {
			continue;
		}

		for (const materialName of mesh.materialNames) {
			meshMaterialNames.add(materialName);
		}
	}

	const matchedMaterials = capabilities.materials.filter(
		(material) => meshMaterialNames.has(material.name) || includesAnyTerm(material.name, terms)
	);

	return {
		assetId,
		partQuery,
		matchedPaths,
		matchedMaterialNames: matchedMaterials.map((material) => material.name),
		operations: matchedMaterials.map((material) => ({
			targetType: 'material',
			targetId: material.id,
			targetName: material.name,
			op: 'set_overlay_highlight',
			value: PRIMARY_HIGHLIGHT_FACTOR
		}))
	};
}

export async function planVehicleBodyPaint(
	assetId: VehicleAssetId,
	color: [number, number, number, number]
): Promise<VehicleBodyPaintPlan> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const matchedMaterialNames = inferBodyPaintMaterialNames(capabilities);
	const matchedNameSet = new Set(matchedMaterialNames);

	return {
		assetId,
		color,
		matchedMaterialNames,
		operations: capabilities.materials
			.filter((material) => matchedNameSet.has(material.name))
			.map((material) => ({
				targetType: 'material',
				targetId: material.id,
				targetName: material.name,
				op: 'set_base_color_factor',
				value: color
			}))
	};
}

export async function planVehicleWindowTint(
	assetId: VehicleAssetId,
	resolvedLabel: string,
	color: [number, number, number, number]
): Promise<VehicleWindowTintPlan> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const matchedMaterialNames = inferWindowTintMaterialNames(capabilities);
	const matchedNameSet = new Set(matchedMaterialNames);

	return {
		assetId,
		resolvedLabel,
		color,
		matchedMaterialNames,
		operations: capabilities.materials
			.filter((material) => matchedNameSet.has(material.name))
			.map((material) => ({
				targetType: 'material',
				targetId: material.id,
				targetName: material.name,
				op: 'set_base_color_factor',
				value: color
			}))
	};
}

export async function validateVehicleInspectionPatchManifest(
	patchManifest: VehicleInspectionPatchManifest
): Promise<VehicleInspectionPatchValidationResult> {
	const capabilities = await deriveVehicleInspectionCapabilities(patchManifest.assetId);
	const nodeIds = new Set(capabilities.controlCandidates.map((candidate) => candidate.nodeId));
	const materialIds = new Set(capabilities.materials.map((material) => material.id));
	const debugMeshIds = new Set(
		[...capabilities.wireframeMeshes, ...capabilities.uvDebugMeshes].map((mesh) => mesh.meshId)
	);

	const accepted: VehicleInspectionPatchOperation[] = [];
	const rejected: VehicleInspectionPatchValidationResult['rejected'] = [];

	patchManifest.operations.forEach((operation, index) => {
		const validation = validatePatchOperation(operation, index, nodeIds, materialIds, debugMeshIds);

		if (validation.accepted) {
			accepted.push(validation.accepted);
			return;
		}

		rejected.push({
			index,
			reason: validation.reason ?? 'Unknown patch validation error',
			operation
		});
	});

	return {
		assetId: patchManifest.assetId,
		presetId: patchManifest.presetId,
		userId: patchManifest.userId,
		accepted,
		rejected
	};
}
