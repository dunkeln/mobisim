import { writable } from 'svelte/store';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type VehiclePresentationState = {
	highlightOperations: VehicleInspectionPatchOperation[];
	materialOperations: VehicleInspectionPatchOperation[];
	nodeVisibilityOperations: VehicleInspectionPatchOperation[];
	nodeTransformOperations: VehicleInspectionPatchOperation[];
	viewerOperations: VehicleInspectionPatchOperation[];
};

export type VehiclePresentationHistoryEntry = {
	presentation: VehiclePresentationState;
	intentLabel: string | null;
};

type VehiclePatchState = {
	assetId: VehicleAssetId | null;
	presentation: VehiclePresentationState;
	intentLabel: string | null;
	operations: VehicleInspectionPatchOperation[];
	past: VehiclePresentationHistoryEntry[];
	future: VehiclePresentationHistoryEntry[];
	canUndo: boolean;
	canRedo: boolean;
	revision: number;
};

const EMPTY_PRESENTATION_STATE: VehiclePresentationState = {
	highlightOperations: [],
	materialOperations: [],
	nodeVisibilityOperations: [],
	nodeTransformOperations: [],
	viewerOperations: []
};

const INITIAL_STATE: VehiclePatchState = {
	assetId: null,
	presentation: EMPTY_PRESENTATION_STATE,
	intentLabel: null,
	operations: [],
	past: [],
	future: [],
	canUndo: false,
	canRedo: false,
	revision: 0
};

function isHighlightOperation(operation: VehicleInspectionPatchOperation): boolean {
	return operation.targetType === 'material' && operation.op === 'set_overlay_highlight';
}

function stripHighlightOperations(
	presentation: VehiclePresentationState
): VehiclePresentationState {
	return {
		...presentation,
		highlightOperations: []
	};
}

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

function clonePresentation(presentation: VehiclePresentationState): VehiclePresentationState {
	return {
		highlightOperations: [...presentation.highlightOperations],
		materialOperations: [...presentation.materialOperations],
		nodeVisibilityOperations: [...presentation.nodeVisibilityOperations],
		nodeTransformOperations: [...presentation.nodeTransformOperations],
		viewerOperations: [...presentation.viewerOperations]
	};
}

function deriveOperations(presentation: VehiclePresentationState): VehicleInspectionPatchOperation[] {
	return [
		...presentation.nodeVisibilityOperations,
		...presentation.nodeTransformOperations,
		...presentation.materialOperations,
		...presentation.viewerOperations,
		...presentation.highlightOperations
	];
}

function mergePresentationOperations(
	current: VehiclePresentationState,
	incoming: VehicleInspectionPatchOperation[]
): VehiclePresentationState {
	const nextHighlights = incoming.filter((operation) => isHighlightOperation(operation));
	const nextMaterialOperations = incoming.filter(
		(operation) => operation.targetType === 'material' && !isHighlightOperation(operation)
	);
	const nextNodeVisibilityOperations = incoming.filter(
		(operation) => operation.targetType === 'node' && operation.op === 'set_visibility'
	);
	const nextNodeTransformOperations = incoming.filter(
		(operation) =>
			operation.targetType === 'node' &&
			(operation.op === 'set_translation' ||
				operation.op === 'set_rotation' ||
				operation.op === 'set_scale')
	);
	const nextViewerOperations = incoming.filter((operation) => operation.targetType === 'viewer');

	return {
		highlightOperations:
			nextHighlights.length > 0
				? mergeOperations([], nextHighlights)
				: current.highlightOperations,
		materialOperations: mergeOperations(current.materialOperations, nextMaterialOperations),
		nodeVisibilityOperations: mergeOperations(
			current.nodeVisibilityOperations,
			nextNodeVisibilityOperations
		),
		nodeTransformOperations: mergeOperations(
			current.nodeTransformOperations,
			nextNodeTransformOperations
		),
		viewerOperations: mergeOperations(current.viewerOperations, nextViewerOperations)
	};
}

