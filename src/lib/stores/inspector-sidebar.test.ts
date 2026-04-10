import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectorSidebarState } from './inspector-sidebar';

describe('inspectorSidebarState', () => {
	const assetId = 'audi_r8';

	beforeEach(() => {
		vi.useFakeTimers();
		inspectorSidebarState.reset();
	});

	afterEach(() => {
		inspectorSidebarState.reset();
		vi.useRealTimers();
	});

	it('returns the active sidebar context before ttl expiry', () => {
		inspectorSidebarState.set(assetId, {
			active: true,
			cards: [
				{
					title: 'Semantics',
					entries: {
						status: 'fresh'
					}
				}
			]
		});

		vi.advanceTimersByTime(9 * 60 * 1000);

		expect(inspectorSidebarState.getContext(assetId)).toEqual({
			active: true,
			cards: [
				{
					title: 'Semantics',
					entries: {
						status: 'fresh'
					}
				}
			]
		});
	});

	it('expires the sidebar after ten minutes', () => {
		inspectorSidebarState.set(assetId, {
			active: true,
			cards: [
				{
					title: 'Focus',
					entries: {
						target: 'Body Shell'
					}
				}
			]
		});

		vi.advanceTimersByTime(10 * 60 * 1000);

		expect(inspectorSidebarState.getContext(assetId)).toEqual({
			active: false,
			cards: []
		});
	});
});
