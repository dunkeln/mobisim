import type {
	VehicleSemanticGroup,
	VehicleSemanticOverlay,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import {
	getSelectionConstraintNodeIds,
	type VehicleNodeSelection
} from '$lib/stores/vehicle-node-selection';

export function partMatchesGroup(
	part: VehicleSemanticPartUnit,
	group: VehicleSemanticGroup
): boolean {
	return group.nodeIds.some((nodeId) => part.nodeIds.includes(nodeId));
}

export type VehicleSemanticOverlayRuntimeIndex = {
	partsById: Map<string, VehicleSemanticPartUnit>;
	partsByNodeId: Map<string, VehicleSemanticPartUnit[]>;
	partsByMaterialId: Map<string, VehicleSemanticPartUnit[]>;
	partsByGroupId: Map<string, VehicleSemanticPartUnit[]>;
	uncoveredNodeIdsByGroupId: Map<string, string[]>;
};

export type SemanticGroupSelectionDiff = {
	groupId: string;
	groupLabel: string;
	coveredSelections: VehicleNodeSelection[];
	candidateSelections: VehicleNodeSelection[];
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

function getSelectionNodeIds(selection: VehicleNodeSelection): string[] {
	return getSelectionConstraintNodeIds(selection);
}

export function getSemanticGroupCoveredNodeIds(
	overlay: VehicleSemanticOverlay | null | undefined,
	groupId: string
): Set<string> {
	const coveredNodeIds = new Set<string>();
	if (!overlay) {
		return coveredNodeIds;
	}

	const group = overlay.acceptedGroups.find((entry) => entry.id === groupId);
	if (!group) {
		return coveredNodeIds;
	}

	for (const nodeId of group.nodeIds) {
		coveredNodeIds.add(nodeId);
	}

	const runtimeIndex = buildVehicleSemanticOverlayRuntimeIndex(overlay);
	for (const part of runtimeIndex.partsByGroupId.get(groupId) ?? []) {
		for (const nodeId of part.nodeIds) {
			coveredNodeIds.add(nodeId);
		}
	}

	return coveredNodeIds;
}

export function diffSelectionAgainstSemanticGroup(
	overlay: VehicleSemanticOverlay | null | undefined,
	groupId: string | null | undefined,
	selectedNodes: VehicleNodeSelection[]
): SemanticGroupSelectionDiff | null {
	if (!overlay || !groupId || selectedNodes.length === 0) {
		return null;
	}

	const group = overlay.acceptedGroups.find((entry) => entry.id === groupId);
	if (!group) {
		return null;
	}

	const coveredNodeIds = getSemanticGroupCoveredNodeIds(overlay, groupId);
	const coveredSelections: VehicleNodeSelection[] = [];
	const candidateSelections: VehicleNodeSelection[] = [];

	for (const selection of selectedNodes) {
		const selectionNodeIds = getSelectionNodeIds(selection);
		const isCovered =
			selectionNodeIds.length > 0 &&
			selectionNodeIds.every((nodeId) => coveredNodeIds.has(nodeId));
		if (isCovered) {
			coveredSelections.push(selection);
			continue;
		}

		candidateSelections.push(selection);
	}

	return {
		groupId: group.id,
		groupLabel: group.humanLabel,
		coveredSelections,
		candidateSelections
	};
}
