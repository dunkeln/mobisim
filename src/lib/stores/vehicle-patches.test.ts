import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { vehiclePatchState } from './vehicle-patches';

describe('vehiclePatchState highlight behavior', () => {
	it('replaces previous highlight operations when queueing a new highlight batch', () => {
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

		expect(state.presentation.highlightOperations).toHaveLength(1);
		expect(state.intentLabel).toBe('highlight door');
		expect(state.operations).toHaveLength(1);
		expect(state.operations[0]?.targetId).toBe('material-2');
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
