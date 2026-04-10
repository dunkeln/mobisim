import { beforeEach, describe, expect, it } from 'vitest';
import { requestGate } from './request-gate';

describe('requestGate', () => {
	beforeEach(() => {
		requestGate.reset();
	});

	it('starts hidden until an app-layer intercept opens it', () => {
		expect(requestGate.getSnapshot()).toEqual({
			visible: false,
			requestVariable: 'request variable',
			decision: null,
			dragPosition: 0,
			isDragging: false,
			isApprovePathActive: false
		});
	});

	it('tracks approve-path interaction state for shared observers', () => {
		requestGate.open({ requestVariable: 'semantic approval' });
		requestGate.beginInteraction();
		requestGate.updateDragPosition(24);

		expect(requestGate.getSnapshot()).toEqual({
			visible: true,
			requestVariable: 'semantic approval',
			decision: null,
			dragPosition: 24,
			isDragging: true,
			isApprovePathActive: true
		});
	});

	it('resolves and resets cleanly for app-layer intercepts', () => {
		requestGate.open();
		requestGate.resolveApproved(120);

		expect(requestGate.getSnapshot()).toEqual({
			visible: true,
			requestVariable: 'request variable',
			decision: true,
			dragPosition: 120,
			isDragging: false,
			isApprovePathActive: true
		});

		requestGate.resetInteraction();

		expect(requestGate.getSnapshot()).toEqual({
			visible: true,
			requestVariable: 'request variable',
			decision: null,
			dragPosition: 0,
			isDragging: false,
			isApprovePathActive: false
		});
	});

	it('resolves pending app-layer approvals through the shared promise interface', async () => {
		const decisionPromise = requestGate.requestApproval({
			requestVariable: 'approve bulk paint'
		});

		requestGate.resolveApproved(120);

		await expect(decisionPromise).resolves.toBe(true);
	});
});
