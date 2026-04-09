import { describe, expect, it } from 'vitest';
import { getToolChoiceForRequest, isSemanticAnnotationRequest } from './routing';

describe('isSemanticAnnotationRequest', () => {
	it('treats selected-target phrasing as semantic annotation intent', () => {
		expect(isSemanticAnnotationRequest('mark them as headlights')).toBe(true);
		expect(isSemanticAnnotationRequest('assign selected nodes to headlights')).toBe(true);
		expect(isSemanticAnnotationRequest('current selection should be headlights')).toBe(true);
	});
});

describe('getToolChoiceForRequest', () => {
	it('forces the tool catalog for explicit capability requests', () => {
		expect(
			getToolChoiceForRequest({
				message: 'what tools are available here?',
				selectedNodes: []
			})
		).toEqual({
			type: 'function',
			function: {
				name: 'get_vehicle_tool_catalog'
			}
		});
	});

	it('forces the tool catalog for compound requests that need planning-first tool composition', () => {
		expect(
			getToolChoiceForRequest({
				message: 'highlight the wheels and then put the changed targets in the footer list',
				selectedNodes: []
			})
		).toEqual({
			type: 'function',
			function: {
				name: 'get_vehicle_tool_catalog'
			}
		});
	});
});
