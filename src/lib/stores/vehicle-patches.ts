import { writable } from 'svelte/store';
import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { FooterChatPresentationRestore } from '$lib/server/connectors/openai-chat/types';

export type VehiclePresentationState = {
	highlightOperations: VehicleInspectionPatchOperation[];
	materialOperations: VehicleInspectionPatchOperation[];
	nodeVisibilityOperations: VehicleInspectionPatchOperation[];
	viewerOperations: VehicleInspectionPatchOperation[];
};

type VehiclePresentationChangeEntry =
	| {
			kind: 'operations';
			intentLabel: string | null;
			operations: VehicleInspectionPatchOperation[];
	  }
	| {
			kind: 'set_highlights';
			intentLabel: string | null;
			operations: VehicleInspectionPatchOperation[];
	  }
	| {
			kind: 'clear_highlights';
			intentLabel: string | null;
	  }
	| {
			kind: 'clear_highlight_targets';
			intentLabel: string | null;
			targetIds: string[];
	  }
	| {
			kind: 'restore';
			intentLabel: string | null;
			restore: FooterChatPresentationRestore;
	  };

type VehiclePatchState = {
	assetId: VehicleAssetId | null;
	presentation: VehiclePresentationState;
	intentLabel: string | null;
	operations: VehicleInspectionPatchOperation[];
	past: VehiclePresentationChangeEntry[];
	future: VehiclePresentationChangeEntry[];
	canUndo: boolean;
	canRedo: boolean;
	revision: number;
};

const EMPTY_PRESENTATION_STATE: VehiclePresentationState = {
	highlightOperations: [],
	materialOperations: [],
	nodeVisibilityOperations: [],
	viewerOperations: []
};

const INITIAL_STATE: VehiclePatchState = {
	assetId: null,
	presentation: EMPTY_PRESENTATION_STATE,
	intentLabel: null,
	operations: [],
	past: [],
	future: [],
	canUndo: false,
	canRedo: false,
	revision: 0
};

function isHighlightOperation(operation: VehicleInspectionPatchOperation): boolean {
	return operation.targetType === 'material' && operation.op === 'set_overlay_highlight';
}

function stripHighlightOperations(presentation: VehiclePresentationState): VehiclePresentationState {
	return {
		...presentation,
		highlightOperations: []
	};
}

function stripHighlightTargets(
	presentation: VehiclePresentationState,
	targetIds: string[]
): VehiclePresentationState {
	if (targetIds.length === 0) {
		return presentation;
	}

	const removedTargets = new Set(targetIds);
	return {
		...presentation,
		highlightOperations: presentation.highlightOperations.filter(
			(operation) => !removedTargets.has(operation.targetId)
		)
	};
}

function getOperationKey(operation: VehicleInspectionPatchOperation): string {
	return `${operation.targetType}:${operation.targetId}:${operation.op}`;
}

function mergeOperations(
	current: VehicleInspectionPatchOperation[],
	incoming: VehicleInspectionPatchOperation[]
): VehicleInspectionPatchOperation[] {
	const merged = new Map(current.map((operation) => [getOperationKey(operation), operation]));

	for (const operation of incoming) {
		merged.set(getOperationKey(operation), operation);
	}

	return Array.from(merged.values());
}

function clonePresentation(presentation: VehiclePresentationState): VehiclePresentationState {
	return {
		highlightOperations: [...presentation.highlightOperations],
		materialOperations: [...presentation.materialOperations],
		nodeVisibilityOperations: [...presentation.nodeVisibilityOperations],
		viewerOperations: [...presentation.viewerOperations]
	};
}

function deriveOperations(presentation: VehiclePresentationState): VehicleInspectionPatchOperation[] {
	return [
		...presentation.nodeVisibilityOperations,
		...presentation.materialOperations,
		...presentation.viewerOperations,
		...presentation.highlightOperations
	];
}

