import { writable } from 'svelte/store';

export type RequestGateState = {
	visible: boolean;
	requestVariable: string;
	decision: boolean | null;
	dragPosition: number;
	isDragging: boolean;
	isApprovePathActive: boolean;
};

export type RequestGateOpenConfig = {
	requestVariable?: string;
	decision?: boolean | null;
	dragPosition?: number;
	isDragging?: boolean;
	isApprovePathActive?: boolean;
};

const INITIAL_STATE: RequestGateState = {
	visible: false,
	requestVariable: 'request variable',
	decision: null,
	dragPosition: 0,
	isDragging: false,
	isApprovePathActive: false
};

function sanitizeRequestVariable(value: string | undefined): string {
	const normalized = typeof value === 'string' ? value.trim() : '';
	return normalized.length > 0 ? normalized : INITIAL_STATE.requestVariable;
}

function sanitizeDragPosition(value: number | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, value);
}

function createRequestGateStore() {
	const { subscribe, set } = writable<RequestGateState>(INITIAL_STATE);
	let currentState: RequestGateState = INITIAL_STATE;
	let pendingResolver: ((approved: boolean) => void) | null = null;

	function apply(nextState: RequestGateState): void {
		currentState = nextState;
		set(currentState);
	}

	function merge(patch: Partial<RequestGateState>): void {
		apply({
			...currentState,
			...patch
		});
	}

	function settlePending(approved: boolean): void {
		const resolver = pendingResolver;
		pendingResolver = null;
		resolver?.(approved);
	}

	return {
		subscribe,
		open(config: RequestGateOpenConfig = {}): void {
			settlePending(false);
			const dragPosition = sanitizeDragPosition(config.dragPosition);
			const decision = config.decision ?? null;
			const isApprovePathActive =
				config.isApprovePathActive ?? (decision === true || dragPosition > 0);

			apply({
				visible: true,
				requestVariable: sanitizeRequestVariable(config.requestVariable),
				decision,
				dragPosition,
				isDragging: config.isDragging === true,
				isApprovePathActive
			});
		},
		requestApproval(config: RequestGateOpenConfig = {}): Promise<boolean> {
			this.open(config);
			return new Promise<boolean>((resolve) => {
				pendingResolver = resolve;
			});
		},
		close(): void {
			merge({ visible: false });
		},
		setRequestVariable(requestVariable: string): void {
			merge({ requestVariable: sanitizeRequestVariable(requestVariable) });
		},
		beginInteraction(): void {
			merge({ isDragging: true });
		},
		updateDragPosition(dragPosition: number): void {
			const nextDragPosition = sanitizeDragPosition(dragPosition);
			merge({
				dragPosition: nextDragPosition,
				isApprovePathActive: nextDragPosition > 0 || currentState.decision === true
			});
		},
		resolveApproved(dragPosition: number): void {
			merge({
				decision: true,
				dragPosition: sanitizeDragPosition(dragPosition),
				isDragging: false,
				isApprovePathActive: true
			});
			settlePending(true);
		},
		resolveRejected(): void {
			merge({
				decision: false,
				dragPosition: 0,
				isDragging: false,
				isApprovePathActive: false
			});
			settlePending(false);
		},
		resetInteraction(): void {
			merge({
				decision: null,
				dragPosition: 0,
				isDragging: false,
				isApprovePathActive: false
			});
		},
		endInteraction(): void {
			merge({ isDragging: false });
		},
		getSnapshot(): RequestGateState {
			return currentState;
		},
		reset(): void {
			settlePending(false);
			apply(INITIAL_STATE);
		}
	};
}

export const requestGate = createRequestGateStore();
