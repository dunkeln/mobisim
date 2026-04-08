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

	it('prefers the user-facing vehicle tool over the catalog helper', () => {
		footerActiveTool.setFromToolCalls([
			'get_vehicle_tool_catalog',
			'apply_vehicle_appearance_intent'
		]);

		expect(footerActiveTool.getSnapshot()).toEqual({
			active: true,
			label: 'Appearance',
			toolName: 'apply_vehicle_appearance_intent',
			toolLabels: ['Tool Catalog', 'Appearance'],
			toolNames: ['get_vehicle_tool_catalog', 'apply_vehicle_appearance_intent']
		});
	});

	it('expires the active tool chip after the ttl', () => {
		footerActiveTool.setFromToolCalls(['set_vehicle_view_mode']);

		vi.advanceTimersByTime(20 * 1000);

		expect(footerActiveTool.getSnapshot()).toEqual({
			active: false,
			label: '',
			toolName: null,
			toolLabels: [],
			toolNames: []
		});
	});
});
