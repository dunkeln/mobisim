import { describe, expect, it } from 'vitest';
import {
	buildPresentationRestoreFromContext,
	buildPresentationRestoreFromInstruction
} from './footer-chat-restore';

describe('footer chat presentation restore', () => {
	it('does not bleed material restores into targeted highlight clearing', () => {
		const restore = buildPresentationRestoreFromContext('remove highlights for wheels', {
			highlightedTargets: [
				{ targetId: 'material-wheel', targetName: 'Wheel' },
				{ targetId: 'material-headlight', targetName: 'Headlight' }
			],
			materialTargets: [{ targetId: 'material-body', targetName: 'Body Paint' }]
		});

		expect(restore).toEqual({
			highlightedTargetIds: ['material-wheel'],
			label: 'restore original view'
		});
	});

	it('restores material edits only when the request is actually about material state', () => {
		const restore = buildPresentationRestoreFromContext('bring back the body paint', {
			highlightedTargets: [{ targetId: 'material-wheel', targetName: 'Wheel' }],
			materialTargets: [{ targetId: 'material-body', targetName: 'Body Paint' }]
		});

		expect(restore).toEqual({
			materialTargetIds: ['material-body'],
			label: 'restore original view'
		});
	});

	it('restores active isolation from the exact applied hidden and highlight targets', () => {
		const restore = buildPresentationRestoreFromContext('bring it back', {
			activeIntentLabel: 'isolate wheels',
			highlightedTargets: [{ targetId: 'material-wheel', targetName: 'Wheel' }],
			hiddenTargets: [
				{ targetId: 'node-door-left', targetName: 'Left Door' },
				{ targetId: 'node-door-right', targetName: 'Right Door' }
			],
			materialTargets: [{ targetId: 'material-body', targetName: 'Body Paint' }]
		});

		expect(restore).toEqual({
			highlightedTargetIds: ['material-wheel'],
			hiddenTargetIds: ['node-door-left', 'node-door-right'],
			label: 'restore original view'
		});
	});

	it('keeps matching-scope presentation restores constrained to the requested highlight subset', () => {
		const restore = buildPresentationRestoreFromInstruction(
			{
				kind: 'highlights',
				scope: 'matching',
				query: 'wheel'
			},
			{
				highlightedTargets: [
					{ targetId: 'material-wheel', targetName: 'Wheel' },
					{ targetId: 'material-headlight', targetName: 'Headlight' }
				],
				materialTargets: [{ targetId: 'material-body', targetName: 'Body Paint' }]
			}
		);

		expect(restore).toEqual({
			highlightedTargetIds: ['material-wheel'],
			label: 'restore original view'
		});
	});
});
