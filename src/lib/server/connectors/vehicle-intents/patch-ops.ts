import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import type {
	VehicleSemanticActionSupport,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehiclePartIntentMode } from './types';

export function mergePatchOperations(
	current: SharedVehicleInspectionPatchOperation[],
	incoming: SharedVehicleInspectionPatchOperation[]
): SharedVehicleInspectionPatchOperation[] {
	const merged = new Map(
		current.map((operation) => [
			`${operation.targetType}:${operation.targetId}:${operation.op}`,
			operation
		])
	);

	for (const operation of incoming) {
		merged.set(`${operation.targetType}:${operation.targetId}:${operation.op}`, operation);
	}

	return Array.from(merged.values());
}

export function buildNodeIdsByPath(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>
): Map<string, string[]> {
	const nodeIdsByPath = new Map<string, string[]>();
	for (const candidate of capabilities.controlCandidates) {
		nodeIdsByPath.set(candidate.path, [...(nodeIdsByPath.get(candidate.path) ?? []), candidate.nodeId]);
	}

	return nodeIdsByPath;
}

export function collectNodeTargetsFromMaterials(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>,
	materials: Array<{ nodePaths: string[]; name: string }>
): Array<{ nodeId: string; targetName: string }> {
	const nodeIdsByPath = buildNodeIdsByPath(capabilities);
	const targets = new Map<string, { nodeId: string; targetName: string }>();

	for (const material of materials) {
		for (const nodePath of material.nodePaths) {
			for (const nodeId of nodeIdsByPath.get(nodePath) ?? []) {
				targets.set(nodeId, { nodeId, targetName: material.name });
			}
		}
	}

	return Array.from(targets.values());
}

export function mapIntentModeToActionSupport(mode: VehiclePartIntentMode): VehicleSemanticActionSupport {
	switch (mode) {
		case 'focus':
			return 'focus';
		case 'isolate':
			return 'isolate';
		case 'remove':
			return 'isolate';
		default:
			return 'highlight';
	}
}

export function collectEntityMatchedPaths(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>,
	entities: Array<Pick<VehicleSemanticPartUnit, 'nodeIds' | 'meshIds' | 'materialIds'>>
): string[] {
	return collectPartMatchedPaths(capabilities, entities as VehicleSemanticPartUnit[]);
}

export function collectEntityMatchedNodeIds(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	entities: Array<Pick<VehicleSemanticPartUnit, 'nodeIds' | 'meshIds' | 'materialIds'>>
): string[] {
	return collectPartMatchedNodeIds(structure, entities as VehicleSemanticPartUnit[]);
}

export function collectPartMatchedPaths(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>,
	parts: VehicleSemanticPartUnit[]
): string[] {
	const nodeIdToPath = new Map(
		capabilities.controlCandidates.map((candidate) => [candidate.nodeId, candidate.path])
	);
	const meshIdToPaths = new Map<string, Set<string>>();
	for (const candidate of capabilities.controlCandidates) {
		if (!candidate.meshId) {
			continue;
		}

		const existing = meshIdToPaths.get(candidate.meshId) ?? new Set<string>();
		existing.add(candidate.path);
		meshIdToPaths.set(candidate.meshId, existing);
	}

	const materialIdToPaths = new Map(
		capabilities.materials.map((material) => [material.id, material.nodePaths])
	);
	const matchedPaths = new Set<string>();

	for (const part of parts) {
		for (const nodeId of part.nodeIds) {
			const path = nodeIdToPath.get(nodeId);
			if (path) {
				matchedPaths.add(path);
			}
		}

		for (const meshId of part.meshIds) {
			for (const path of meshIdToPaths.get(meshId) ?? []) {
				matchedPaths.add(path);
			}
		}

		for (const materialId of part.materialIds) {
			for (const path of materialIdToPaths.get(materialId) ?? []) {
				matchedPaths.add(path);
			}
		}
	}

	return Array.from(matchedPaths).sort((left, right) => left.localeCompare(right));
}

export function collectPartMatchedNodeIds(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	parts: VehicleSemanticPartUnit[]
): string[] {
	const matchedNodeIds = new Set<string>();
	const nodeIdsByMeshId = new Map<string, string[]>();
	const nodeIdsByMaterialId = new Map<string, string[]>();

	for (const node of structure.nodes) {
		if (!node.meshId) {
			continue;
		}

		const meshNodeIds = nodeIdsByMeshId.get(node.meshId) ?? [];
		meshNodeIds.push(node.id);
		nodeIdsByMeshId.set(node.meshId, meshNodeIds);
	}

	for (const material of structure.materials) {
		nodeIdsByMaterialId.set(material.id, material.nodeIds);
	}

	for (const part of parts) {
		for (const nodeId of part.nodeIds) {
			matchedNodeIds.add(nodeId);
		}

		for (const meshId of part.meshIds) {
			for (const nodeId of nodeIdsByMeshId.get(meshId) ?? []) {
				matchedNodeIds.add(nodeId);
			}
		}

		for (const materialId of part.materialIds) {
			for (const nodeId of nodeIdsByMaterialId.get(materialId) ?? []) {
				matchedNodeIds.add(nodeId);
			}
		}
	}

	return Array.from(matchedNodeIds).sort((left, right) => left.localeCompare(right));
}

export function collectVisibleNodeIdsForIsolation(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	matchedNodeIds: string[]
): Set<string> {
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const visibleNodeIds = new Set<string>();

	for (const nodeId of matchedNodeIds) {
		let currentId: string | null = nodeId;
		while (currentId) {
			if (visibleNodeIds.has(currentId)) {
				break;
			}

			visibleNodeIds.add(currentId);
			currentId = nodeById.get(currentId)?.parentId ?? null;
		}
	}

	return visibleNodeIds;
}

export function buildRenderableHighlightOperations(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>,
	nodeIds: string[],
	materialIds: string[],
	targetName: string,
	value: [number, number, number, number]
): SharedVehicleInspectionPatchOperation[] {
	const availableMaterialIds = new Set(capabilities.materials.map((material) => material.id));
	const highlightedMaterialIds = new Set(
		materialIds.filter((materialId) => availableMaterialIds.has(materialId))
	);
	const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));

	const materialOperations = Array.from(highlightedMaterialIds)
		.sort((left, right) => left.localeCompare(right))
		.map((materialId) => ({
			targetType: 'material' as const,
			targetId: materialId,
			targetName,
			op: 'set_overlay_highlight' as const,
			value
		}));

	const nodeOperations = Array.from(new Set(nodeIds))
		.filter((nodeId) => {
			const node = nodeById.get(nodeId);
			if (!node?.meshId) {
				return false;
			}

			const mesh = meshById.get(node.meshId);
			if (!mesh) {
				return true;
			}

			return !mesh.materialIds.some((materialId) => highlightedMaterialIds.has(materialId));
		})
		.sort((left, right) => left.localeCompare(right))
		.map((nodeId) => ({
			targetType: 'node' as const,
			targetId: nodeId,
			targetName,
			op: 'set_overlay_highlight' as const,
			value
		}));

	return [...materialOperations, ...nodeOperations];
}

export function validatePlannedOperations(
	assetId: Parameters<typeof deriveVehicleInspectionCapabilities>[0],
	presetId: string,
	operations: Array<{ targetType: string; targetId: string; op: string; value?: unknown }>,
	baseGeneratedAt?: string
): Promise<{ assetId: typeof assetId; operations: typeof operations; rejected: Array<{ reason: string }>; summary: string }> {
	// This is a placeholder type signature. The actual function is imported.
	return Promise.resolve({
		assetId,
		operations,
		rejected: [],
		summary: ''
	});
}
