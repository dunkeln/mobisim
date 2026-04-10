import { writable } from 'svelte/store';
import type { FooterChatSupplementaryListState } from '$lib/server/connectors/openai-chat/types';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

const INITIAL_STATE: FooterChatSupplementaryListState = {
	active: false,
	entries: {}
};

const SUPPLEMENTARY_LIST_TTL_MS = 10 * 60 * 1000;

type FooterSupplementaryListStoreState = Partial<
	Record<VehicleAssetId, FooterChatSupplementaryListState>
>;

function sanitizeState(input: FooterChatSupplementaryListState): FooterChatSupplementaryListState {
	return {
		active: input.active === true,
		entries: Object.fromEntries(
			Object.entries(input.entries ?? {})
				.map(([key, value]) => [
					typeof key === 'string' ? key.trim() : '',
					typeof value === 'string' ? value.trim() : ''
				])
				.filter(([key, value]) => key.length > 0 && value.length > 0)
				.slice(0, 6)
		)
	};
}

function createFooterSupplementaryListStore() {
	const { subscribe, set } = writable<FooterSupplementaryListStoreState>({});
	let currentState: FooterSupplementaryListStoreState = {};
	let updatedAtByAsset: Partial<Record<VehicleAssetId, number>> = {};
	let expiryTimersByAsset: Partial<Record<VehicleAssetId, ReturnType<typeof setTimeout>>> = {};

	function clearExpiryTimer(assetId: VehicleAssetId): void {
		const timer = expiryTimersByAsset[assetId];
		if (!timer) {
			return;
		}

		clearTimeout(timer);
		delete expiryTimersByAsset[assetId];
	}

	function applyState(assetId: VehicleAssetId, nextState: FooterChatSupplementaryListState): void {
		currentState = {
			...currentState,
			[assetId]: sanitizeState(nextState)
		};
		set(currentState);
	}

	function scheduleExpiry(assetId: VehicleAssetId): void {
		const assetState = currentState[assetId] ?? INITIAL_STATE;
		clearExpiryTimer(assetId);
		if (!assetState.active || Object.keys(assetState.entries).length === 0) {
			return;
		}

		expiryTimersByAsset[assetId] = setTimeout(() => {
			delete updatedAtByAsset[assetId];
			applyState(assetId, INITIAL_STATE);
		}, SUPPLEMENTARY_LIST_TTL_MS);
	}

	function isExpired(assetId: VehicleAssetId): boolean {
		const updatedAt = updatedAtByAsset[assetId] ?? 0;
		const assetState = currentState[assetId] ?? INITIAL_STATE;
		if (updatedAt === 0 || !assetState.active || Object.keys(assetState.entries).length === 0) {
			return false;
		}

		return Date.now() - updatedAt >= SUPPLEMENTARY_LIST_TTL_MS;
	}

	return {
		subscribe,
		set(assetId: VehicleAssetId, state: FooterChatSupplementaryListState): void {
			updatedAtByAsset = {
				...updatedAtByAsset,
				[assetId]: Date.now()
			};
			applyState(assetId, state);
			scheduleExpiry(assetId);
		},
		getContext(assetId?: VehicleAssetId): FooterChatSupplementaryListState {
			if (!assetId) {
				return INITIAL_STATE;
			}

			if (isExpired(assetId)) {
				clearExpiryTimer(assetId);
				delete updatedAtByAsset[assetId];
				applyState(assetId, INITIAL_STATE);
			}

			return currentState[assetId] ?? INITIAL_STATE;
		},
		reset(assetId?: VehicleAssetId): void {
			if (assetId) {
				clearExpiryTimer(assetId);
				delete updatedAtByAsset[assetId];
				applyState(assetId, INITIAL_STATE);
				return;
			}

			for (const scopedAssetId of Object.keys(expiryTimersByAsset) as VehicleAssetId[]) {
				clearExpiryTimer(scopedAssetId);
			}
			updatedAtByAsset = {};
			currentState = {};
			set(currentState);
		}
	};
}

export const footerSupplementaryList = createFooterSupplementaryListStore();
