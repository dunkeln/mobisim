import { beforeEach, describe, expect, it } from 'vitest';
import {
	approveBulkApplication,
	approveSemanticIngressApplication,
	applyChatResponse,
	beginFooterResponseCycle,
	prepareSemanticBootstrapForRequest
} from '$lib/components/chat/footer-chat-client';
import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
import { requestGate } from '$lib/stores/request-gate';
import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
import type { FooterChatResponse } from '$lib/server/connectors/openai-chat/types';

function buildResponse(overrides: Partial<FooterChatResponse> = {}): FooterChatResponse {
	return {
		message: {
			role: 'assistant',
			content: 'Updated the footer state.'
		},
		model: 'test-model',
		...overrides
	};
}

describe('footer chat footer lifecycle', () => {
	const assetId = 'audi_r8';

	beforeEach(() => {
		footerSupplementaryList.reset();
		requestGate.reset();
		semanticRuntimeState.reset();
	});

	it('tears down the supplementary footer UI at the start of a new model cycle', () => {
		footerSupplementaryList.set(assetId, {
			active: true,
			entries: {
				Selection: 'selected body shell'
			}
		});

		beginFooterResponseCycle(assetId);

		expect(footerSupplementaryList.getContext(assetId)).toEqual({
			active: false,
			entries: {}
		});
	});

	it('clears the supplementary list when the response does not provide one', () => {
		footerSupplementaryList.set(assetId, {
			active: true,
			entries: {
				Selection: 'selected body shell'
			}
		});

		applyChatResponse(
			buildResponse({
				trace: {
					route: 'llm',
					semanticOverlayStatus: 'fresh',
					toolCalls: [],
					sidebarAction: 'unchanged',
					supplementaryListAction: 'cleared'
				}
			}),
			assetId
		);

		expect(footerSupplementaryList.getContext(assetId)).toEqual({
			active: false,
			entries: {}
		});
	});

	it('hydrates semantic runtime state directly from chat responses', () => {
		applyChatResponse(
			buildResponse({
				semanticOverlayStatus: 'fresh',
				semanticOverlay: {
					assetId: 'audi_r8',
					revision: 2,
					structuralGeneratedAt: 'struct-1',
					generatedAt: 'overlay-1',
					model: 'test-model',
					minAcceptedConfidence: 0.7,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [
						{
							id: 'body_shell',
							humanLabel: 'Body Shell',
							author: 'agent',
							aliases: [],
							confidence: 1,
							category: 'body_shell',
							supports: ['highlight', 'paint'],
							nodeIds: [],
							meshIds: [],
							materialIds: ['material-body']
						}
					],
					discardedSuggestions: []
				},
				semanticIngressBindings: [
					{
						ingressId: 'ingress-body-shell',
						assetId: 'audi_r8',
						structuralGeneratedAt: 'struct-1',
						scope: 'global',
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
			}),
			'audi_r8'
		);

		expect(semanticRuntimeState.getAssetState('audi_r8')).toEqual({
			overlay: {
				assetId: 'audi_r8',
				revision: 2,
				structuralGeneratedAt: 'struct-1',
				generatedAt: 'overlay-1',
				model: 'test-model',
				minAcceptedConfidence: 0.7,
				acceptedMaterials: [],
				acceptedParts: [],
				acceptedGroups: [
					{
						id: 'body_shell',
						humanLabel: 'Body Shell',
						author: 'agent',
						aliases: [],
						confidence: 1,
						category: 'body_shell',
						supports: ['highlight', 'paint'],
						nodeIds: [],
						meshIds: [],
						materialIds: ['material-body']
					}
				],
				discardedSuggestions: []
			},
			overlayStatus: 'fresh',
			ingressBindings: [
				{
					ingressId: 'ingress-body-shell',
					assetId: 'audi_r8',
					structuralGeneratedAt: 'struct-1',
					scope: 'global',
					targetType: 'semantic_group',
					targetId: 'body_shell',
					targetLabel: 'Body Shell',
					transport: 'rest_sse',
					assignedAt: '2026-04-08T00:00:00.000Z',
					assignedBy: 'model',
					restPath: '/api/vehicle-assets/audi_r8/semantic-ingress/ingress-body-shell',
					ssePath: '/api/vehicle-assets/audi_r8/semantic-ingress/ingress-body-shell/events'
				}
			],
			selectedGroupId: null
		});
	});

	it('bootstraps semantic grouping through the app layer before semantic-heavy requests continue', async () => {
		semanticRuntimeState.applyAssetState('audi_r8', {
			overlayStatus: 'missing'
		});

		const decision = prepareSemanticBootstrapForRequest(
			'highlight the wheels',
			'audi_r8',
			(async () =>
				new Response(
					JSON.stringify({
						overlay: {
							assetId: 'audi_r8',
							revision: 3,
							structuralGeneratedAt: 'struct-2',
							generatedAt: 'overlay-2',
							model: 'test-model',
							minAcceptedConfidence: 0.7,
							acceptedMaterials: [],
							acceptedParts: [],
							acceptedGroups: [],
							discardedSuggestions: []
						},
						overlayRevision: 3,
						overlayStatus: 'fresh'
					}),
					{
						status: 200,
						headers: {
							'content-type': 'application/json'
						}
					}
				)) as typeof fetch
		);

		requestGate.resolveApproved(120);
		await expect(decision).resolves.toEqual({ bootstrapApplied: true });
		expect(semanticRuntimeState.getAssetState('audi_r8').overlayStatus).toBe('fresh');
	});

	it('gates bulk response application through the request gate', async () => {
		const decision = approveBulkApplication(
			buildResponse({
				vehiclePatchOperations: Array.from({ length: 12 }, (_, index) => ({
					targetType: 'material' as const,
					targetId: `material-${index}`,
					op: 'set_overlay_highlight' as const,
					value: [0.58, 0.54, 0.86, 1] as [number, number, number, number]
				}))
			})
		);

		requestGate.resolveRejected();
		await expect(decision).resolves.toEqual({
			approved: false,
			blockedMessage: 'Approval declined. No changes were applied.'
		});
	});

	it('gates semantic ingress creation through the shared app-layer request gate', async () => {
		semanticRuntimeState.applyAssetState('audi_r8', {
			selectedGroupId: 'body_shell',
			ingressBindings: []
		});

		const decision = approveSemanticIngressApplication(
			buildResponse({
				semanticIngressMutation: {
					action: 'create',
					targetType: 'semantic_group',
					targetId: 'body_shell',
					targetLabel: 'Body Shell',
					transport: 'rest_sse',
					ingressId: 'semantic_group-body-shell-rest_sse'
				},
				semanticIngressBindings: [
					{
						ingressId: 'semantic_group-body-shell-rest_sse',
						assetId: 'audi_r8',
						structuralGeneratedAt: 'struct-1',
						scope: 'global',
						targetType: 'semantic_group',
						targetId: 'body_shell',
						targetLabel: 'Body Shell',
						transport: 'rest_sse',
						assignedAt: '2026-04-08T00:00:00.000Z',
						assignedBy: 'model',
						restPath: '/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse',
						ssePath:
							'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body-shell-rest_sse/events'
					}
				]
			}),
			'audi_r8'
		);

		requestGate.resolveRejected();
		await expect(decision).resolves.toEqual({
			approved: false,
			blockedMessage: 'Ingress approval declined. No semantic ingress changes were applied.'
		});
	});
});
