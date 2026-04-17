import { describe, expect, it } from 'vitest';
import {
	buildHighlightTargetsForGroup,
	buildHighlightTargetsForPart
} from './semantic-highlight-targets';

describe('semantic highlight target builders', () => {
	it('includes material coverage for semantic parts before node fallbacks', () => {
		const targets = buildHighlightTargetsForPart({
			id: 'wheels_front',
			humanLabel: 'front wheels',
			aliases: ['wheels'],
			confidence: 0.94,
			category: 'wheel',
			nodeIds: ['node-wrapper'],
			meshIds: ['mesh-wheel'],
			materialIds: ['material-wheel'],
			region: 'front',
			side: 'center'
		});

		expect(targets).toEqual([
			{ targetId: 'material-wheel', targetType: 'material' },
			{ targetId: 'node-wrapper', targetType: 'node' }
		]);
	});

	it('keeps group highlight expansion node-backed when matched parts share broader materials', () => {
		const targets = buildHighlightTargetsForGroup(
			{
				id: 'wheels',
				humanLabel: 'wheels',
				aliases: ['wheel'],
				confidence: 0.98,
				category: 'wheels',
				supports: ['highlight', 'focus', 'isolate'],
				nodeIds: ['node-group'],
				meshIds: ['mesh-wheel'],
				materialIds: ['material-wheel'],
				author: 'agent'
			},
			{
				partsById: new Map(),
				partsByNodeId: new Map(),
				partsByMaterialId: new Map(),
				partsByGroupId: new Map([
					[
						'wheels',
						[
							{
								id: 'wheel_front_left',
								humanLabel: 'front left wheel',
								aliases: ['wheel'],
								confidence: 0.92,
								category: 'wheel',
								nodeIds: ['node-wrapper', 'node-group'],
								meshIds: ['mesh-wheel'],
								materialIds: ['material-wheel', 'material-tire'],
								region: 'front',
								side: 'left'
							}
						]
					]
				]),
				uncoveredNodeIdsByGroupId: new Map()
			}
		);

		expect(targets).toEqual([
			{ targetId: 'material-wheel', targetType: 'material' },
			{ targetId: 'node-group', targetType: 'node' },
			{ targetId: 'node-wrapper', targetType: 'node' }
		]);
	});
});
