import type {
	VehicleSemanticGroup,
	VehicleSemanticOverlayRuntimeIndex,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';

export type HighlightTargetRef = {
	targetId: string;
	targetType: 'node' | 'material';
};

function dedupeHighlightTargets(targets: HighlightTargetRef[]): HighlightTargetRef[] {
	return Array.from(
		new Map(targets.map((target) => [`${target.targetType}:${target.targetId}`, target])).values()
	);
}

export function buildHighlightTargetsForPart(part: VehicleSemanticPartUnit): HighlightTargetRef[] {
	return dedupeHighlightTargets([
		...part.materialIds.map((targetId) => ({ targetId, targetType: 'material' as const })),
		...part.nodeIds.map((targetId) => ({ targetId, targetType: 'node' as const }))
	]);
}

function buildNodeOnlyHighlightTargetsForPart(part: VehicleSemanticPartUnit): HighlightTargetRef[] {
	return dedupeHighlightTargets(
		part.nodeIds.map((targetId) => ({ targetId, targetType: 'node' as const }))
	);
}

export function buildHighlightTargetsForGroup(
	group: VehicleSemanticGroup,
	runtimeIndex: VehicleSemanticOverlayRuntimeIndex
): HighlightTargetRef[] {
	const matchedParts = runtimeIndex.partsByGroupId.get(group.id) ?? [];

	return dedupeHighlightTargets([
		...group.materialIds.map((targetId) => ({ targetId, targetType: 'material' as const })),
		...group.nodeIds.map((targetId) => ({ targetId, targetType: 'node' as const })),
		...matchedParts.flatMap((part) => buildNodeOnlyHighlightTargetsForPart(part))
	]);
}
