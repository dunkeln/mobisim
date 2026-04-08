import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { vehiclePatchState } from './vehicle-patches';

describe('vehiclePatchState highlight behavior', () => {
	it('composes highlight operations when queueing a new highlight batch', () => {
		vehiclePatchState.reset();

		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-1',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			],
			'highlight wheels'
		);
		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-2',
					targetName: 'Door',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			],
			'highlight door'
		);

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

		vehiclePatchState.queue('audi_r8', [
			{
				targetType: 'material',
				targetId: 'material-1',
				targetName: 'Wheel',
				op: 'set_overlay_highlight',
				value: [0.5, 0.5, 0.8, 0.48]
			}
		]);
		vehiclePatchState.queue('audi_r8', [
			{
				targetType: 'material',
				targetId: 'material-9',
				targetName: 'Body',
				op: 'set_base_color_factor',
				value: [0.2, 0.1, 0.4, 1]
			}
		]);

		const didClear = vehiclePatchState.clearHighlights('audi_r8');
		const state = get(vehiclePatchState);

		expect(didClear).toBe(true);
		expect(state.presentation.highlightOperations).toHaveLength(0);
		expect(state.presentation.materialOperations).toHaveLength(1);
		expect(state.operations).toHaveLength(1);
		expect(state.operations[0]?.op).toBe('set_base_color_factor');
	});

	it('treats highlight clearing as an undoable presentation-state change', () => {
		vehiclePatchState.reset();

		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-1',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			],
			'highlight wheels'
		);

		vehiclePatchState.clearHighlights('audi_r8');
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

		vehiclePatchState.queue('audi_r8', [
			{
				targetType: 'material',
				targetId: 'material-body',
				targetName: 'Body',
				op: 'set_base_color_factor',
				value: [0.2, 0.1, 0.4, 1]
			}
		]);

		vehiclePatchState.setHighlights(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-wheel',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.75, 0.34, 0.27, 1]
				}
			],
			'highlight wheels'
		);

		const state = get(vehiclePatchState);
		expect(state.presentation.materialOperations).toHaveLength(1);
		expect(state.presentation.highlightOperations).toHaveLength(1);
		expect(state.intentLabel).toBe('highlight wheels');
	});

	it('clears only matching highlight targets without affecting other highlight targets or material edits', () => {
		vehiclePatchState.reset();

		vehiclePatchState.setHighlights('audi_r8', [
			{
				targetType: 'material',
				targetId: 'material-wheel-left',
				targetName: 'Left Wheel',
				op: 'set_overlay_highlight',
				value: [0.75, 0.34, 0.27, 1]
			},
			{
				targetType: 'material',
				targetId: 'material-wheel-right',
				targetName: 'Right Wheel',
				op: 'set_overlay_highlight',
				value: [0.75, 0.34, 0.27, 1]
			}
		]);
		vehiclePatchState.queue('audi_r8', [
			{
				targetType: 'material',
				targetId: 'material-body',
				targetName: 'Body',
				op: 'set_base_color_factor',
				value: [0.2, 0.1, 0.4, 1]
			}
		]);

		const didClear = vehiclePatchState.clearHighlightTargets('audi_r8', ['material-wheel-left']);
		const state = get(vehiclePatchState);

		expect(didClear).toBe(true);
		expect(state.presentation.highlightOperations).toHaveLength(1);
		expect(state.presentation.highlightOperations[0]?.targetId).toBe('material-wheel-right');
		expect(state.presentation.materialOperations).toHaveLength(1);
		expect(state.intentLabel).toBe('clear highlight');
	});

	it('restores labeled intent history across undo and redo', () => {
		vehiclePatchState.reset();

		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-9',
					targetName: 'Body',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			],
			'paint body midnight purple'
		);
		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-1',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			],
			'isolate wheels'
		);

		expect(get(vehiclePatchState).intentLabel).toBe('isolate wheels');

		vehiclePatchState.undo('audi_r8');
		expect(get(vehiclePatchState).intentLabel).toBe('paint body midnight purple');

		vehiclePatchState.redo('audi_r8');
		expect(get(vehiclePatchState).intentLabel).toBe('isolate wheels');
	});

	it('can selectively undo an earlier color change while keeping later drift', () => {
		vehiclePatchState.reset();

		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-body',
					targetName: 'Body Shell',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			],
			'paint body midnight purple'
		);
		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-wheel',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			],
			'highlight wheels'
		);

		const revertedLabel = vehiclePatchState.undoMatching('audi_r8', 'color');
		const state = get(vehiclePatchState);

		expect(revertedLabel).toBe('paint body midnight purple');
		expect(state.presentation.materialOperations).toHaveLength(0);
		expect(state.presentation.highlightOperations).toHaveLength(1);
		expect(state.intentLabel).toBe('highlight wheels');
	});

	it('can undo a specific history entry by index for scrubbable UI targets', () => {
		vehiclePatchState.reset();

		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-body',
					targetName: 'Body Shell',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			],
			'paint body midnight purple'
		);
		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'node',
					targetId: 'wheel-left',
					targetName: 'Left Wheel',
					op: 'set_visibility',
					value: false
				}
			],
			'hide left wheel'
		);

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

		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-wheel',
					targetName: 'Wheel',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			],
			'paint wheel accent'
		);
		vehiclePatchState.queue(
			'audi_r8',
			[
				{
					targetType: 'material',
					targetId: 'material-wheel',
					targetName: 'Wheel',
					op: 'set_overlay_highlight',
					value: [0.5, 0.5, 0.8, 0.48]
				}
			],
			'highlight wheel'
		);

		const revertedLabel = vehiclePatchState.undoMatching('audi_r8', 'wheel');

		expect(revertedLabel).toBeNull();
		expect(get(vehiclePatchState).presentation.materialOperations).toHaveLength(1);
		expect(get(vehiclePatchState).presentation.highlightOperations).toHaveLength(1);
	});

	it('keeps node visibility, material, and viewer layers composable', () => {
		vehiclePatchState.reset();

		vehiclePatchState.queue('audi_r8', [
			{
				targetType: 'node',
				targetId: 'node-1',
				targetName: 'Door',
				op: 'set_visibility',
				value: false
			}
		]);
		vehiclePatchState.queue('audi_r8', [
			{
				targetType: 'viewer',
				targetId: 'xray',
				op: 'set_enabled',
				value: true
			}
		]);
		vehiclePatchState.queue('audi_r8', [
			{
				targetType: 'material',
				targetId: 'material-9',
				targetName: 'Body',
				op: 'set_base_color_factor',
				value: [0.2, 0.1, 0.4, 1]
			}
		]);

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

		vehiclePatchState.queue('audi_r8', [
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
		]);

		const didRestore = vehiclePatchState.restore('audi_r8', {
			hiddenTargetIds: ['node-wheel-left'],
			viewerModes: ['uv_debug'],
			label: 'restore original view'
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
