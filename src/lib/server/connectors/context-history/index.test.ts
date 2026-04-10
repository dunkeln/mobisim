import { describe, expect, it } from 'vitest';
import { compactResolvedHistoryContext } from './index';

describe('compactResolvedHistoryContext', () => {
	it('keeps current-asset context ahead of user-global context when the budget is tight', () => {
		const result = compactResolvedHistoryContext({
			tokenBudget: 40,
			currentAssetSnapshot: {
				userId: 'email:test@example.com',
				assetId: 'audi_r8',
				selection: [
					{
						targetType: 'node',
						targetId: 'node-wheel-left',
						targetName: 'Front Left Wheel',
						nodeIds: ['node-wheel-left'],
						nodeId: 'node-wheel-left',
						nodeName: 'Front Left Wheel',
						nodePath: 'Car/Wheels/FrontLeft'
					}
				],
				presentation: {
					highlightedTargets: [{ targetId: 'wheel-material', targetType: 'material', targetName: 'Wheel' }]
				},
				recentAliases: ['wheel', 'front left wheel'],
				recentGoalSummary: 'highlight the front-left wheel',
				lastActionSummary: 'Highlighted the front-left wheel.',
				semanticOverlayStatus: 'fresh',
				semanticOverlayRevision: 3,
				updatedAt: '2026-04-08T10:00:00.000Z'
			},
			currentAssetEvents: [
				{
					userId: 'email:test@example.com',
					assetId: 'audi_r8',
					eventAt: '2026-04-08T10:01:00.000Z',
					messageSummary: 'highlight the wheel',
					resultSummary: 'Highlighted the wheel.',
					selection: [],
					aliases: ['wheel']
				}
			],
			userGlobalSnapshot: {
				userId: 'email:test@example.com',
				recentAssetIds: ['audi_r8', 'mini_rov_guardian'],
				stableAliases: ['wheel', 'shell'],
				recentGoalSummaries: ['highlight the wheel'],
				workflowPreferences: ['asset_first_context'],
				updatedAt: '2026-04-08T10:01:00.000Z'
			}
		});

		expect(result.sourceUsed).toBe('current_asset');
		expect(result.currentAssetSummary).toContain('Stored active-asset context');
		expect(result.compactionApplied).toBe(true);
	});

	it('returns user-global context only when no current asset context exists', () => {
		const result = compactResolvedHistoryContext({
			tokenBudget: 200,
			userGlobalSnapshot: {
				userId: 'email:test@example.com',
				recentAssetIds: ['mini_rov_guardian'],
				stableAliases: ['spinner'],
				recentGoalSummaries: ['inspect the spinner shell'],
				workflowPreferences: ['asset_first_context'],
				updatedAt: '2026-04-08T10:02:00.000Z'
			}
		});

		expect(result.sourceUsed).toBe('user_global');
		expect(result.userGlobalSummary).toContain('Stored user-global context');
		expect(result.currentAssetSummary).toBeUndefined();
	});
});
