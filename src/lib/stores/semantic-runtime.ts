import { writable } from 'svelte/store';
import type { SemanticIngressBinding } from '$lib/server/connectors/semantic-ingress/types';
import type {
	VehicleSemanticOverlaySnapshot,
	VehicleSemanticOverlay,
	VehicleSemanticOverlayStatus
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type SemanticRuntimeAssetState = {
	overlay: VehicleSemanticOverlay | null;
	overlayRevision: number | null;
	overlayStatus: VehicleSemanticOverlayStatus;
	ingressBindings: SemanticIngressBinding[];
	selectedGroupId: string | null;
};

type SemanticRuntimeState = {
	byAsset: Partial<Record<VehicleAssetId, SemanticRuntimeAssetState>>;
};

export type SemanticRuntimeAssetPatch = {
	overlaySnapshot?: VehicleSemanticOverlaySnapshot;
	overlayStatus?: VehicleSemanticOverlayStatus;
	ingressBindings?: SemanticIngressBinding[];
	selectedGroupId?: string | null;
};

const INITIAL_STATE: SemanticRuntimeState = {
	byAsset: {}
};

function cloneAssetState(
	state: Partial<SemanticRuntimeAssetState> | undefined
): SemanticRuntimeAssetState {
	return {
		overlay: state?.overlay ?? null,
		overlayRevision:
			typeof state?.overlayRevision === 'number' ? state.overlayRevision : state?.overlay?.revision ?? null,
		overlayStatus: state?.overlayStatus ?? 'unknown',
		ingressBindings: [...(state?.ingressBindings ?? [])],
		selectedGroupId: state?.selectedGroupId ?? null
	};
}

function shouldApplyOverlaySnapshot(
	current: SemanticRuntimeAssetState,
	incoming: VehicleSemanticOverlaySnapshot
): boolean {
	if (incoming.overlay === null) {
		return true;
	}

	const incomingRevision = incoming.overlayRevision ?? incoming.overlay.revision;
	const currentRevision = current.overlayRevision ?? current.overlay?.revision ?? null;
	if (currentRevision === null) {
		return true;
	}

	if (incomingRevision === null) {
		return false;
	}

	return incomingRevision >= currentRevision;
}

function createSemanticRuntimeStore() {
	const { subscribe, update } = writable<SemanticRuntimeState>(INITIAL_STATE);
	let currentState = INITIAL_STATE;

	function apply(nextState: SemanticRuntimeState): SemanticRuntimeState {
		currentState = nextState;
		return nextState;
	}

	return {
		subscribe,
		getAssetState(assetId: VehicleAssetId): SemanticRuntimeAssetState {
			return cloneAssetState(currentState.byAsset[assetId]);
		},
		applyAssetState(assetId: VehicleAssetId, patch: SemanticRuntimeAssetPatch): void {
			update((state) => {
				const currentAssetState = cloneAssetState(state.byAsset[assetId]);
				const overlaySnapshot = patch.overlaySnapshot;
				if (overlaySnapshot && !shouldApplyOverlaySnapshot(currentAssetState, overlaySnapshot)) {
					return state;
				}

				const nextAssetState: SemanticRuntimeAssetState = {
					...currentAssetState,
					overlay: overlaySnapshot ? overlaySnapshot.overlay : currentAssetState.overlay,
					overlayRevision: overlaySnapshot
						? overlaySnapshot.overlayRevision ?? overlaySnapshot.overlay?.revision ?? null
						: currentAssetState.overlayRevision,
					overlayStatus:
						patch.overlayStatus ??
						(overlaySnapshot ? overlaySnapshot.overlayStatus : currentAssetState.overlayStatus),
					ingressBindings:
						patch.ingressBindings !== undefined
							? [...patch.ingressBindings]
							: currentAssetState.ingressBindings,
					selectedGroupId:
						patch.selectedGroupId !== undefined
							? patch.selectedGroupId
							: currentAssetState.selectedGroupId
				};

				return apply({
					byAsset: {
						...state.byAsset,
						[assetId]: nextAssetState
					}
				});
			});
		},
		resetAsset(assetId: VehicleAssetId): void {
			update((state) =>
				apply({
					byAsset: {
						...state.byAsset,
						[assetId]: cloneAssetState(undefined)
					}
				})
			);
		},
		reset(): void {
			update(() => apply(INITIAL_STATE));
		}
	};
}

export const semanticRuntimeState = createSemanticRuntimeStore();
