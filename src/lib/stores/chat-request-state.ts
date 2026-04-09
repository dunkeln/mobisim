import { writable } from 'svelte/store';

type ChatRequestState = {
	pending: boolean;
};

const INITIAL_STATE: ChatRequestState = {
	pending: false
};

function createChatRequestStateStore() {
	const { subscribe, set } = writable<ChatRequestState>(INITIAL_STATE);

	return {
		subscribe,
		setPending(pending: boolean): void {
			set({ pending });
		},
		reset(): void {
			set(INITIAL_STATE);
		}
	};
}

export const chatRequestState = createChatRequestStateStore();
