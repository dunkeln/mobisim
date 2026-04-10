import * as THREE from 'three';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleInspectionMaterialSummary } from '$lib/server/connectors/gltf-preprocess/types';
import { buildRuntimeNodePath } from './runtime-selection';

export type RuntimeMaterialTarget = {
	node: THREE.Object3D;
	material: THREE.Material;
	materialIndex?: number;
};

function listNodeMaterials(node: THREE.Object3D): THREE.Material[] {
	if (!(node instanceof THREE.Mesh)) {
		return [];
	}

	return Array.isArray(node.material) ? node.material : [node.material];
}

function buildRuntimeNodePathLookup(scene: THREE.Object3D): Map<string, THREE.Object3D[]> {
	const nodesByPath = new Map<string, THREE.Object3D[]>();

	scene.traverse((node) => {
		if (node === scene) {
			return;
		}

		const path = buildRuntimeNodePath(node, scene);
		nodesByPath.set(path, [...(nodesByPath.get(path) ?? []), node]);
	});

	return nodesByPath;
}

export function resolveRuntimeMaterialTargets(
	scene: THREE.Object3D,
	operation: VehicleInspectionPatchOperation,
	materialSummaryById: Map<string, VehicleInspectionMaterialSummary>
): RuntimeMaterialTarget[] {
	if (operation.targetType !== 'material') {
		return [];
	}

	const summary = materialSummaryById.get(operation.targetId);
	const targetName = summary?.name ?? operation.targetName;
	if (!targetName) {
		return [];
	}

	const results = new Map<string, RuntimeMaterialTarget>();

	const appendNamedMaterialTargets = (node: THREE.Object3D): void => {
		if (!(node instanceof THREE.Mesh)) {
			return;
		}

		listNodeMaterials(node).forEach((material, index) => {
			if (material.name !== targetName) {
				return;
			}

			results.set(`${node.uuid}:${index}:${material.uuid}`, {
				node,
				material,
				materialIndex: Array.isArray(node.material) ? index : undefined
			});
		});
	};

	if (summary) {
		const nodesByPath = buildRuntimeNodePathLookup(scene);
		const candidateNodes = Array.from(
			new Set(summary.nodePaths.flatMap((nodePath) => nodesByPath.get(nodePath) ?? []))
		);

		for (const node of candidateNodes) {
			if (!(node instanceof THREE.Mesh) || !Array.isArray(node.material)) {
				continue;
			}

			const matchingSlots = summary.meshMaterialSlots.flatMap((entry) => entry.slotIndices);

			if (matchingSlots.length === 0) {
				continue;
			}

			for (const slotIndex of matchingSlots) {
				const material = node.material[slotIndex];
				if (!material) {
					continue;
				}

				results.set(`${node.uuid}:${slotIndex}:${material.uuid}`, {
					node,
					material,
					materialIndex: slotIndex
				});
			}
		}

		if (results.size > 0) {
			return Array.from(results.values());
		}

		candidateNodes.forEach(appendNamedMaterialTargets);
		if (results.size > 0) {
			return Array.from(results.values());
		}

		// If the structural scope is known but the runtime material name does not line up,
		// prefer failing closed or using an unambiguous single-material mesh over scanning
		// the whole scene by name and lighting the wrong region.
		for (const node of candidateNodes) {
			if (!(node instanceof THREE.Mesh)) {
				continue;
			}

			const materials = listNodeMaterials(node);
			if (materials.length !== 1) {
				continue;
			}

			const material = materials[0];
			if (!material) {
				continue;
			}

			results.set(`${node.uuid}:single:${material.uuid}`, {
				node,
				material,
				materialIndex: undefined
			});
		}

		if (results.size > 0) {
			return Array.from(results.values());
		}
	}

	scene.traverse((node) => {
		appendNamedMaterialTargets(node);
	});

	return Array.from(results.values());
}
