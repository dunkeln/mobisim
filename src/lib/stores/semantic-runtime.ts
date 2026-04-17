import { writable } from 'svelte/store';
import type {
	VehicleSemanticOverlaySnapshot,
	VehicleSemanticOverlay,
	VehicleSemanticOverlayStatus,
	type VehicleSemanticGroup
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type SemanticRuntimeAssetState = {
	overlay: VehicleSemanticOverlay | null;
	overlayStatus: VehicleSemanticOverlayStatus;
	overlayRevision: number | null;
	selectedGroupId: string | null;
};

type SemanticRuntimeState = {
	byAsset: Partial<Record<VehicleAssetId, SemanticRuntimeAssetState>>;
};

export type SemanticRuntimeAssetPatch = {
	overlaySnapshot?: VehicleSemanticOverlaySnapshot;
	overlayStatus?: VehicleSemanticOverlayStatus;
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
		overlayStatus: state?.overlayStatus ?? 'unknown',
		overlayRevision: state?.overlayRevision ?? null,
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

	const currentOverlay = current.overlay;
	if (!currentOverlay) {
		return true;
	}

	const incomingGeneratedAt = Date.parse(incoming.overlay.generatedAt);
	const currentGeneratedAt = Date.parse(currentOverlay.generatedAt);
	if (Number.isFinite(incomingGeneratedAt) && Number.isFinite(currentGeneratedAt)) {
		if (incomingGeneratedAt > currentGeneratedAt) {
			return true;
		}

		if (incomingGeneratedAt < currentGeneratedAt) {
			return false;
		}
	}

	const incomingRevision = incoming.overlayRevision ?? incoming.overlay.revision;
	const currentRevision = currentOverlay.revision ?? null;
	if (currentRevision === null) {
		return true;
	}

	if (incomingRevision === null) {
		return false;
	}

	return incomingRevision >= currentRevision;
}

function mergeUniqueValues(values: string[], incoming: string[]): string[] {
	return Array.from(new Set([...values, ...incoming]));
}

function mergeSemanticGroup(
	current: VehicleSemanticGroup,
	incoming: VehicleSemanticGroup
): VehicleSemanticGroup {
	const preferred = incoming.confidence >= current.confidence ? incoming : current;
	return {
		...preferred,
		aliases: mergeUniqueValues(current.aliases, incoming.aliases),
		supports: Array.from(new Set([...current.supports, ...incoming.supports])),
		nodeIds: mergeUniqueValues(current.nodeIds, incoming.nodeIds),
		meshIds: mergeUniqueValues(current.meshIds, incoming.meshIds),
		materialIds: mergeUniqueValues(current.materialIds, incoming.materialIds)
	};
}

function sanitizeOverlayForRuntime(
	overlay: VehicleSemanticOverlay | null
): VehicleSemanticOverlay | null {
	if (!overlay) {
		return null;
	}

	const groupsById = new Map<string, VehicleSemanticGroup>();
	for (const group of overlay.acceptedGroups) {
		const existing = groupsById.get(group.id);
		groupsById.set(group.id, existing ? mergeSemanticGroup(existing, group) : group);
	}

	return {
		...overlay,
		acceptedGroups: Array.from(groupsById.values())
	};
}

function normalizeSelectedGroupId(
	selectedGroupId: string | null,
	overlay: VehicleSemanticOverlay | null
): string | null {
	if (!selectedGroupId || !overlay) {
		return selectedGroupId;
	}

	return overlay.acceptedGroups.some((group) => group.id === selectedGroupId)
		? selectedGroupId
		: null;
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
					overlay: overlaySnapshot
						? sanitizeOverlayForRuntime(overlaySnapshot.overlay)
						: currentAssetState.overlay,
					overlayStatus:
						patch.overlayStatus ??
						(overlaySnapshot ? overlaySnapshot.overlayStatus : currentAssetState.overlayStatus),
					overlayRevision:
						overlaySnapshot
							? overlaySnapshot.overlayRevision ?? overlaySnapshot.overlay?.revision ?? null
							: currentAssetState.overlayRevision,
					selectedGroupId:
						patch.selectedGroupId !== undefined
							? patch.selectedGroupId
							: currentAssetState.selectedGroupId
				};
				nextAssetState.selectedGroupId = normalizeSelectedGroupId(
					nextAssetState.selectedGroupId,
					nextAssetState.overlay
				);

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