function mergePresentationOperations(
	current: VehiclePresentationState,
	incoming: VehicleInspectionPatchOperation[]
): VehiclePresentationState {
	const nextHighlights = incoming.filter((operation) => isHighlightOperation(operation));
	const nextMaterialOperations = incoming.filter(
		(operation) => operation.targetType === 'material' && !isHighlightOperation(operation)
	);
	const nextNodeVisibilityOperations = incoming.filter(
		(operation) => operation.targetType === 'node' && operation.op === 'set_visibility'
	);
	const nextViewerOperations = incoming.filter((operation) => operation.targetType === 'viewer');

	return {
		highlightOperations:
			nextHighlights.length > 0
				? mergeOperations(current.highlightOperations, nextHighlights)
				: current.highlightOperations,
		materialOperations: mergeOperations(current.materialOperations, nextMaterialOperations),
		nodeVisibilityOperations: mergeOperations(
			current.nodeVisibilityOperations,
			nextNodeVisibilityOperations
		),
		viewerOperations: mergeOperations(current.viewerOperations, nextViewerOperations)
	};
}

function applyRestore(
	presentation: VehiclePresentationState,
	restore: FooterChatPresentationRestore
): VehiclePresentationState {
	if (restore.restoreAll) {
		return clonePresentation(EMPTY_PRESENTATION_STATE);
	}

	const nextPresentation = clonePresentation(presentation);
	const highlightedTargetIds = new Set(restore.highlightedTargetIds ?? []);
	const materialTargetIds = new Set(restore.materialTargetIds ?? []);
	const hiddenTargetIds = new Set(restore.hiddenTargetIds ?? []);
	const viewerModes = new Set(restore.viewerModes ?? []);

	nextPresentation.highlightOperations = nextPresentation.highlightOperations.filter(
		(operation) => !highlightedTargetIds.has(operation.targetId)
	);
	nextPresentation.materialOperations = nextPresentation.materialOperations.filter(
		(operation) => !materialTargetIds.has(operation.targetId)
	);
	nextPresentation.nodeVisibilityOperations = nextPresentation.nodeVisibilityOperations.filter(
		(operation) => !hiddenTargetIds.has(operation.targetId)
	);
	nextPresentation.viewerOperations = nextPresentation.viewerOperations.filter(
		(operation) =>
			!viewerModes.has(operation.targetId as 'wireframe' | 'xray' | 'uv_debug' | 'postprocess')
	);

	return nextPresentation;
}

function applyChange(
	presentation: VehiclePresentationState,
	change: VehiclePresentationChangeEntry
): VehiclePresentationState {
	if (change.kind === 'operations') {
		return mergePresentationOperations(presentation, change.operations);
	}

	if (change.kind === 'set_highlights') {
		return {
			...presentation,
			highlightOperations: mergeOperations([], change.operations.filter((operation) => isHighlightOperation(operation)))
		};
	}

	if (change.kind === 'clear_highlights') {
		return stripHighlightOperations(presentation);
	}

	if (change.kind === 'clear_highlight_targets') {
		return stripHighlightTargets(presentation, change.targetIds);
	}

	return applyRestore(presentation, change.restore);
}

function rebuildPresentation(changes: VehiclePresentationChangeEntry[]): VehiclePresentationState {
	return changes.reduce(
		(presentation, change) => applyChange(presentation, change),
		clonePresentation(EMPTY_PRESENTATION_STATE)
	);
}

function buildState(
	assetId: VehicleAssetId | null,
	past: VehiclePresentationChangeEntry[],
	future: VehiclePresentationChangeEntry[],
	revision: number
): VehiclePatchState {
	const presentation = rebuildPresentation(past);
	const intentLabel = past[past.length - 1]?.intentLabel ?? null;

	return {
		assetId,
		presentation,
		intentLabel,
		operations: deriveOperations(presentation),
		past,
		future,
		canUndo: past.length > 0,
		canRedo: future.length > 0,
		revision
	};
}

function tokenizeQuery(input: string): string[] {
	return input
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 1);
}

