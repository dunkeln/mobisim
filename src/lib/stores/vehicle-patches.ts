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
			kind: 'restore';
			intentLabel: string | null;
			restore: FooterChatPresentationRestore;
	  };

export type VehiclePresentationMutation = VehiclePresentationChangeEntry;

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
	return operation.op === 'set_overlay_highlight';
}

function stripHighlightOperations(presentation: VehiclePresentationState): VehiclePresentationState {
	return {
		...presentation,
		highlightOperations: []
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

function isPreservedAppearanceMaterialOperation(
	operation: VehicleInspectionPatchOperation
): boolean {
	return (
		operation.targetType === 'material' &&
		(operation.op === 'set_base_color_factor' ||
			operation.op === 'set_metalness_factor' ||
			operation.op === 'set_roughness_factor' ||
			operation.op === 'set_env_map_intensity')
	);
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
		(operation) =>
			operation.targetType === 'node' &&
			(operation.op === 'set_visibility' || operation.op === 'set_alpha')
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
		return {
			...clonePresentation(EMPTY_PRESENTATION_STATE),
			// "Restore original view" clears presentation drift layers without
			// discarding stable paint/finish edits. Transient material drift like
			// alpha, overlay highlights, emissive accents, or double-sided toggles
			// should not survive an original-view restore.
			materialOperations: presentation.materialOperations.filter((operation) =>
				isPreservedAppearanceMaterialOperation(operation)
			)
		};
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

			if (operation.targetType === 'node' && operation.op === 'set_overlay_highlight') {
				return ['highlight', 'focus', 'glow', 'node'];
			}

			if (operation.targetType === 'node' && operation.op === 'set_visibility') {
				return ['visibility', operation.value === false ? 'hide' : 'show'];
			}

			if (operation.targetType === 'node' && operation.op === 'set_alpha') {
				return ['remove', 'hide', 'visibility', 'alpha', 'isolate'];
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

function findMatchingChangeIndex(
	changes: VehiclePresentationChangeEntry[],
	kind: VehiclePresentationChangeKind,
	occurrenceFromNewest = 0
): number {
	let remaining = occurrenceFromNewest;

	for (let index = changes.length - 1; index >= 0; index -= 1) {
		if (!inferChangeKinds(changes[index]!).has(kind)) {
			continue;
		}

		if (remaining === 0) {
			return index;
		}

		remaining -= 1;
	}

	return -1;
}

function inferChangeKinds(change: VehiclePresentationChangeEntry): Set<VehiclePresentationChangeKind> {
	const kinds = new Set<VehiclePresentationChangeKind>();

	if (change.kind === 'set_highlights' || change.kind === 'clear_highlights') {
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
		if (
			operation.targetType === 'node' &&
			(operation.op === 'set_visibility' || operation.op === 'set_alpha')
		) {
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

	function applyMutation(
		assetId: VehicleAssetId | undefined,
		mutation: VehiclePresentationMutation
	): boolean {
		if (!assetId) {
			return false;
		}

		let didApply = false;

		update((state) => {
			if (
				(mutation.kind === 'clear_highlights' ||
					mutation.kind === 'restore') &&
				state.assetId !== assetId
			) {
				return state;
			}

			let normalizedMutation = mutation;
			if (mutation.kind === 'operations' && mutation.operations.length === 0) {
				return state;
			}

			if (mutation.kind === 'set_highlights') {
				const highlightOperations = mutation.operations.filter((operation) =>
					isHighlightOperation(operation)
				);
				if (highlightOperations.length === 0) {
					return state;
				}

				normalizedMutation = {
					...mutation,
					operations: highlightOperations
				};
			}

			if (mutation.kind === 'clear_highlights' && state.presentation.highlightOperations.length === 0) {
				return state;
			}

			const nextPast =
				state.assetId === assetId &&
				(normalizedMutation.kind === 'operations' || normalizedMutation.kind === 'set_highlights')
					? [...state.past, normalizedMutation]
					: normalizedMutation.kind === 'operations' || normalizedMutation.kind === 'set_highlights'
						? [normalizedMutation]
						: [...state.past, normalizedMutation];

			const nextState = buildState(assetId, nextPast, [], state.revision + 1);

			if (mutation.kind === 'set_highlights') {
				if (
					state.assetId === assetId &&
					JSON.stringify(nextState.presentation.highlightOperations) ===
						JSON.stringify(state.presentation.highlightOperations)
				) {
					return state;
				}
			} else if (
				JSON.stringify(nextState.operations) === JSON.stringify(state.operations)
			) {
				return state;
			}

			didApply = true;
			return nextState;
		});

		return didApply;
	}

	return {
		subscribe,
		apply(assetId: VehicleAssetId | undefined, mutation: VehiclePresentationMutation): boolean {
			return applyMutation(assetId, mutation);
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
		restoreMatching(
			assetId: VehicleAssetId | undefined,
			kind: VehiclePresentationChangeKind,
			occurrenceFromNewest = 0
		): string | null {
			if (!assetId || occurrenceFromNewest < 0) {
				return null;
			}

			let revertedLabel: string | null = null;

			update((state) => {
				if (state.assetId !== assetId) {
					return state;
				}

				const matchIndex = findMatchingChangeIndex(
					state.past,
					kind,
					occurrenceFromNewest
				);
				if (matchIndex < 0) {
					return state;
				}

				const removed = state.past[matchIndex];
				const nextPast = state.past.filter((_, index) => index !== matchIndex);
				revertedLabel = describeChange(removed);
				return buildState(state.assetId, nextPast, [], state.revision + 1);
			});

			return revertedLabel;
		},
		restoreMatchingBatch(
			assetId: VehicleAssetId | undefined,
			kind: VehiclePresentationChangeKind,
			count = 1
		): string[] {
			if (!assetId || count <= 0) {
				return [];
			}

			const revertedLabels: string[] = [];

			update((state) => {
				if (state.assetId !== assetId) {
					return state;
				}

				const nextPast = [...state.past];
				const removedChanges: VehiclePresentationChangeEntry[] = [];

				for (let occurrence = 0; occurrence < count; occurrence += 1) {
					const matchIndex = findMatchingChangeIndex(nextPast, kind, 0);
					if (matchIndex < 0) {
						break;
					}

					const removed = nextPast.splice(matchIndex, 1)[0];
					if (removed) {
						removedChanges.push(removed);
						revertedLabels.push(describeChange(removed));
					}
				}

				if (removedChanges.length === 0) {
					return state;
				}

				return buildState(state.assetId, nextPast, [], state.revision + 1);
			});

			return revertedLabels;
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
		extractSelectiveUndoQuery
	};
}

export const vehiclePatchState = createVehiclePatchStore();
