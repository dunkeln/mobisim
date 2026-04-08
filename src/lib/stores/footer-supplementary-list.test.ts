import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { footerSupplementaryList } from './footer-supplementary-list';

describe('footerSupplementaryList', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		footerSupplementaryList.reset();
	});

	afterEach(() => {
		footerSupplementaryList.reset();
		vi.useRealTimers();
	});

	it('sanitizes and returns the active supplementary list context', () => {
		footerSupplementaryList.set({
			active: true,
			items: ['  Wheels  ', '', 'Front quarter']
		});

		expect(footerSupplementaryList.getContext()).toEqual({
			active: true,
			items: ['Wheels', 'Front quarter']
		});
	});

	it('expires the supplementary list after the ttl', () => {
		footerSupplementaryList.set({
			active: true,
			items: ['Wheels']
		});

		vi.advanceTimersByTime(10 * 60 * 1000);

		expect(footerSupplementaryList.getContext()).toEqual({
			active: false,
			items: []
		});
	});
});