function getChangeSearchText(change: VehiclePresentationChangeEntry): string {
	const label = change.intentLabel ?? '';

	if (change.kind === 'operations') {
		const opTerms = change.operations.flatMap((operation) => [
			operation.targetId,
			operation.targetName ?? '',
			operation.op,
			operation.targetType
		]);
		const categoryTerms = change.operations.flatMap((operation) => {
			if (
				operation.targetType === 'material' &&
				(operation.op === 'set_base_color_factor' ||
					operation.op === 'set_metalness_factor' ||
					operation.op === 'set_roughness_factor' ||
					operation.op === 'set_env_map_intensity')
			) {
				return ['color', 'paint', 'appearance', 'finish', 'material'];
			}

			if (operation.targetType === 'material' && operation.op === 'set_alpha') {
				return ['remove', 'hide', 'visibility', 'alpha'];
			}

			if (operation.targetType === 'material' && operation.op === 'set_overlay_highlight') {
				return ['highlight', 'focus', 'glow'];
			}

			if (operation.targetType === 'node' && operation.op === 'set_visibility') {
				return ['visibility', operation.value === false ? 'hide' : 'show'];
			}

			if (operation.targetType === 'viewer') {
				return ['view', String(operation.targetId)];
			}

			return [];
		});

		return [label, ...opTerms, ...categoryTerms].join(' ').toLowerCase();
	}

	if (change.kind === 'clear_highlights') {
		return `${label} clear highlights highlight glow focus`.toLowerCase();
	}

	if (change.kind === 'set_highlights') {
		const opTerms = change.operations.flatMap((operation) => [
			operation.targetId,
			operation.targetName ?? '',
			'highlight',
			'focus',
			'glow'
		]);
		return [label, ...opTerms].join(' ').toLowerCase();
	}

	if (change.kind === 'clear_highlight_targets') {
		return `${label} clear highlight highlight glow focus ${change.targetIds.join(' ')}`.toLowerCase();
	}

	return `${label} restore revert reset original normal`.toLowerCase();
}

function matchesChangeQuery(change: VehiclePresentationChangeEntry, query: string): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return false;
	}

	const haystack = getChangeSearchText(change);
	const terms = tokenizeQuery(normalizedQuery);

	if (haystack.includes(normalizedQuery)) {
		return true;
	}

	return terms.every((term) => haystack.includes(term));
}

type VehiclePresentationChangeKind =
	| 'highlight'
	| 'material'
	| 'visibility'
	| 'viewer'
	| 'restore';

function inferChangeKinds(change: VehiclePresentationChangeEntry): Set<VehiclePresentationChangeKind> {
	const kinds = new Set<VehiclePresentationChangeKind>();

	if (change.kind === 'set_highlights' || change.kind === 'clear_highlights' || change.kind === 'clear_highlight_targets') {
		kinds.add('highlight');
		return kinds;
	}

	if (change.kind === 'restore') {
		kinds.add('restore');
		if (change.restore.highlightedTargetIds?.length) kinds.add('highlight');
		if (change.restore.materialTargetIds?.length) kinds.add('material');
		if (change.restore.hiddenTargetIds?.length) kinds.add('visibility');
		if (change.restore.viewerModes?.length) kinds.add('viewer');
		return kinds;
	}

	for (const operation of change.operations) {
		if (isHighlightOperation(operation)) {
			kinds.add('highlight');
			continue;
		}
		if (operation.targetType === 'material') {
			kinds.add('material');
			continue;
		}
		if (operation.targetType === 'node' && operation.op === 'set_visibility') {
			kinds.add('visibility');
			continue;
		}
		if (operation.targetType === 'viewer') {
			kinds.add('viewer');
		}
	}

	return kinds;
}

function inferQueryKinds(query: string): Set<VehiclePresentationChangeKind> {
	const normalized = query.toLowerCase();
	const kinds = new Set<VehiclePresentationChangeKind>();

	if (/\b(highlight|highlights|glow|glowing|focus|spotlight|isolate)\b/.test(normalized)) {
		kinds.add('highlight');
	}
	if (/\b(color|paint|repaint|tint|appearance|finish|material|chrome|matte|metallic|pearl|gloss)\b/.test(normalized)) {
		kinds.add('material');
	}
	if (/\b(hide|hidden|show|visible|visibility|remove|removed)\b/.test(normalized)) {
		kinds.add('visibility');
	}
	if (/\b(view|wireframe|xray|x-ray|uv|uv_debug|uv debug|postprocess|post-processing)\b/.test(normalized)) {
		kinds.add('viewer');
	}
	if (/\b(restore|revert|reset|normal|original)\b/.test(normalized)) {
		kinds.add('restore');
	}

	return kinds;
}

