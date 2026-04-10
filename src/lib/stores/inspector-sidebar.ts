import { writable } from 'svelte/store';
import type { FooterChatSidebarState } from '$lib/server/connectors/openai-chat/types';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

const INITIAL_STATE: FooterChatSidebarState = {
	active: false,
	cards: []
};
const SIDEBAR_TTL_MS = 10 * 60 * 1000;

type InspectorSidebarStoreState = Partial<Record<VehicleAssetId, FooterChatSidebarState>>;

function sanitizeSidebarState(input: FooterChatSidebarState): FooterChatSidebarState {
	return {
		active: input.active === true,
		cards: Array.isArray(input.cards)
			? input.cards
					.map((card) => ({
						title: card.title.trim(),
						entries: Object.fromEntries(
							Object.entries(card.entries ?? {}).filter(([key, value]) => {
								if (!key.trim()) {
									return false;
								}

								return (
									typeof value === 'string' ||
									typeof value === 'number' ||
									typeof value === 'boolean' ||
									value === null
								);
							})
						)
					}))
					.filter((card) => card.title.length > 0)
			: []
	};
}

function createInspectorSidebarStore() {
	const { subscribe, set } = writable<InspectorSidebarStoreState>({});
	let currentState: InspectorSidebarStoreState = {};
	let updatedAtByAsset: Partial<Record<VehicleAssetId, number>> = {};
	let expiryTimersByAsset: Partial<Record<VehicleAssetId, ReturnType<typeof setTimeout>>> = {};

	function clearExpiryTimer(assetId: VehicleAssetId): void {
		const timer = expiryTimersByAsset[assetId];
		if (timer) {
			clearTimeout(timer);
			delete expiryTimersByAsset[assetId];
		}
	}

	function applyState(assetId: VehicleAssetId, nextState: FooterChatSidebarState): void {
		currentState = {
			...currentState,
			[assetId]: sanitizeSidebarState(nextState)
		};
		set(currentState);
	}

	function scheduleExpiry(assetId: VehicleAssetId): void {
		const assetState = currentState[assetId] ?? INITIAL_STATE;
		clearExpiryTimer(assetId);
		if (!assetState.active || assetState.cards.length === 0) {
			return;
		}

		expiryTimersByAsset[assetId] = setTimeout(() => {
			delete updatedAtByAsset[assetId];
			applyState(assetId, INITIAL_STATE);
		}, SIDEBAR_TTL_MS);
	}

	function isExpired(assetId: VehicleAssetId): boolean {
		const updatedAt = updatedAtByAsset[assetId] ?? 0;
		const assetState = currentState[assetId] ?? INITIAL_STATE;
		if (updatedAt === 0 || !assetState.active || assetState.cards.length === 0) {
			return false;
		}

		return Date.now() - updatedAt >= SIDEBAR_TTL_MS;
	}

	return {
		subscribe,
		set(assetId: VehicleAssetId, state: FooterChatSidebarState): void {
			updatedAtByAsset = {
				...updatedAtByAsset,
				[assetId]: Date.now()
			};
			applyState(assetId, state);
			scheduleExpiry(assetId);
		},
		getContext(assetId?: VehicleAssetId): FooterChatSidebarState {
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

export const inspectorSidebarState = createInspectorSidebarStore();
