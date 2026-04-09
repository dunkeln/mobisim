import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyChatResponse,
	beginFooterResponseCycle
} from '$lib/components/chat/footer-chat-client';
import { footerActiveTool } from '$lib/stores/footer-active-tool';
import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
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
	beforeEach(() => {
		footerActiveTool.reset();
		footerSupplementaryList.reset();
		semanticRuntimeState.reset();
	});

	it('tears down tool and supplementary footer UI at the start of a new model cycle', () => {
		footerActiveTool.setFromToolCalls(['set_vehicle_view_mode']);
		footerSupplementaryList.set({
			active: true,
			entries: {
				Selection: 'selected body shell'
			}
		});

		beginFooterResponseCycle();

		expect(footerActiveTool.getSnapshot()).toEqual({
			active: false,
			label: '',
			toolName: null,
			toolLabels: [],
			toolNames: []
		});
		expect(footerSupplementaryList.getContext()).toEqual({
			active: false,
			entries: {}
		});
	});

	it('clears the supplementary list when the response does not provide one', () => {
		footerSupplementaryList.set({
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
			})
		);

		expect(footerSupplementaryList.getContext()).toEqual({
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
			overlayRevision: 2,
			overlayStatus: 'fresh',
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
	});
});
