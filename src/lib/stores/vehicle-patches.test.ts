import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { vehiclePatchState } from './vehicle-patches';

describe('vehiclePatchState highlight behavior', () => {
	it('composes highlight operations when queueing a new highlight batch', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'highlight wheels',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-1',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			]
		});
		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'highlight door',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-2',
					targetName: 'Door',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			]
		});

		const state = get(vehiclePatchState);

		expect(state.presentation.highlightOperations).toHaveLength(2);
		expect(state.intentLabel).toBe('highlight door');
		expect(state.operations).toHaveLength(2);
		expect(state.operations.map((operation) => operation.targetId)).toEqual([
			'material-1',
			'material-2'
		]);
	});

	it('clears highlight operations without removing non-highlight patches', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', { kind: 'operations', intentLabel: null, operations: [
			{
				targetType: 'material',
				targetId: 'material-1',
				targetName: 'Wheel',
				op: 'set_overlay_highlight',
				value: [0.5, 0.5, 0.8, 0.48]
			}
		] });
		vehiclePatchState.apply('audi_r8', { kind: 'operations', intentLabel: null, operations: [
			{
				targetType: 'material',
				targetId: 'material-9',
				targetName: 'Body',
				op: 'set_base_color_factor',
				value: [0.2, 0.1, 0.4, 1]
			}
		] });

		const didClear = vehiclePatchState.apply('audi_r8', {
			kind: 'clear_highlights',
			intentLabel: 'clear highlights'
		});
		const state = get(vehiclePatchState);

		expect(didClear).toBe(true);
		expect(state.presentation.highlightOperations).toHaveLength(0);
		expect(state.presentation.materialOperations).toHaveLength(1);
		expect(state.operations).toHaveLength(1);
		expect(state.operations[0]?.op).toBe('set_base_color_factor');
	});

	it('treats highlight clearing as an undoable presentation-state change', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'highlight wheels',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-1',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			]
		});

		vehiclePatchState.apply('audi_r8', {
			kind: 'clear_highlights',
			intentLabel: 'clear highlights'
		});
		expect(get(vehiclePatchState).presentation.highlightOperations).toHaveLength(0);
		expect(get(vehiclePatchState).intentLabel).toBe('clear highlights');

		const didUndo = vehiclePatchState.undo('audi_r8');
		const state = get(vehiclePatchState);

		expect(didUndo).toBe(true);
		expect(state.intentLabel).toBe('highlight wheels');
		expect(state.presentation.highlightOperations).toHaveLength(1);
		expect(state.operations[0]?.op).toBe('set_overlay_highlight');
	});

	it('sets highlight batches without touching non-highlight presentation layers', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', { kind: 'operations', intentLabel: null, operations: [
			{
				targetType: 'material',
				targetId: 'material-body',
				targetName: 'Body',
				op: 'set_base_color_factor',
				value: [0.2, 0.1, 0.4, 1]
			}
		] });

		vehiclePatchState.apply('audi_r8', {
			kind: 'set_highlights',
			intentLabel: 'highlight wheels',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-wheel',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.75, 0.34, 0.27, 1]
				}
			]
		});

		const state = get(vehiclePatchState);
		expect(state.presentation.materialOperations).toHaveLength(1);
		expect(state.presentation.highlightOperations).toHaveLength(1);
		expect(state.intentLabel).toBe('highlight wheels');
	});

	it('restores labeled intent history across undo and redo', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'paint body midnight purple',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-9',
					targetName: 'Body',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			]
		});
		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'isolate wheels',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-1',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			]
		});

		expect(get(vehiclePatchState).intentLabel).toBe('isolate wheels');

		vehiclePatchState.undo('audi_r8');
		expect(get(vehiclePatchState).intentLabel).toBe('paint body midnight purple');

		vehiclePatchState.redo('audi_r8');
		expect(get(vehiclePatchState).intentLabel).toBe('isolate wheels');
	});

	it('can selectively undo an earlier color change while keeping later drift', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'paint body midnight purple',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-body',
					targetName: 'Body Shell',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			]
		});
		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'highlight wheels',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-wheel',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			]
		});

		const revertedLabel = vehiclePatchState.undoMatching('audi_r8', 'color');
		const state = get(vehiclePatchState);

		expect(revertedLabel).toBe('paint body midnight purple');
		expect(state.presentation.materialOperations).toHaveLength(0);
		expect(state.presentation.highlightOperations).toHaveLength(1);
		expect(state.intentLabel).toBe('highlight wheels');
	});

	it('can undo a specific history entry by index for scrubbable UI targets', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'paint body midnight purple',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-body',
					targetName: 'Body Shell',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			]
		});
		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'hide left wheel',
			operations: [
				{
					targetType: 'node',
					targetId: 'wheel-left',
					targetName: 'Left Wheel',
					op: 'set_visibility',
					value: false
				}
			]
		});

		const revertedLabel = vehiclePatchState.undoEntry('audi_r8', 0);
		const state = get(vehiclePatchState);

		expect(revertedLabel).toBe('paint body midnight purple');
		expect(state.presentation.materialOperations).toHaveLength(0);
		expect(state.presentation.nodeVisibilityOperations).toHaveLength(1);
		expect(state.intentLabel).toBe('hide left wheel');
		expect(state.future).toHaveLength(1);
	});

	it('does not treat broad requests like revert all as selective undo queries', () => {
		expect(vehiclePatchState.extractSelectiveUndoQuery('revert all')).toBeNull();
		expect(vehiclePatchState.extractSelectiveUndoQuery('undo everything')).toBeNull();
		expect(vehiclePatchState.extractSelectiveUndoQuery('undo the last change')).toBeNull();
	});

	it('refuses ambiguous selective undo queries that match multiple change classes', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'paint wheel accent',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-wheel',
					targetName: 'Wheel',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			]
		});
		vehiclePatchState.apply('audi_r8', {
			kind: 'operations',
			intentLabel: 'highlight wheel',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-wheel',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			]
		});

		const revertedLabel = vehiclePatchState.undoMatching('audi_r8', 'wheel');

		expect(revertedLabel).toBeNull();
		expect(get(vehiclePatchState).presentation.materialOperations).toHaveLength(1);
		expect(get(vehiclePatchState).presentation.highlightOperations).toHaveLength(1);
	});

	it('keeps node visibility, material, and viewer layers composable', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', { kind: 'operations', intentLabel: null, operations: [
			{
				targetType: 'node',
				targetId: 'node-1',
				targetName: 'Door',
				op: 'set_visibility',
				value: false
			}
		] });
		vehiclePatchState.apply('audi_r8', { kind: 'operations', intentLabel: null, operations: [
			{
				targetType: 'viewer',
				targetId: 'xray',
				op: 'set_enabled',
				value: true
			}
		] });
		vehiclePatchState.apply('audi_r8', { kind: 'operations', intentLabel: null, operations: [
			{
				targetType: 'material',
				targetId: 'material-9',
				targetName: 'Body',
				op: 'set_base_color_factor',
				value: [0.2, 0.1, 0.4, 1]
			}
		] });

		const state = get(vehiclePatchState);

		expect(state.presentation.nodeVisibilityOperations).toHaveLength(1);
		expect(state.presentation.materialOperations).toHaveLength(1);
		expect(state.presentation.viewerOperations).toHaveLength(1);
		expect(state.operations).toHaveLength(3);
		expect(state.operations[0]?.op).toBe('set_visibility');
		expect(state.operations[1]?.op).toBe('set_base_color_factor');
		expect(state.operations[2]?.op).toBe('set_enabled');
	});

	it('restores targeted presentation layers back to the original rendered state', () => {
		vehiclePatchState.reset();

		vehiclePatchState.apply('audi_r8', { kind: 'operations', intentLabel: null, operations: [
			{
				targetType: 'node',
				targetId: 'node-wheel-left',
				targetName: 'Left Wheel',
				op: 'set_visibility',
				value: false
			},
			{
				targetType: 'viewer',
				targetId: 'uv_debug',
				op: 'set_enabled',
				value: true
			},
			{
				targetType: 'material',
				targetId: 'material-body',
				targetName: 'Body',
				op: 'set_base_color_factor',
				value: [0.2, 0.1, 0.4, 1]
			},
			{
				targetType: 'material',
				targetId: 'material-wheel',
				targetName: 'Wheel',
				op: 'set_overlay_highlight',
				value: [0.5, 0.5, 0.8, 0.48]
			}
		] });

		const didRestore = vehiclePatchState.apply('audi_r8', {
			kind: 'restore',
			intentLabel: 'restore original view',
			restore: {
				hiddenTargetIds: ['node-wheel-left'],
				viewerModes: ['uv_debug'],
				label: 'restore original view'
			}
		});
		const state = get(vehiclePatchState);

		expect(didRestore).toBe(true);
		expect(state.presentation.nodeVisibilityOperations).toHaveLength(0);
		expect(state.presentation.viewerOperations).toHaveLength(0);
		expect(state.presentation.materialOperations).toHaveLength(1);
		expect(state.presentation.highlightOperations).toHaveLength(1);
		expect(state.intentLabel).toBe('restore original view');
	});
});