function extractSelectiveUndoQuery(content: string): string | null {
	const trimmed = content.trim();
	if (
		/\b(all|everything|all changes|all edits|all operations|last|previous|latest)\b/i.test(trimmed)
	) {
		return null;
	}

	const match =
		trimmed.match(/^(?:undo|revert)\s+(?:the\s+)?(.+?)\s+(?:change|edit|operation|adjustment)s?$/i) ??
		trimmed.match(/^(?:undo|revert)\s+(?!all\b)(.+)$/i);

	if (!match?.[1]) {
		return null;
	}

	const query = match[1].trim().replace(/^(the|my|our)\s+/i, '').trim();
	return query.length > 0 ? query : null;
}

function describeChange(change: VehiclePresentationChangeEntry | undefined): string {
	return change?.intentLabel?.trim() || 'the requested vehicle change';
}

function createVehiclePatchStore() {
	const { subscribe, update } = writable<VehiclePatchState>(INITIAL_STATE);

	return {
		subscribe,
		queue(
			assetId: VehicleAssetId,
			operations: VehicleInspectionPatchOperation[],
			intentLabel?: string
		): void {
			if (operations.length === 0) {
				return;
			}

			update((state) => {
				const nextPast =
					state.assetId === assetId
						? [
								...state.past,
								{
									kind: 'operations' as const,
									intentLabel: intentLabel?.trim() || null,
									operations
								}
							]
						: [
								{
									kind: 'operations' as const,
									intentLabel: intentLabel?.trim() || null,
									operations
								}
							];

				const nextState = buildState(assetId, nextPast, [], state.revision + 1);
				if (
					state.assetId === assetId &&
					JSON.stringify(nextState.operations) === JSON.stringify(state.operations)
				) {
					return state;
				}

				return nextState;
			});
		},
		setHighlights(
			assetId: VehicleAssetId,
			operations: VehicleInspectionPatchOperation[],
			intentLabel?: string
		): void {
			const highlightOperations = operations.filter((operation) => isHighlightOperation(operation));
			if (highlightOperations.length === 0) {
				return;
			}

			update((state) => {
				const nextPast =
					state.assetId === assetId
						? [
								...state.past,
								{
									kind: 'set_highlights' as const,
									intentLabel: intentLabel?.trim() || null,
									operations: highlightOperations
								}
							]
						: [
								{
									kind: 'set_highlights' as const,
									intentLabel: intentLabel?.trim() || null,
									operations: highlightOperations
								}
							];

				const nextState = buildState(assetId, nextPast, [], state.revision + 1);
				if (
					state.assetId === assetId &&
					JSON.stringify(nextState.presentation.highlightOperations) ===
						JSON.stringify(state.presentation.highlightOperations)
				) {
					return state;
				}

				return nextState;
			});
		},
		undo(assetId?: VehicleAssetId): boolean {
			let didUndo = false;

			update((state) => {
				if (state.past.length === 0 || (assetId && state.assetId !== assetId)) {
					return state;
				}

				didUndo = true;
				const removed = state.past[state.past.length - 1];
				const nextPast = state.past.slice(0, -1);
				const nextFuture = removed ? [removed, ...state.future] : state.future;
				return buildState(state.assetId, nextPast, nextFuture, state.revision + 1);
			});

			return didUndo;
		},
		undoMatching(assetId: VehicleAssetId | undefined, query: string): string | null {
			if (!assetId || !query.trim()) {
				return null;
			}

			let revertedLabel: string | null = null;

			update((state) => {
				if (state.assetId !== assetId) {
					return state;
				}

				const queryKinds = inferQueryKinds(query);
				const matches = [...state.past]
					.map((change, index) => ({ change, index }))
					.filter(({ change }) => matchesChangeQuery(change, query))
					.filter(({ change }) => {
						if (queryKinds.size === 0) {
							return true;
						}

						const changeKinds = inferChangeKinds(change);
						return Array.from(queryKinds).some((kind) => changeKinds.has(kind));
					});

				if (matches.length === 0) {
					return state;
				}

				if (queryKinds.size === 0) {
					const distinctKinds = new Set(
						matches.flatMap(({ change }) => Array.from(inferChangeKinds(change)))
					);
					if (distinctKinds.size > 1) {
						return state;
					}
				}

				const matchIndex = matches[matches.length - 1]?.index;

				if (typeof matchIndex !== 'number') {
					return state;
				}

				const removed = state.past[matchIndex];
				const nextPast = state.past.filter((_, index) => index !== matchIndex);
				revertedLabel = describeChange(removed);
				return buildState(
					state.assetId,
					nextPast,
					removed ? [removed, ...state.future] : state.future,
					state.revision + 1
				);
			});

			return revertedLabel;
		},
		undoEntry(assetId: VehicleAssetId | undefined, historyIndex: number): string | null {
			if (!assetId || historyIndex < 0) {
				return null;
			}

			let revertedLabel: string | null = null;

			update((state) => {
				if (state.assetId !== assetId || historyIndex >= state.past.length) {
					return state;
				}

				const removed = state.past[historyIndex];
				const nextPast = state.past.filter((_, index) => index !== historyIndex);
				revertedLabel = describeChange(removed);
				return buildState(
					state.assetId,
					nextPast,
					removed ? [removed, ...state.future] : state.future,
					state.revision + 1
				);
			});

			return revertedLabel;
		},
		redo(assetId?: VehicleAssetId): boolean {
			let didRedo = false;

			update((state) => {
				if (state.future.length === 0 || (assetId && state.assetId !== assetId)) {
					return state;
				}

				didRedo = true;
				const redoneEntry = state.future[0];
				const nextFuture = state.future.slice(1);
				const nextPast = redoneEntry ? [...state.past, redoneEntry] : state.past;
				return buildState(state.assetId, nextPast, nextFuture, state.revision + 1);
			});

			return didRedo;
		},
		reset(assetId?: VehicleAssetId): boolean {
			let didReset = false;

			update((state) => {
				if (assetId && state.assetId !== assetId) {
					return state;
				}

				if (state.past.length === 0 && state.future.length === 0 && state.operations.length === 0) {
					return state;
				}

				didReset = true;
				return buildState(assetId ?? null, [], [], state.revision + 1);
			});

			return didReset;
		},
		clearHighlights(assetId?: VehicleAssetId): boolean {
			let didClear = false;

			update((state) => {
				if (assetId && state.assetId !== assetId) {
					return state;
				}

				if (state.presentation.highlightOperations.length === 0) {
					return state;
				}

				didClear = true;
				return buildState(
					state.assetId,
					[
						...state.past,
						{
							kind: 'clear_highlights',
							intentLabel: 'clear highlights'
						}
					],
					[],
					state.revision + 1
				);
			});

			return didClear;
		},
		clearHighlightTargets(
			assetId: VehicleAssetId | undefined,
			targetIds: string[],
			intentLabel?: string
		): boolean {
			if (!assetId || targetIds.length === 0) {
				return false;
			}

			let didClear = false;

			update((state) => {
				if (state.assetId !== assetId) {
					return state;
				}

				const activeTargetIds = new Set(
					state.presentation.highlightOperations.map((operation) => operation.targetId)
				);
				if (!targetIds.some((targetId) => activeTargetIds.has(targetId))) {
					return state;
				}

				const nextState = buildState(
					state.assetId,
					[
						...state.past,
						{
							kind: 'clear_highlight_targets',
							intentLabel: intentLabel?.trim() || 'clear highlight',
							targetIds: Array.from(new Set(targetIds)).sort((left, right) =>
								left.localeCompare(right)
							)
						}
					],
					[],
					state.revision + 1
				);

				if (
					JSON.stringify(nextState.presentation.highlightOperations) ===
					JSON.stringify(state.presentation.highlightOperations)
				) {
					return state;
				}

				didClear = true;
				return nextState;
			});

			return didClear;
		},
		restore(assetId: VehicleAssetId | undefined, restore: FooterChatPresentationRestore): boolean {
			if (!assetId) {
				return false;
			}

			let didRestore = false;

			update((state) => {
				if (state.assetId !== assetId) {
					return state;
				}

				const nextState = buildState(
					assetId,
					[
						...state.past,
						{
							kind: 'restore',
							intentLabel: restore.label?.trim() || 'restore original view',
							restore
						}
					],
					[],
					state.revision + 1
				);

				if (JSON.stringify(nextState.operations) === JSON.stringify(state.operations)) {
					return state;
				}

				didRestore = true;
				return nextState;
			});

			return didRestore;
		},
		extractSelectiveUndoQuery
	};
}

export const vehiclePatchState = createVehiclePatchStore();