function isPresentationEqual(
	left: VehiclePresentationState,
	right: VehiclePresentationState
): boolean {
	const toKeys = (operations: VehicleInspectionPatchOperation[]) =>
		operations.map((operation) => `${getOperationKey(operation)}:${JSON.stringify(operation.value)}`);

	return (
		JSON.stringify(toKeys(left.highlightOperations)) === JSON.stringify(toKeys(right.highlightOperations)) &&
		JSON.stringify(toKeys(left.materialOperations)) === JSON.stringify(toKeys(right.materialOperations)) &&
		JSON.stringify(toKeys(left.nodeVisibilityOperations)) ===
			JSON.stringify(toKeys(right.nodeVisibilityOperations)) &&
		JSON.stringify(toKeys(left.nodeTransformOperations)) ===
			JSON.stringify(toKeys(right.nodeTransformOperations)) &&
		JSON.stringify(toKeys(left.viewerOperations)) === JSON.stringify(toKeys(right.viewerOperations))
	);
}

function withDerivedState(
	assetId: VehicleAssetId | null,
	presentation: VehiclePresentationState,
	intentLabel: string | null,
	past: VehiclePresentationHistoryEntry[],
	future: VehiclePresentationHistoryEntry[],
	revision: number
): VehiclePatchState {
	return {
		assetId,
		presentation,
		intentLabel,
		operations: deriveOperations(presentation),
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
		queue(
			assetId: VehicleAssetId,
			operations: VehicleInspectionPatchOperation[],
			intentLabel?: string
		): void {
			if (operations.length === 0) {
				return;
			}

			update((state) => {
				const basePresentation =
					state.assetId === assetId ? state.presentation : clonePresentation(EMPTY_PRESENTATION_STATE);
				const baseIntentLabel = state.assetId === assetId ? state.intentLabel : null;
				const nextPresentation = mergePresentationOperations(basePresentation, operations);
				if (state.assetId === assetId && isPresentationEqual(basePresentation, nextPresentation)) {
					return state;
				}

				const nextPast = state.assetId === assetId
					? [
							...state.past,
							{
								presentation: clonePresentation(basePresentation),
								intentLabel: baseIntentLabel
							}
						]
					: [];
				return withDerivedState(
					assetId,
					nextPresentation,
					intentLabel?.trim() || null,
					nextPast,
					[],
					state.revision + 1
				);
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
				const previousEntry = state.past[state.past.length - 1];
				const nextFuture = [
					{
						presentation: clonePresentation(state.presentation),
						intentLabel: state.intentLabel
					},
					...state.future
				];
				return withDerivedState(
					state.assetId,
					previousEntry
						? clonePresentation(previousEntry.presentation)
						: clonePresentation(EMPTY_PRESENTATION_STATE),
					previousEntry?.intentLabel ?? null,
					nextPast,
					nextFuture,
					state.revision + 1
				);
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
				const redoneEntry = state.future[0];
				const nextFuture = state.future.slice(1);
				const nextPast = [
					...state.past,
					{
						presentation: clonePresentation(state.presentation),
						intentLabel: state.intentLabel
					}
				];
				return withDerivedState(
					state.assetId,
					redoneEntry
						? clonePresentation(redoneEntry.presentation)
						: clonePresentation(EMPTY_PRESENTATION_STATE),
					redoneEntry?.intentLabel ?? null,
					nextPast,
					nextFuture,
					state.revision + 1
				);
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
				return withDerivedState(
					assetId ?? null,
					clonePresentation(EMPTY_PRESENTATION_STATE),
					null,
					[],
					[],
					state.revision + 1
				);
			});

			return didReset;
		},
		clearHighlights(assetId?: VehicleAssetId): boolean {
			let didClear = false;

			update((state) => {
				if (assetId && state.assetId !== assetId) {
					return state;
				}

				if (state.presentation.highlightOperations.length === 0) {
					return state;
				}

				didClear = true;
				const nextPresentation = stripHighlightOperations(state.presentation);
				return withDerivedState(
					state.assetId,
					nextPresentation,
					'clear highlights',
					[
						...state.past,
						{
							presentation: clonePresentation(state.presentation),
							intentLabel: state.intentLabel
						}
					],
					[],
					state.revision + 1
				);
			});

			return didClear;
		}
	};
}

export const vehiclePatchState = createVehiclePatchStore();
