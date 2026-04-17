import { describe, expect, it } from 'vitest';
import { deriveFooterChatPolicy } from './policy';

describe('deriveFooterChatPolicy', () => {
	it('does not ask for clarification when the user references the current selection', () => {
		const policy = deriveFooterChatPolicy({
			assetId: 'audi_r8',
			message: 'this is the real lighting',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-1',
					nodeName: 'Front Lamp',
					nodePath: 'Scene/Front/Lamp'
				}
			]
		}, 3);

		expect(policy.mode).not.toBe('clarification');
	});

	it('treats explicit semantic group deletion as direct execution', () => {
		const policy = deriveFooterChatPolicy({
			assetId: 'audi_r8',
			message: 'remove the current semantic group completely',
			selectedNodes: [],
			selectedGroupId: 'body_shell'
		}, 3);

		expect(policy.mode).toBe('direct');
	});

	it('routes explicit semantic group creation through the semantics tool', () => {
		const policy = deriveFooterChatPolicy({
			assetId: 'audi_r8',
			message: 'create a new semantic group from this selection',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-1',
					nodeName: 'Wheel Cover',
					nodePath: 'Scene/Wheel Cover'
				}
			]
		}, 3);

		expect(policy.mode).toBe('single_tool');
		expect(policy.toolChoice).toEqual({
			type: 'function',
			function: {
				name: 'edit_vehicle_semantics'
			}
		});
	});
});
