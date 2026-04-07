import { writable } from 'svelte/store';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type VehicleNodeSelection = {
	assetId: VehicleAssetId;
	nodeId: string;
	nodeName: string;
	nodePath: string;
};

function createVehicleNodeSelectionStore() {
	const { subscribe, set, update } = writable<VehicleNodeSelection | null>(null);

	return {
		subscribe,
		select(selection: VehicleNodeSelection): void {
			set(selection);
		},
		clear(assetId?: VehicleAssetId): void {
			update((current) => {
				if (!current) {
					return null;
				}

				if (assetId && current.assetId !== assetId) {
					return current;
				}

				return null;
			});
		}
	};
}

export const vehicleNodeSelection = createVehicleNodeSelectionStore();
