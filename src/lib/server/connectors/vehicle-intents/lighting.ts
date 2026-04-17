import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	readVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';
import type {
	VehicleSemanticMaterialSuggestion,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import { LIGHTING_SCOPE_CONFIG, type LightingSemanticCategory } from './constants';

export function isLightingMaterialEligible(
	category: LightingSemanticCategory,
	semanticMaterial: VehicleSemanticMaterialSuggestion | undefined,
	supportingParts: VehicleSemanticPartUnit[],
	trustUserNodeCoverage = false
): boolean {
	if (trustUserNodeCoverage) {
		return true;
	}

	if (supportingParts.length > 0) {
		return true;
	}

	if (category === 'front_lighting') {
		return (
			semanticMaterial?.semanticTags.includes('left_headlight') === true ||
			semanticMaterial?.semanticTags.includes('right_headlight') === true
		);
	}

	return false;
}

export function resolveLightingCategories(requestText: string): LightingSemanticCategory[] {
	const includesFront = LIGHTING_SCOPE_CONFIG.front_lighting.includePattern.test(requestText);
	const includesRear = LIGHTING_SCOPE_CONFIG.rear_lighting.includePattern.test(requestText);
	const excludesFront = LIGHTING_SCOPE_CONFIG.front_lighting.excludePattern.test(requestText);
	const excludesRear = LIGHTING_SCOPE_CONFIG.rear_lighting.excludePattern.test(requestText);
	const mentionsGenericLights = /\blights?\b/i.test(requestText);
	const includesFrontLighting = includesFront && !excludesFront;
	const includesRearLighting = includesRear && !excludesRear;

	const includedCategories = new Set<LightingSemanticCategory>();
	if (includesFrontLighting) {
		includedCategories.add('front_lighting');
	}
	if (includesRearLighting) {
		includedCategories.add('rear_lighting');
	}
	if (mentionsGenericLights && !includesFrontLighting && !includesRearLighting) {
		if (excludesFront && !excludesRear) {
			includedCategories.add('rear_lighting');
		} else if (excludesRear && !excludesFront) {
			includedCategories.add('front_lighting');
		} else if (!excludesFront && !excludesRear) {
			includedCategories.add('front_lighting');
			includedCategories.add('rear_lighting');
		}
	}
	if (excludesFront) {
		includedCategories.delete('front_lighting');
	}
	if (excludesRear) {
		includedCategories.delete('rear_lighting');
	}

	return Array.from(includedCategories);
}

export async function resolveSemanticLightingEdits(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>,
	requestText: string,
	disable: boolean
): Promise<SharedVehicleInspectionPatchOperation[]> {
	const requestedCategories = resolveLightingCategories(requestText);
	if (requestedCategories.length === 0) {
		return [];
	}

	const overlay = await readVehicleSemanticOverlay(capabilities.assetId);
	if (!overlay) {
		return [];
	}

	const semanticMaterialsById = new Map(
		overlay.acceptedMaterials.map((material) => [material.targetId, material])
	);
	const structure = await deriveStructuralAssetSnapshot(capabilities.assetId);
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));
	const operationsByMaterialId = new Map<string, SharedVehicleInspectionPatchOperation>();

	for (const category of requestedCategories) {
		const groups = overlay.acceptedGroups.filter((group) => group.category === category);
		if (groups.length === 0) {
			continue;
		}

		for (const group of groups) {
			const derivedGroupMaterialIds =
				group.materialIds.length > 0
					? group.materialIds
					: Array.from(
							new Set(
								group.nodeIds.flatMap((nodeId) => {
									const meshId = nodeById.get(nodeId)?.meshId;
									return meshId ? (meshById.get(meshId)?.materialIds ?? []) : [];
								})
							)
						).sort((left, right) => left.localeCompare(right));
			const supportingParts = overlay.acceptedParts.filter(
				(part) =>
					part.category === 'light' &&
					(category === 'front_lighting' ? part.region === 'front' : part.region === 'rear') &&
					(part.nodeIds.some((nodeId) => group.nodeIds.includes(nodeId)) ||
						part.meshIds.some((meshId) => group.meshIds.includes(meshId)) ||
						part.materialIds.some(
							(materialId) =>
								group.materialIds.includes(materialId) ||
								derivedGroupMaterialIds.includes(materialId)
						))
			);
			const partBackedMaterialIds = Array.from(
				new Set(supportingParts.flatMap((part) => part.materialIds))
			).sort((left, right) => left.localeCompare(right));
			const materialIds =
				partBackedMaterialIds.length > 0 ? partBackedMaterialIds : derivedGroupMaterialIds;
			const trustUserNodeCoverage =
				group.author === 'user' && group.materialIds.length === 0 && materialIds.length > 0;

			for (const materialId of materialIds) {
				const material = capabilities.materials.find((candidate) => candidate.id === materialId);
				if (!material) {
					continue;
				}
				const materialSupportingParts = supportingParts.filter((part) =>
					part.materialIds.includes(material.id)
				);

				if (
					!isLightingMaterialEligible(
						category,
						semanticMaterialsById.get(material.id),
						materialSupportingParts,
						trustUserNodeCoverage
					)
				) {
					continue;
				}

				operationsByMaterialId.set(material.id, {
					targetType: 'material',
					targetId: material.id,
					targetName: material.name,
					op: 'set_emissive_factor',
					value: disable ? [0, 0, 0] : LIGHTING_SCOPE_CONFIG[category].enableValue
				});
			}
		}
	}

	return Array.from(operationsByMaterialId.values()).sort((left, right) =>
		left.targetId.localeCompare(right.targetId)
	);
}
