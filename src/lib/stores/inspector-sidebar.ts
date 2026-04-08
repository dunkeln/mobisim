import { writable } from 'svelte/store';
import type { FooterChatSidebarState } from '$lib/server/connectors/openai-chat/types';

const INITIAL_STATE: FooterChatSidebarState = {
	active: false,
	cards: []
};
const SIDEBAR_TTL_MS = 10 * 60 * 1000;

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
	const { subscribe, set } = writable<FooterChatSidebarState>(INITIAL_STATE);
	let currentState: FooterChatSidebarState = INITIAL_STATE;
	let updatedAt = 0;
	let expiryTimer: ReturnType<typeof setTimeout> | null = null;

	function clearExpiryTimer(): void {
		if (expiryTimer) {
			clearTimeout(expiryTimer);
			expiryTimer = null;
		}
	}

	function applyState(nextState: FooterChatSidebarState): void {
		currentState = sanitizeSidebarState(nextState);
		set(currentState);
	}

	function scheduleExpiry(): void {
		clearExpiryTimer();
		if (!currentState.active || currentState.cards.length === 0) {
			return;
		}

		expiryTimer = setTimeout(() => {
			updatedAt = 0;
			applyState(INITIAL_STATE);
		}, SIDEBAR_TTL_MS);
	}

	function isExpired(): boolean {
		if (updatedAt === 0 || !currentState.active || currentState.cards.length === 0) {
			return false;
		}

		return Date.now() - updatedAt >= SIDEBAR_TTL_MS;
	}

	return {
		subscribe,
		set(state: FooterChatSidebarState): void {
			updatedAt = Date.now();
			applyState(state);
			scheduleExpiry();
		},
		getContext(): FooterChatSidebarState {
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

export const inspectorSidebarState = createInspectorSidebarStore();
