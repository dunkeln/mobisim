import { describe, expect, it } from 'vitest';
import { isSemanticAnnotationRequest } from './routing';

describe('isSemanticAnnotationRequest', () => {
	it('treats selected-target phrasing as semantic annotation intent', () => {
		expect(isSemanticAnnotationRequest('mark them as headlights')).toBe(true);
		expect(isSemanticAnnotationRequest('assign selected nodes to headlights')).toBe(true);
		expect(isSemanticAnnotationRequest('current selection should be headlights')).toBe(true);
	});
});
