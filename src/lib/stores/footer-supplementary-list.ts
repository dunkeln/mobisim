import { writable } from 'svelte/store';
import type { FooterChatSupplementaryListState } from '$lib/server/connectors/openai-chat/types';

const INITIAL_STATE: FooterChatSupplementaryListState = {
	active: false,
	items: []
};

const SUPPLEMENTARY_LIST_TTL_MS = 10 * 60 * 1000;

function sanitizeState(input: FooterChatSupplementaryListState): FooterChatSupplementaryListState {
	return {
		active: input.active === true,
		items: Array.isArray(input.items)
			? input.items
					.map((item) => (typeof item === 'string' ? item.trim() : ''))
					.filter((item) => item.length > 0)
					.slice(0, 6)
			: []
	};
}

function createFooterSupplementaryListStore() {
	const { subscribe, set } = writable<FooterChatSupplementaryListState>(INITIAL_STATE);
	let currentState: FooterChatSupplementaryListState = INITIAL_STATE;
	let updatedAt = 0;
	let expiryTimer: ReturnType<typeof setTimeout> | null = null;

	function clearExpiryTimer(): void {
		if (!expiryTimer) {
			return;
		}

		clearTimeout(expiryTimer);
		expiryTimer = null;
	}

	function applyState(nextState: FooterChatSupplementaryListState): void {
		currentState = sanitizeState(nextState);
		set(currentState);
	}

	function scheduleExpiry(): void {
		clearExpiryTimer();
		if (!currentState.active || currentState.items.length === 0) {
			return;
		}

		expiryTimer = setTimeout(() => {
			updatedAt = 0;
			applyState(INITIAL_STATE);
		}, SUPPLEMENTARY_LIST_TTL_MS);
	}

	function isExpired(): boolean {
		if (updatedAt === 0 || !currentState.active || currentState.items.length === 0) {
			return false;
		}

		return Date.now() - updatedAt >= SUPPLEMENTARY_LIST_TTL_MS;
	}

	return {
		subscribe,
		set(state: FooterChatSupplementaryListState): void {
			updatedAt = Date.now();
			applyState(state);
			scheduleExpiry();
		},
		getContext(): FooterChatSupplementaryListState {
			if (isExpired()) {
				clearExpiryTimer();
				updatedAt = 0;
				applyState(INITIAL_STATE);
			}

			return currentState;
		},
		reset(): void {
			clearExpiryTimer();
			updatedAt = 0;
			applyState(INITIAL_STATE);
		}
	};
}

export const footerSupplementaryList = createFooterSupplementaryListStore();
