import type {
	VehicleSemanticGroup,
	VehicleSemanticOverlay,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';

export function partMatchesGroup(
	part: VehicleSemanticPartUnit,
	group: VehicleSemanticGroup
): boolean {
	if (group.nodeIds.some((nodeId) => part.nodeIds.includes(nodeId))) {
		return true;
	}

	if (group.materialIds.some((materialId) => part.materialIds.includes(materialId))) {
		return true;
	}

	return false;
}

export type VehicleSemanticOverlayRuntimeIndex = {
	partsById: Map<string, VehicleSemanticPartUnit>;
	partsByNodeId: Map<string, VehicleSemanticPartUnit[]>;
	partsByMaterialId: Map<string, VehicleSemanticPartUnit[]>;
	partsByGroupId: Map<string, VehicleSemanticPartUnit[]>;
	uncoveredNodeIdsByGroupId: Map<string, string[]>;
};

export function buildVehicleSemanticOverlayRuntimeIndex(
	overlay: VehicleSemanticOverlay | null | undefined
): VehicleSemanticOverlayRuntimeIndex {
	const partsById = new Map<string, VehicleSemanticPartUnit>();
	const partsByNodeId = new Map<string, VehicleSemanticPartUnit[]>();
	const partsByMaterialId = new Map<string, VehicleSemanticPartUnit[]>();
	const partsByGroupId = new Map<string, VehicleSemanticPartUnit[]>();
	const uncoveredNodeIdsByGroupId = new Map<string, string[]>();

	if (!overlay) {
		return {
			partsById,
			partsByNodeId,
			partsByMaterialId,
			partsByGroupId,
			uncoveredNodeIdsByGroupId
		};
	}

	for (const part of overlay.acceptedParts) {
		partsById.set(part.id, part);

		for (const nodeId of part.nodeIds) {
			partsByNodeId.set(nodeId, [...(partsByNodeId.get(nodeId) ?? []), part]);
		}

		for (const materialId of part.materialIds) {
			partsByMaterialId.set(materialId, [...(partsByMaterialId.get(materialId) ?? []), part]);
		}
	}

	for (const group of overlay.acceptedGroups) {
		const matchedParts = overlay.acceptedParts
			.filter((part) => partMatchesGroup(part, group))
			.slice()
			.sort((left, right) => right.confidence - left.confidence);
		partsByGroupId.set(group.id, matchedParts);

		const coveredNodeIds = new Set(matchedParts.flatMap((part) => part.nodeIds));
		uncoveredNodeIdsByGroupId.set(
			group.id,
			group.nodeIds.filter((nodeId) => !coveredNodeIds.has(nodeId))
		);
	}

	return {
		partsById,
		partsByNodeId,
		partsByMaterialId,
		partsByGroupId,
		uncoveredNodeIdsByGroupId
	};
}
