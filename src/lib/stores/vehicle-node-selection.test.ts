import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { vehicleNodeSelection, type VehicleNodeSelection } from './vehicle-node-selection';

const baseSelection: VehicleNodeSelection = {
	assetId: 'audi_r8',
	nodeId: 'node-1',
	nodeName: 'Glass',
	nodePath: 'Scene/Glass'
};

describe('vehicleNodeSelection', () => {
	it('toggles exact material-slot selections independently on the same node', () => {
		vehicleNodeSelection.clear();

		vehicleNodeSelection.select({
			...baseSelection,
			materialIndex: 0,
			materialName: 'Glass'
		});
		vehicleNodeSelection.select(
			{
				...baseSelection,
				materialIndex: 1,
				materialName: 'Trim'
			},
			true
		);

		expect(get(vehicleNodeSelection)).toEqual([
			{
				...baseSelection,
				materialIndex: 0,
				materialName: 'Glass'
			},
			{
				...baseSelection,
				materialIndex: 1,
				materialName: 'Trim'
			}
		]);

		vehicleNodeSelection.select(
			{
				...baseSelection,
				materialIndex: 0,
				materialName: 'Glass'
			},
			true
		);

		expect(get(vehicleNodeSelection)).toEqual([
			{
				...baseSelection,
				materialIndex: 1,
				materialName: 'Trim'
			}
		]);
	});

	it('replaces the current asset selection set on non-additive selection', () => {
		vehicleNodeSelection.clear();

		vehicleNodeSelection.select({
			...baseSelection,
			materialIndex: 0,
			materialName: 'Glass'
		});
		vehicleNodeSelection.select(
			{
				assetId: 'audi_r8',
				nodeId: 'node-2',
				nodeName: 'Headlight',
				nodePath: 'Scene/Headlight'
			},
			true
		);

		vehicleNodeSelection.select({
			assetId: 'audi_r8',
			nodeId: 'node-3',
			nodeName: 'Door',
			nodePath: 'Scene/Door'
		});

		expect(get(vehicleNodeSelection)).toEqual([
			{
				assetId: 'audi_r8',
				nodeId: 'node-3',
				nodeName: 'Door',
				nodePath: 'Scene/Door'
			}
		]);
	});
});
