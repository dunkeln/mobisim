import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { footerSupplementaryList } from './footer-supplementary-list';

describe('footerSupplementaryList', () => {
	const assetId = 'audi_r8';

	beforeEach(() => {
		vi.useFakeTimers();
		footerSupplementaryList.reset();
	});

	afterEach(() => {
		footerSupplementaryList.reset();
		vi.useRealTimers();
	});

	it('sanitizes and returns the active supplementary list context', () => {
		footerSupplementaryList.set(assetId, {
			active: true,
			entries: {
				'  Scope  ': '  Wheels  ',
				'': 'ignore',
				View: 'Front quarter'
			}
		});

		expect(footerSupplementaryList.getContext(assetId)).toEqual({
			active: true,
			entries: {
				Scope: 'Wheels',
				View: 'Front quarter'
			}
		});
	});

	it('expires the supplementary list after the ttl', () => {
		footerSupplementaryList.set(assetId, {
			active: true,
			entries: {
				Scope: 'Wheels'
			}
		});

		vi.advanceTimersByTime(10 * 60 * 1000);

		expect(footerSupplementaryList.getContext(assetId)).toEqual({
			active: false,
			entries: {}
		});
	});
});
