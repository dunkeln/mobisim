import { describe, expect, it } from 'vitest';
import {
	buildVehicleSemanticOverlayRuntimeIndex,
	partMatchesGroup
} from '$lib/semantic-overlay/runtime';

describe('semantic overlay runtime', () => {
	it('matches parts to groups only through shared node ids', () => {
		const exhaustGroup = {
			id: 'exhaust',
			humanLabel: 'Exhaust',
			aliases: [],
			confidence: 1,
			category: 'other' as const,
			categoryDetail: 'exhaust',
			supports: ['highlight'],
			nodeIds: ['node-exhaust'],
			meshIds: [],
			materialIds: ['material-shared-metal'],
			author: 'user' as const
		};
		const exhaustPart = {
			id: 'exhaust_tip',
			humanLabel: 'Exhaust Tip',
			aliases: [],
			confidence: 0.95,
			category: 'trim' as const,
			nodeIds: ['node-exhaust'],
			meshIds: ['mesh-exhaust'],
			materialIds: ['material-shared-metal']
		};
		const bodyPart = {
			id: 'rear_diffuser',
			humanLabel: 'Rear Diffuser',
			aliases: [],
			confidence: 0.92,
			category: 'trim' as const,
			nodeIds: ['node-diffuser'],
			meshIds: ['mesh-diffuser'],
			materialIds: ['material-shared-metal']
		};

		expect(partMatchesGroup(exhaustPart, exhaustGroup)).toBe(true);
		expect(partMatchesGroup(bodyPart, exhaustGroup)).toBe(false);
	});

	it('does not expand a group across parts that only share materials', () => {
		const overlay = {
			assetId: 'audi_r8' as const,
			revision: 1,
			structuralGeneratedAt: 'struct-1',
			generatedAt: '2026-04-16T08:30:00.000Z',
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [
				{
					id: 'exhaust_tip',
					humanLabel: 'Exhaust Tip',
					aliases: [],
					confidence: 0.95,
					category: 'trim' as const,
					nodeIds: ['node-exhaust'],
					meshIds: ['mesh-exhaust'],
					materialIds: ['material-shared-metal']
				},
				{
					id: 'rear_diffuser',
					humanLabel: 'Rear Diffuser',
					aliases: [],
					confidence: 0.92,
					category: 'trim' as const,
					nodeIds: ['node-diffuser'],
					meshIds: ['mesh-diffuser'],
					materialIds: ['material-shared-metal']
				}
			],
			acceptedGroups: [
				{
					id: 'exhaust',
					humanLabel: 'Exhaust',
					aliases: [],
					confidence: 1,
					category: 'other' as const,
					categoryDetail: 'exhaust',
					supports: ['highlight'],
					nodeIds: ['node-exhaust'],
					meshIds: [],
					materialIds: ['material-shared-metal'],
					author: 'user' as const
				}
			],
			discardedSuggestions: []
		};

		const runtimeIndex = buildVehicleSemanticOverlayRuntimeIndex(overlay);
		expect(runtimeIndex.partsByGroupId.get('exhaust')?.map((part) => part.id)).toEqual([
			'exhaust_tip'
		]);
	});
});
