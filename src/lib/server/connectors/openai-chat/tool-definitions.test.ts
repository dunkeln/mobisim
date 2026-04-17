import { describe, expect, it } from 'vitest';
import { buildVehicleToolCatalog } from './tool-definitions';

describe('buildVehicleToolCatalog', () => {
	it('returns concrete supported recommendations from live selection and presentation context', () => {
		const catalog = buildVehicleToolCatalog(
			{ goal: 'help the user decide what to do next', includeExamples: true },
			'audi_r8',
			[
				{
					assetId: 'audi_r8',
					nodeId: 'node-1',
					nodeName: 'FrontLeftWheel',
					nodePath: '/Root/FrontLeftWheel',
					targetType: 'node'
				}
			],
			{
				highlightedTargets: [
					{
						assetId: 'audi_r8',
						targetType: 'node',
						targetId: 'node-1',
						label: 'Front Left Wheel'
					}
				],
				hiddenTargets: []
			}
		);

		expect(catalog.recommendations).toContain(
			'Current selection is available, so supported next asks include "highlight this", "make this matte black", or "expand this selection to the semantic group".'
		);
		expect(catalog.recommendations).toContain(
			'Active presentation context is available, so supported next asks include "restore the current highlights", "restore hidden regions", or "remove the highlighted region from body shell".'
		);
		expect(catalog.recommendations).toContain(
			'Current goal for tool choice: help the user decide what to do next. Choose the domain first, then the action, and only suggest asks that map to the listed tool actions.'
		);
	});

	it('uses tool examples that stay inside the current supported actions', () => {
		const catalog = buildVehicleToolCatalog({ includeExamples: true }, 'audi_r8');
		const selectionTool = catalog.tools.find((tool) => tool.name === 'edit_vehicle_selection');
		const semanticsTool = catalog.tools.find((tool) => tool.name === 'edit_vehicle_semantics');

		expect(selectionTool?.examples).toContain('expand this selection to the semantic group');
		expect(semanticsTool?.examples).toContain(
			'create a new semantic group called roof rack from this selection'
		);
		expect(semanticsTool?.examples).not.toContain('create a new roof_rack group');
	});
});
