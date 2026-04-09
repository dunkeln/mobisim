import { beforeEach, describe, expect, it } from 'vitest';
import { semanticRuntimeState } from '$lib/stores/semantic-runtime';

describe('semanticRuntimeState', () => {
	beforeEach(() => {
		semanticRuntimeState.reset();
	});

	it('applies newer semantic overlay snapshots and records their revision', () => {
		semanticRuntimeState.applyAssetState('audi_r8', {
			overlaySnapshot: {
				overlay: {
					assetId: 'audi_r8',
					revision: 1,
					structuralGeneratedAt: 'struct-1',
					generatedAt: 'overlay-1',
					model: 'test-model',
					minAcceptedConfidence: 0.7,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [],
					discardedSuggestions: []
				},
				overlayRevision: 1,
				overlayStatus: 'fresh'
			}
		});

		semanticRuntimeState.applyAssetState('audi_r8', {
			overlaySnapshot: {
				overlay: {
					assetId: 'audi_r8',
					revision: 2,
					structuralGeneratedAt: 'struct-1',
					generatedAt: 'overlay-2',
					model: 'test-model',
					minAcceptedConfidence: 0.7,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [],
					discardedSuggestions: []
				},
				overlayRevision: 2,
				overlayStatus: 'fresh'
			}
		});

		expect(semanticRuntimeState.getAssetState('audi_r8')).toMatchObject({
			overlayRevision: 2,
			overlayStatus: 'fresh',
			overlay: {
				generatedAt: 'overlay-2',
				revision: 2
			}
		});
	});

	it('ignores older semantic overlay snapshots', () => {
		semanticRuntimeState.applyAssetState('audi_r8', {
			overlaySnapshot: {
				overlay: {
					assetId: 'audi_r8',
					revision: 3,
					structuralGeneratedAt: 'struct-1',
					generatedAt: 'overlay-3',
					model: 'test-model',
					minAcceptedConfidence: 0.7,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [],
					discardedSuggestions: []
				},
				overlayRevision: 3,
				overlayStatus: 'fresh'
			}
		});

		semanticRuntimeState.applyAssetState('audi_r8', {
			overlaySnapshot: {
				overlay: {
					assetId: 'audi_r8',
					revision: 2,
					structuralGeneratedAt: 'struct-1',
					generatedAt: 'overlay-2',
					model: 'test-model',
					minAcceptedConfidence: 0.7,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [],
					discardedSuggestions: []
				},
				overlayRevision: 2,
				overlayStatus: 'fresh'
			}
		});

		expect(semanticRuntimeState.getAssetState('audi_r8')).toMatchObject({
			overlayRevision: 3,
			overlay: {
				generatedAt: 'overlay-3',
				revision: 3
			}
		});
	});

	it('applies status-only snapshots without inventing semantic overlay state', () => {
		semanticRuntimeState.applyAssetState('audi_r8', {
			overlaySnapshot: {
				overlay: null,
				overlayRevision: null,
				overlayStatus: 'stale'
			}
		});

		expect(semanticRuntimeState.getAssetState('audi_r8')).toEqual({
			overlay: null,
			overlayRevision: null,
			overlayStatus: 'stale',
			ingressBindings: []
		});
	});

	it('updates overlay status without clearing an already loaded overlay', () => {
		semanticRuntimeState.applyAssetState('audi_r8', {
			overlaySnapshot: {
				overlay: {
					assetId: 'audi_r8',
					revision: 2,
					structuralGeneratedAt: 'struct-1',
					generatedAt: 'overlay-2',
					model: 'test-model',
					minAcceptedConfidence: 0.7,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [
						{
							id: 'body_shell',
							humanLabel: 'Body Shell',
							aliases: ['outer shell'],
							confidence: 0.9,
							category: 'body_shell',
							supports: ['highlight'],
							nodeIds: ['node-1'],
							materialIds: [],
							meshIds: []
						}
					],
					discardedSuggestions: []
				},
				overlayRevision: 2,
				overlayStatus: 'fresh'
			}
		});

		semanticRuntimeState.applyAssetState('audi_r8', {
			overlayStatus: 'stale'
		});

		expect(semanticRuntimeState.getAssetState('audi_r8')).toMatchObject({
			overlayStatus: 'stale',
			overlayRevision: 2,
			overlay: {
				revision: 2,
				acceptedGroups: [{ id: 'body_shell' }]
			}
		});
	});

	it('applies ingress bindings through the same semantic runtime entrypoint', () => {
		semanticRuntimeState.applyAssetState('audi_r8', {
			ingressBindings: [
				{
					ingressId: 'ingress-body-shell',
					assetId: 'audi_r8',
					structuralGeneratedAt: 'struct-1',
					targetType: 'semantic_group',
					targetId: 'body_shell',
					targetLabel: 'Body Shell',
					transport: 'rest_sse',
					assignedAt: '2026-04-08T00:00:00.000Z',
					assignedBy: 'model',
					restPath: '/api/vehicle-assets/audi_r8/semantic-ingress/ingress-body-shell',
					ssePath: '/api/vehicle-assets/audi_r8/semantic-ingress/ingress-body-shell/events'
				}
			]
		});

		expect(semanticRuntimeState.getAssetState('audi_r8').ingressBindings).toHaveLength(1);
	});
});
