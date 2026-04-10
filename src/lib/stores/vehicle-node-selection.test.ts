import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { vehicleNodeSelection, type VehicleNodeSelection } from './vehicle-node-selection';

const baseSelection: VehicleNodeSelection = {
	assetId: 'audi_r8',
	targetType: 'node',
	targetId: 'node-1',
	targetName: 'Glass',
	nodeIds: ['node-1'],
	nodeId: 'node-1',
	nodeName: 'Glass',
	nodePath: 'Scene/Glass'
};

describe('vehicleNodeSelection', () => {
	it('accumulates additive selections without collapsing different semantic targets that share nodes', () => {
		vehicleNodeSelection.clear();

		vehicleNodeSelection.select({
			...baseSelection,
			targetType: 'part',
			targetId: 'front_left_wheel',
			targetName: 'front left wheel',
			nodeIds: ['node-1', 'node-2'],
			anchorNodeId: 'node-1'
		});
		vehicleNodeSelection.select(
			{
				...baseSelection,
				targetType: 'part',
				targetId: 'wheel_trim',
				targetName: 'wheel trim',
				nodeIds: ['node-1'],
				anchorNodeId: 'node-1'
			},
			true
		);

		expect(get(vehicleNodeSelection)).toEqual([
			{
				...baseSelection,
				targetType: 'part',
				targetId: 'front_left_wheel',
				targetName: 'front left wheel',
				nodeIds: ['node-1', 'node-2'],
				anchorNodeId: 'node-1'
			},
			{
				...baseSelection,
				targetType: 'part',
				targetId: 'wheel_trim',
				targetName: 'wheel trim',
				nodeIds: ['node-1'],
				anchorNodeId: 'node-1'
			}
		]);
	});

	it('replaces the current asset selection set on non-additive selection', () => {
		vehicleNodeSelection.clear();

		vehicleNodeSelection.select({
			...baseSelection,
			targetType: 'part',
			targetId: 'glasshouse',
			targetName: 'glasshouse',
			nodeIds: ['node-1'],
			materialIndex: 0,
			materialName: 'Glass'
		});
		vehicleNodeSelection.select(
			{
				assetId: 'audi_r8',
				targetType: 'node',
				targetId: 'node-2',
				targetName: 'Headlight',
				nodeIds: ['node-2'],
				nodeId: 'node-2',
				nodeName: 'Headlight',
				nodePath: 'Scene/Headlight'
			},
			true
		);

		vehicleNodeSelection.select({
			assetId: 'audi_r8',
			targetType: 'node',
			targetId: 'node-3',
			targetName: 'Door',
			nodeIds: ['node-3'],
			nodeId: 'node-3',
			nodeName: 'Door',
			nodePath: 'Scene/Door'
		});

		expect(get(vehicleNodeSelection)).toEqual([
			{
				assetId: 'audi_r8',
				targetType: 'node',
				targetId: 'node-3',
				targetName: 'Door',
				nodeIds: ['node-3'],
				nodeId: 'node-3',
				nodeName: 'Door',
				nodePath: 'Scene/Door'
			}
		]);
	});

	it('keeps additive reselection of the same node idempotent', () => {
		vehicleNodeSelection.clear();

		vehicleNodeSelection.select(
			{
				...baseSelection,
				targetType: 'part',
				targetId: 'glasshouse',
				targetName: 'glasshouse',
				nodeIds: ['node-1'],
				materialIndex: 0,
				materialName: 'Glass'
			},
			true
		);
		vehicleNodeSelection.select(
			{
				...baseSelection,
				targetType: 'part',
				targetId: 'glasshouse',
				targetName: 'glasshouse',
				nodeIds: ['node-1'],
				materialIndex: 0,
				materialName: 'Glass'
			},
			true
		);

		expect(get(vehicleNodeSelection)).toEqual([
			{
				...baseSelection,
				targetType: 'part',
				targetId: 'glasshouse',
				targetName: 'glasshouse',
				nodeIds: ['node-1'],
				materialIndex: 0,
				materialName: 'Glass'
			}
		]);
	});
});
