import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { footerActiveTool } from './footer-active-tool';

describe('footerActiveTool', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		footerActiveTool.reset();
	});

	afterEach(() => {
		footerActiveTool.reset();
		vi.useRealTimers();
	});

	it('uses the latest completed tool as the base pill and preserves only the last six entries', () => {
		footerActiveTool.setFromToolCalls([
			'tool_1',
			'tool_2',
			'get_vehicle_tool_catalog',
			'apply_vehicle_appearance_intent',
			'set_vehicle_view_mode',
			'expand_vehicle_selection',
			'mutate_vehicle_semantic_assignment'
		]);

		expect(footerActiveTool.getSnapshot()).toEqual({
			active: true,
			label: 'mutate_vehicle_semantic_assignment(...)',
			toolName: 'mutate_vehicle_semantic_assignment',
			toolLabels: [
				'tool_2(...)',
				'get_vehicle_tool_catalog(...)',
				'apply_vehicle_appearance_intent(...)',
				'set_vehicle_view_mode(...)',
				'expand_vehicle_selection(...)',
				'mutate_vehicle_semantic_assignment(...)'
			],
			toolNames: [
				'tool_2',
				'get_vehicle_tool_catalog',
				'apply_vehicle_appearance_intent',
				'set_vehicle_view_mode',
				'expand_vehicle_selection',
				'mutate_vehicle_semantic_assignment'
			]
		});
	});

	it('expires the active tool chip after the ttl', () => {
		footerActiveTool.setFromToolCalls(['set_vehicle_view_mode']);

		vi.advanceTimersByTime(4 * 1000);

		expect(footerActiveTool.getSnapshot()).toEqual({
			active: false,
			label: '',
			toolName: null,
			toolLabels: [],
			toolNames: []
		});
	});
});
