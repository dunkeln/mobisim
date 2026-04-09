import { writable } from 'svelte/store';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type VehicleNodeSelection = {
	assetId: VehicleAssetId;
	nodeId: string;
	nodeName: string;
	nodePath: string;
	materialIndex?: number;
	materialName?: string;
};

function getSelectionKey(selection: VehicleNodeSelection): string {
	return [
		selection.assetId,
		selection.nodeId,
		typeof selection.materialIndex === 'number' ? `slot:${selection.materialIndex}` : 'slot:none',
		selection.materialName?.trim() ? `material:${selection.materialName.trim()}` : 'material:none'
	].join('|');
}

function getNodeSelectionKey(selection: VehicleNodeSelection): string {
	return [selection.assetId, selection.nodeId].join('|');
}

function createVehicleNodeSelectionStore() {
	const { subscribe, set, update } = writable<VehicleNodeSelection[]>([]);

	return {
		subscribe,
		select(selection: VehicleNodeSelection, additive = false): void {
			update((current) => {
				const scoped = current.filter((entry) => entry.assetId === selection.assetId);
				const otherAssets = current.filter((entry) => entry.assetId !== selection.assetId);
				const selectionKey = getSelectionKey(selection);
				const existing = scoped.find((entry) => getSelectionKey(entry) === selectionKey);

				if (additive) {
					const nodeSelectionKey = getNodeSelectionKey(selection);
					const scopedWithoutNode = scoped.filter(
						(entry) => getNodeSelectionKey(entry) !== nodeSelectionKey
					);
					return [...otherAssets, ...scopedWithoutNode, selection];
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
