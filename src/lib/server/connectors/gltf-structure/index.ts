import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import type { Material, Mesh, Node, Primitive, Scene } from '@gltf-transform/core';
import { type VehicleAssetId } from '$lib/vehicles/catalog';
import { resolveLocalAssetPath } from '$lib/server/connectors/vehicle-registry/storage';
import type {
	StructuralAssetSnapshot,
	StructuralMaterial,
	StructuralMesh,
	StructuralNode,
	StructuralSceneSummary
} from './types';
export type {
	StructuralAssetSnapshot,
	StructuralMaterial,
	StructuralMesh,
	StructuralNode,
	StructuralSceneSummary
} from './types';

type CacheEntry = {
	cacheKey: string;
	snapshot: StructuralAssetSnapshot;
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const structureCache = new Map<VehicleAssetId, CacheEntry>();

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

function collectSceneSummaries(scenes: Scene[]): StructuralSceneSummary[] {
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

function collectMaterialSummaries(materials: Material[]): {
	materials: Array<
		Pick<StructuralMaterial, 'id' | 'name' | 'alphaMode' | 'doubleSided' | 'textureSlots'>
	>;
	materialIds: WeakMap<Material, string>;
} {
	const materialIds = new WeakMap<Material, string>();
	const summaries = materials.map((material, index) => {
		const id = createMaterialId(index);
		materialIds.set(material, id);

		return {
			id,
			name: formatMaterialName(material, index),
			alphaMode: material.getAlphaMode(),
			doubleSided: material.getDoubleSided(),
			textureSlots: collectTextureSlots(material)
		};
	});

	return {
		materials: summaries,
		materialIds
	};
}

function collectMeshSummaries(
	meshes: Mesh[],
	materialIdLookup: WeakMap<Material, string>
): {
	meshes: StructuralMesh[];
	meshIds: WeakMap<Mesh, string>;
} {
	const meshIds = new WeakMap<Mesh, string>();
	const summaries = meshes.map((mesh, index) => {
		const id = createMeshId(index);
		meshIds.set(mesh, id);

		const primitives = mesh.listPrimitives();
		const semantics = new Set<string>();
		const materialIds = new Set<string>();
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
			if (!material) {
				continue;
			}

			materialNames.add(material.getName().trim() || 'Unnamed Material');
			const materialId = materialIdLookup.get(material);
			if (materialId) {
				materialIds.add(materialId);
			}
		}

		return {
			id,
			name: formatMeshName(mesh, index),
			primitiveCount: primitives.length,
			attributeSemantics: Array.from(semantics).sort((left, right) => left.localeCompare(right)),
			materialIds: Array.from(materialIds).sort((left, right) => left.localeCompare(right)),
			materialNames: Array.from(materialNames).sort((left, right) => left.localeCompare(right)),
			hasTexcoord0,
			hasTexcoord1
		};
	});

	return { meshes: summaries, meshIds };
}

function collectNodeSummaries(
	scenes: Scene[],
	meshIds: WeakMap<Mesh, string>
): StructuralNode[] {
	const nodes: StructuralNode[] = [];
	const seenNodes = new Set<Node>();
	const nodeIds = new WeakMap<Node, string>();
	let nextNodeIndex = 0;

	const visitNode = (
		node: Node,
		parentPath: string,
		parentId: string | null,
		index: number,
		parentWorldTranslation: [number, number, number]
	): string => {
		const existingId = nodeIds.get(node);
		if (existingId) {
			return existingId;
		}

		const id = createNodeId(nextNodeIndex);
		nextNodeIndex += 1;
		nodeIds.set(node, id);

		if (seenNodes.has(node)) {
			return id;
		}

		seenNodes.add(node);
		const name = formatNodeName(node, index);
		const path = parentPath ? `${parentPath}/${name}` : name;
		const translation = toVec3(node.getTranslation());
		const bounds = getBounds(node);
		const nodeBounds =
			Number.isFinite(bounds.min[0]) &&
			Number.isFinite(bounds.min[1]) &&
			Number.isFinite(bounds.min[2]) &&
			Number.isFinite(bounds.max[0]) &&
			Number.isFinite(bounds.max[1]) &&
			Number.isFinite(bounds.max[2])
				? {
						min: toVec3(bounds.min),
						max: toVec3(bounds.max),
						center: toVec3([
							(bounds.min[0] + bounds.max[0]) / 2,
							(bounds.min[1] + bounds.max[1]) / 2,
							(bounds.min[2] + bounds.max[2]) / 2
						])
					}
				: undefined;
		const worldTranslation: [number, number, number] = [
			parentWorldTranslation[0] + translation[0],
			parentWorldTranslation[1] + translation[1],
			parentWorldTranslation[2] + translation[2]
		];
		const childIds = node
			.listChildren()
			.map((child, childIndex) => visitNode(child, path, id, childIndex, worldTranslation));

		nodes.push({
			id,
			name,
			path,
			parentId,
			childIds,
			childCount: childIds.length,
			meshId: node.getMesh() ? (meshIds.get(node.getMesh() as Mesh) ?? null) : null,
			bounds: nodeBounds,
			translation,
			worldTranslation,
			rotation: toQuat(node.getRotation()),
			scale: toVec3(node.getScale())
		});

		return id;
	};

	scenes.forEach((scene) => {
		const scenePath = scene.getName().trim();
		scene
			.listChildren()
			.forEach((node, nodeIndex) => visitNode(node, scenePath, null, nodeIndex, [0, 0, 0]));
	});

	return nodes.sort((left, right) => left.path.localeCompare(right.path));
}

function deriveStructuralMaterials(
	materials: Array<
		Pick<StructuralMaterial, 'id' | 'name' | 'alphaMode' | 'doubleSided' | 'textureSlots'>
	>,
	meshes: StructuralMesh[],
	nodes: StructuralNode[]
): StructuralMaterial[] {
	const nodeByMeshId = new Map<string, StructuralNode[]>();

	for (const node of nodes) {
		if (!node.meshId) {
			continue;
		}

		const current = nodeByMeshId.get(node.meshId) ?? [];
		current.push(node);
		nodeByMeshId.set(node.meshId, current);
	}

	return materials.map((material) => {
		const owningMeshes = meshes.filter((mesh) => mesh.materialIds.includes(material.id));
		const owningNodes = owningMeshes.flatMap((mesh) => nodeByMeshId.get(mesh.id) ?? []);

		return {
			...material,
			meshIds: owningMeshes.map((mesh) => mesh.id),
			meshNames: owningMeshes.map((mesh) => mesh.name),
			nodeIds: Array.from(new Set(owningNodes.map((node) => node.id))).sort((left, right) =>
				left.localeCompare(right)
			),
			nodePaths: Array.from(new Set(owningNodes.map((node) => node.path))).sort((left, right) =>
				left.localeCompare(right)
			)
		};
	});
}

async function createCacheKey(assetPath: string): Promise<string> {
	const assetStats = await stat(assetPath);
	return `${assetPath}:${assetStats.size}:${assetStats.mtimeMs}`;
}

async function deriveStructuralVersion(assetPath: string): Promise<string> {
	const assetStats = await stat(assetPath);
	return `structural:${assetStats.size}:${assetStats.mtimeMs}`;
}

export async function deriveStructuralAssetSnapshot(
	assetId: VehicleAssetId
): Promise<StructuralAssetSnapshot> {
	const assetPath = resolveLocalAssetPath(assetId);
	await access(assetPath, constants.R_OK);

	const cacheKey = await createCacheKey(assetPath);
	const cached = structureCache.get(assetId);
	if (cached && cached.cacheKey === cacheKey) {
		return cached.snapshot;
	}

	const document = await io.read(assetPath);
	await document.transform(dedup(), prune());

	const root = document.getRoot();
	const scenes = root.listScenes();
	const { materials, materialIds } = collectMaterialSummaries(root.listMaterials());
	const { meshes, meshIds } = collectMeshSummaries(root.listMeshes(), materialIds);
	const nodes = collectNodeSummaries(scenes, meshIds);
	const snapshot: StructuralAssetSnapshot = {
		assetId,
		assetPath,
		generatedAt: await deriveStructuralVersion(assetPath),
		scenes: collectSceneSummaries(scenes),
		nodes,
		meshes,
		materials: deriveStructuralMaterials(materials, meshes, nodes)
	};

	structureCache.set(assetId, { cacheKey, snapshot });
	return snapshot;
}
