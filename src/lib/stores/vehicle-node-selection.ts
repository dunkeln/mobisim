import { writable } from 'svelte/store';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type VehicleSelectionTarget = {
	assetId: VehicleAssetId;
	targetType?: 'part' | 'node';
	targetId?: string;
	targetName?: string;
	nodeIds?: string[];
	anchorNodeId?: string;
	nodeId: string;
	nodeName: string;
	nodePath: string;
	materialIndex?: number;
	materialName?: string;
};

export type VehicleNodeSelection = VehicleSelectionTarget;

export function getSelectionKey(selection: VehicleSelectionTarget): string {
	return [
		selection.assetId,
		selection.targetType ?? 'node',
		selection.targetId ?? selection.nodeId
	].join('|');
}

export function getSelectionPrimaryNodeId(selection: VehicleSelectionTarget): string {
	return (
		selection.anchorNodeId ??
		selection.nodeId ??
		selection.nodeIds?.[0] ??
		selection.targetId
	);
}

export function selectionContainsNodeId(
	selection: VehicleSelectionTarget,
	nodeId: string
): boolean {
	return (selection.nodeIds ?? [selection.nodeId]).includes(nodeId);
}

function createVehicleNodeSelectionStore() {
	const { subscribe, update } = writable<VehicleSelectionTarget[]>([]);

	return {
		subscribe,
		select(selection: VehicleSelectionTarget, additive = false): void {
			update((current) => {
				const scoped = current.filter((entry) => entry.assetId === selection.assetId);
				const otherAssets = current.filter((entry) => entry.assetId !== selection.assetId);
				const selectionKey = getSelectionKey(selection);
				const existing = scoped.find((entry) => getSelectionKey(entry) === selectionKey);

				if (additive) {
					return [
						...otherAssets,
						...scoped.filter((entry) => getSelectionKey(entry) !== selectionKey),
						selection
					];
				}

				if (existing) {
					return [
						...otherAssets,
						...scoped.filter((entry) => getSelectionKey(entry) !== selectionKey)
					];
				}

				return [...otherAssets, selection];
			});
		},
		clear(assetId?: VehicleAssetId): void {
			update((current) => {
				if (current.length === 0) {
					return current;
				}

				if (assetId) {
					return current.filter((entry) => entry.assetId !== assetId);
				}

				return [];
			});
		},
		replace(assetId: VehicleAssetId, selections: VehicleNodeSelection[]): void {
			update((current) => {
				const otherAssets = current.filter((entry) => entry.assetId !== assetId);
				const scopedSelections = selections.filter((entry) => entry.assetId === assetId);
				return [...otherAssets, ...scopedSelections];
			});
		}
	};
}

export const vehicleNodeSelection = createVehicleNodeSelectionStore();
