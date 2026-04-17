import { writable } from 'svelte/store';
import type { FooterChatTrace } from '$lib/server/connectors/openai-chat/types';

export type FooterActiveToolState = {
	active: boolean;
	label: string;
	toolName: string | null;
	toolLabels: string[];
	toolNames: string[];
	route: FooterChatTrace['route'] | null;
	planningMode: NonNullable<FooterChatTrace['planningMode']> | null;
	toolRoundsUsed: number | null;
};

const INITIAL_STATE: FooterActiveToolState = {
	active: false,
	label: '',
	toolName: null,
	toolLabels: [],
	toolNames: [],
	route: null,
	planningMode: null,
	toolRoundsUsed: null
};

const ACTIVE_TOOL_TTL_MS = 4 * 1000;
const ACTIVE_TOOL_WINDOW_SIZE = 6;

function formatToolLabel(toolName: string): string {
	return `${toolName}(...)`;
}

function buildToolSequence(toolCalls: string[]): { toolNames: string[]; toolLabels: string[] } {
	const toolNames = toolCalls
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.slice(-ACTIVE_TOOL_WINDOW_SIZE);

	return {
		toolNames,
		toolLabels: toolNames.map((toolName) => formatToolLabel(toolName))
	};
}

function createFooterActiveToolStore() {
	const { subscribe, set } = writable<FooterActiveToolState>(INITIAL_STATE);
	let currentState: FooterActiveToolState = INITIAL_STATE;
	let expiryTimer: ReturnType<typeof setTimeout> | null = null;

	function clearExpiryTimer(): void {
		if (!expiryTimer) {
			return;
		}

		clearTimeout(expiryTimer);
		expiryTimer = null;
	}

	function applyState(nextState: FooterActiveToolState): void {
		currentState = nextState;
		set(currentState);
	}

	function scheduleExpiry(): void {
		clearExpiryTimer();
		if (!currentState.active) {
			return;
		}

		expiryTimer = setTimeout(() => {
			applyState(INITIAL_STATE);
		}, ACTIVE_TOOL_TTL_MS);
	}

	return {
		subscribe,
		setFromToolCalls(toolCalls: string[]): void {
			const toolSequence = buildToolSequence(toolCalls);
			const toolName = toolSequence.toolNames[toolSequence.toolNames.length - 1] ?? null;
			if (!toolName) {
				clearExpiryTimer();
				applyState(INITIAL_STATE);
				return;
			}

			applyState({
				active: true,
				label: formatToolLabel(toolName),
				toolName,
				toolLabels: toolSequence.toolLabels,
				toolNames: toolSequence.toolNames,
				route: null,
				planningMode: null,
				toolRoundsUsed: null
			});
			scheduleExpiry();
		},
		setFromTrace(trace: FooterChatTrace | undefined): void {
			if (!trace) {
				clearExpiryTimer();
				applyState(INITIAL_STATE);
				return;
			}

			const toolSequence = buildToolSequence(trace.toolCalls);
			const toolName = toolSequence.toolNames[toolSequence.toolNames.length - 1] ?? null;
			const route = trace.route ?? null;
			const planningMode = trace.planningMode ?? null;
			const toolRoundsUsed =
				typeof trace.toolRoundsUsed === 'number' && Number.isFinite(trace.toolRoundsUsed)
					? trace.toolRoundsUsed
					: null;
			const label =
				toolName ? formatToolLabel(toolName) : [route, planningMode].filter(Boolean).join(' / ');

			if (!label) {
				clearExpiryTimer();
				applyState(INITIAL_STATE);
				return;
			}

			applyState({
				active: true,
				label,
				toolName,
				toolLabels: toolSequence.toolLabels,
				toolNames: toolSequence.toolNames,
				route,
				planningMode,
				toolRoundsUsed
			});
			scheduleExpiry();
		},
		reset(): void {
			clearExpiryTimer();
			applyState(INITIAL_STATE);
		},
		getSnapshot(): FooterActiveToolState {
			return currentState;
		}
	};
}

export const footerActiveTool = createFooterActiveToolStore();
