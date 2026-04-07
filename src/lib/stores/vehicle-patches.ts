import { writable } from 'svelte/store';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

type VehiclePatchState = {
	assetId: VehicleAssetId | null;
	operations: VehicleInspectionPatchOperation[];
	past: VehicleInspectionPatchOperation[][];
	future: VehicleInspectionPatchOperation[][];
	canUndo: boolean;
	canRedo: boolean;
	revision: number;
};

const INITIAL_STATE: VehiclePatchState = {
	assetId: null,
	operations: [],
	past: [],
	future: [],
	canUndo: false,
	canRedo: false,
	revision: 0
};

function getOperationKey(operation: VehicleInspectionPatchOperation): string {
	return `${operation.targetType}:${operation.targetId}:${operation.op}`;
}

function mergeOperations(
	current: VehicleInspectionPatchOperation[],
	incoming: VehicleInspectionPatchOperation[]
): VehicleInspectionPatchOperation[] {
	const merged = new Map(current.map((operation) => [getOperationKey(operation), operation]));

	for (const operation of incoming) {
		merged.set(getOperationKey(operation), operation);
	}

	return Array.from(merged.values());
}

function deriveOperations(
	batches: VehicleInspectionPatchOperation[][]
): VehicleInspectionPatchOperation[] {
	return batches.reduce<VehicleInspectionPatchOperation[]>(
		(accumulator, batch) => mergeOperations(accumulator, batch),
		[]
	);
}

function withDerivedState(
	assetId: VehicleAssetId | null,
	past: VehicleInspectionPatchOperation[][],
	future: VehicleInspectionPatchOperation[][],
	revision: number
): VehiclePatchState {
	return {
		assetId,
		operations: deriveOperations(past),
		past,
		future,
		canUndo: past.length > 0,
		canRedo: future.length > 0,
		revision
	};
}

function createVehiclePatchStore() {
	const { subscribe, update } = writable<VehiclePatchState>(INITIAL_STATE);

	return {
		subscribe,
		queue(assetId: VehicleAssetId, operations: VehicleInspectionPatchOperation[]): void {
			if (operations.length === 0) {
				return;
			}

			update((state) => {
				const nextPast = state.assetId === assetId ? [...state.past, operations] : [operations];
				return withDerivedState(assetId, nextPast, [], state.revision + 1);
			});
		},
		undo(assetId?: VehicleAssetId): boolean {
			let didUndo = false;

			update((state) => {
				if (state.past.length === 0 || (assetId && state.assetId !== assetId)) {
					return state;
				}

				didUndo = true;
				const nextPast = state.past.slice(0, -1);
				const undoneBatch = state.past[state.past.length - 1];
				const nextFuture = undoneBatch ? [undoneBatch, ...state.future] : state.future;
				return withDerivedState(state.assetId, nextPast, nextFuture, state.revision + 1);
			});

			return didUndo;
		},
		redo(assetId?: VehicleAssetId): boolean {
			let didRedo = false;

			update((state) => {
				if (state.future.length === 0 || (assetId && state.assetId !== assetId)) {
					return state;
				}

				didRedo = true;
				const redoneBatch = state.future[0];
				const nextFuture = state.future.slice(1);
				const nextPast = redoneBatch ? [...state.past, redoneBatch] : state.past;
				return withDerivedState(state.assetId, nextPast, nextFuture, state.revision + 1);
			});

			return didRedo;
		},
		reset(assetId?: VehicleAssetId): boolean {
			let didReset = false;

			update((state) => {
				if (assetId && state.assetId !== assetId) {
					return state;
				}

				if (state.past.length === 0 && state.future.length === 0 && state.operations.length === 0) {
					return state;
				}

				didReset = true;
				return withDerivedState(assetId ?? null, [], [], state.revision + 1);
			});

			return didReset;
		}
	};
}

export const vehiclePatchState = createVehiclePatchStore();
