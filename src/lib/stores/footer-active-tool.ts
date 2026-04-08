import { writable } from 'svelte/store';

export type FooterActiveToolState = {
	active: boolean;
	label: string;
	toolName: string | null;
	toolLabels: string[];
	toolNames: string[];
};

const INITIAL_STATE: FooterActiveToolState = {
	active: false,
	label: '',
	toolName: null,
	toolLabels: [],
	toolNames: []
};

const ACTIVE_TOOL_TTL_MS = 20 * 1000;

const TOOL_LABELS: Record<string, string> = {
	apply_vehicle_appearance_intent: 'Appearance',
	apply_vehicle_focus_intent: 'Focus',
	set_vehicle_view_mode: 'View Mode',
	get_vehicle_tool_catalog: 'Tool Catalog',
	restore_vehicle_presentation: 'Presentation',
	expand_vehicle_selection: 'Selection',
	annotate_vehicle_semantic_group: 'Semantic Group',
	mutate_vehicle_semantic_assignment: 'Semantic Assignment',
	manage_vehicle_semantic_group: 'Semantic Group',
	refresh_vehicle_semantics: 'Semantic Refresh',
	set_intent_sidebar: 'Intent Sidebar',
	assign_semantic_ingress: 'Semantic Ingress'
};

const TOOL_PRIORITY = [
	'apply_vehicle_appearance_intent',
	'apply_vehicle_focus_intent',
	'restore_vehicle_presentation',
	'set_vehicle_view_mode',
	'expand_vehicle_selection',
	'annotate_vehicle_semantic_group',
	'mutate_vehicle_semantic_assignment',
	'manage_vehicle_semantic_group',
	'refresh_vehicle_semantics',
	'set_intent_sidebar',
	'assign_semantic_ingress',
	'get_vehicle_tool_catalog'
] as const;

function pickActiveToolName(toolCalls: string[]): string | null {
	const normalized = toolCalls
		.map((toolName) => toolName.trim())
		.filter((toolName) => toolName.length > 0);

	if (normalized.length === 0) {
		return null;
	}

	for (const toolName of TOOL_PRIORITY) {
		if (normalized.includes(toolName)) {
			return toolName;
		}
	}

	return normalized[normalized.length - 1] ?? null;
}

function formatToolLabel(toolName: string): string {
	return TOOL_LABELS[toolName] ?? toolName.replaceAll('_', ' ');
}

function buildToolSequence(toolCalls: string[]): { toolNames: string[]; toolLabels: string[] } {
	const toolNames: string[] = [];

	for (const toolName of toolCalls.map((value) => value.trim()).filter((value) => value.length > 0)) {
		if (!toolNames.includes(toolName)) {
			toolNames.push(toolName);
		}
	}

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
			const toolName = pickActiveToolName(toolCalls);
			if (!toolName) {
				clearExpiryTimer();
				applyState(INITIAL_STATE);
				return;
			}

			const toolSequence = buildToolSequence(toolCalls);
			applyState({
				active: true,
				label: formatToolLabel(toolName),
				toolName,
				toolLabels: toolSequence.toolLabels,
				toolNames: toolSequence.toolNames
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
