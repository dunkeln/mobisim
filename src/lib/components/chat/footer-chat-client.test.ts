import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
	approveChatResponseApplication,
	approveBulkApplication,
	approveSemanticMutation,
	applyChatResponse,
	beginFooterResponseCycle,
	getAppliedChatResponseMessage,
	prepareSemanticBootstrapForRequest
} from '$lib/components/chat/footer-chat-client';
import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
import { requestGate } from '$lib/stores/request-gate';
import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
import { vehiclePatchState } from '$lib/stores/vehicle-patches';
import { vehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { FooterChatResponse } from '$lib/server/connectors/openai-chat/types';
import { getSelectedNodeContext } from '$lib/components/chat/footer-chat-client';

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
		vehiclePatchState.reset();
		vehicleNodeSelection.clear();
	});

	it('tears down the supplementary footer UI at the start of a new model cycle', () => {
		footerSupplementaryList.set(assetId, {
			active: true,
			entries: {
				Selection: 'selected body shell'
			}
		}, 'ledger-a');

		beginFooterResponseCycle(assetId);

		expect(footerSupplementaryList.getContext(assetId, 'ledger-a')).toEqual({
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
		}, 'ledger-a');

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
			assetId,
			'ledger-a'
		);

		expect(footerSupplementaryList.getContext(assetId, 'ledger-a')).toEqual({
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
				selectedGroupId: 'body_shell'
			}),
			'audi_r8',
			'ledger-a'
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
			overlayRevision: 2,
			selectedGroupId: 'body_shell'
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

	it('gates semantic overlay deletion through the request gate', async () => {
		const decision = approveSemanticMutation(
			buildResponse({
				trace: {
					route: 'llm',
					semanticOverlayStatus: 'fresh',
					toolCalls: ['edit_vehicle_semantics'],
					executedToolDomain: 'semantics',
					executedAction: 'delete_overlay',
					destructiveScope: 'overlay_delete',
					approvalSummary: 'Delete semantic overlay for this asset?',
					sidebarAction: 'unchanged',
					supplementaryListAction: 'unchanged'
				}
			})
		);

		requestGate.resolveRejected();
		await expect(decision).resolves.toEqual({
			approved: false,
			blockedMessage: 'Approval declined. No changes were applied.'
		});
	});

	it('gates semantic group deletion through the request gate', async () => {
		const decision = approveSemanticMutation(
			buildResponse({
				trace: {
					route: 'llm',
					semanticOverlayStatus: 'fresh',
					toolCalls: ['edit_vehicle_semantics'],
					executedToolDomain: 'semantics',
					executedAction: 'delete_group',
					destructiveScope: 'group_delete',
					approvalSummary: 'Delete semantic group "Body Shell"?',
					sidebarAction: 'unchanged',
					supplementaryListAction: 'unchanged'
				}
			})
		);

		requestGate.resolveRejected();
		await expect(decision).resolves.toEqual({
			approved: false,
			blockedMessage: 'Approval declined. No changes were applied.'
		});
	});

	it('gates broad semantic reassignment through the request gate', async () => {
		const decision = approveSemanticMutation(
			buildResponse({
				trace: {
					route: 'llm',
					semanticOverlayStatus: 'fresh',
					toolCalls: ['edit_vehicle_semantics'],
					executedToolDomain: 'semantics',
					executedAction: 'reassign',
					affectedTargetCount: 13,
					destructiveScope: 'broad_membership_mutation',
					approvalSummary: 'Apply semantic reassignment across 13 targets?',
					sidebarAction: 'unchanged',
					supplementaryListAction: 'unchanged'
				}
			})
		);

		requestGate.resolveRejected();
		await expect(decision).resolves.toEqual({
			approved: false,
			blockedMessage: 'Approval declined. No changes were applied.'
		});
	});

	it('bypasses semantic approval for narrow semantic mutations', async () => {
		await expect(
			approveSemanticMutation(
				buildResponse({
					trace: {
						route: 'llm',
						semanticOverlayStatus: 'fresh',
						toolCalls: ['edit_vehicle_semantics'],
						executedToolDomain: 'semantics',
						executedAction: 'assign',
						affectedTargetCount: 2,
						destructiveScope: 'none',
						sidebarAction: 'unchanged',
						supplementaryListAction: 'unchanged'
					}
				})
			)
		).resolves.toEqual({ approved: true });
	});

	it('bypasses semantic approval when metadata is missing', async () => {
		await expect(
			approveSemanticMutation(
				buildResponse({
					trace: {
						route: 'llm',
						semanticOverlayStatus: 'fresh',
						toolCalls: ['edit_vehicle_semantics'],
						sidebarAction: 'unchanged',
						supplementaryListAction: 'unchanged'
					}
				})
			)
		).resolves.toEqual({ approved: true });
	});

	it('blocks the full apply path when semantic destructive approval is rejected', async () => {
		const payload = buildResponse({
			semanticOverlayStatus: 'missing',
			semanticOverlay: null,
			supplementaryList: {
				active: true,
				entries: {
					Status: 'deleted'
				}
			},
			trace: {
				route: 'llm',
				semanticOverlayStatus: 'missing',
				toolCalls: ['edit_vehicle_semantics'],
				executedToolDomain: 'semantics',
				executedAction: 'delete_overlay',
				destructiveScope: 'overlay_delete',
				approvalSummary: 'Delete semantic overlay for this asset?',
				sidebarAction: 'unchanged',
				supplementaryListAction: 'updated'
			}
		});

		const decision = approveChatResponseApplication(payload);
		await Promise.resolve();
		requestGate.resolveRejected();
		await expect(decision).resolves.toEqual({
			approved: false,
			blockedMessage: 'Approval declined. No changes were applied.'
		});

		expect(semanticRuntimeState.getAssetState(assetId).overlayStatus).toBe('unknown');
		expect(footerSupplementaryList.getContext(assetId, 'ledger-a')).toEqual({
			active: false,
			entries: {}
		});
	});

	it('uses the most recently selected node as the primary selection context', () => {
		vehicleNodeSelection.select({
			assetId,
			targetType: 'node',
			targetId: 'node-older',
			targetName: 'Older Node',
			nodeIds: ['node-older'],
			nodeId: 'node-older',
			nodeName: 'Older Node',
			nodePath: 'Scene/Older'
		});
		vehicleNodeSelection.select(
			{
				assetId,
				targetType: 'node',
				targetId: 'node-current',
				targetName: 'Current Node',
				nodeIds: ['node-current'],
				nodeId: 'node-current',
				nodeName: 'Current Node',
				nodePath: 'Scene/Current'
			},
			true
		);

		expect(getSelectedNodeContext(assetId)).toEqual({
			assetId,
			selectedNodeId: 'node-current',
			selectedNodeName: 'Current Node',
			selectedNodePath: 'Scene/Current',
			selectedNodes: [
				{
					assetId,
					targetType: 'node',
					targetId: 'node-older',
					targetName: 'Older Node',
					nodeIds: ['node-older'],
					nodeId: 'node-older',
					nodeName: 'Older Node',
					nodePath: 'Scene/Older'
				},
				{
					assetId,
					targetType: 'node',
					targetId: 'node-current',
					targetName: 'Current Node',
					nodeIds: ['node-current'],
					nodeId: 'node-current',
					nodeName: 'Current Node',
					nodePath: 'Scene/Current'
				}
			]
		});
	});

	it('derives undo confirmations from the confirmed local action instead of model phrasing', () => {
		expect(
			getAppliedChatResponseMessage(
				buildResponse({
					message: {
						role: 'assistant',
						content: 'Everything has definitely been restored.'
					},
					historyAction: 'undo'
				})
			)
		).toBe('The most recent change was reverted.');
	});

	it('derives targeted restore confirmations from the applied restore instruction', () => {
		expect(
			getAppliedChatResponseMessage(
				buildResponse({
					message: {
						role: 'assistant',
						content: 'All visuals are back to normal.'
					},
					presentationRestore: {
						hiddenTargetIds: ['wheel_front_left'],
						label: 'restore original view'
					}
				})
			)
		).toBe('Restored 1 hidden node region(s).');
	});

	it('returns restore confirmations from the verified local delta instead of the optimistic restore payload', () => {
		vehiclePatchState.apply(assetId, {
			kind: 'operations',
			intentLabel: 'highlight wheel',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-wheel-left',
					targetName: 'Wheel Left',
					op: 'set_overlay_highlight',
					value: [0.58, 0.54, 0.86, 1]
				}
			]
		});

		expect(
			applyChatResponse(
				buildResponse({
					presentationRestore: {
						highlightedTargetIds: ['material-wheel-left', 'material-door-left'],
						label: 'restore original view'
					}
				}),
				assetId,
				'ledger-a'
			)
		).toBe('Cleared 1 highlight region(s).');
	});

	it('clears the active semantic group when a chat response clears highlights', () => {
		semanticRuntimeState.applyAssetState(assetId, {
			selectedGroupId: 'wheels'
		});
		vehiclePatchState.apply(assetId, {
			kind: 'set_highlights',
			intentLabel: 'select wheels',
			operations: [
				{
					targetType: 'node',
					targetId: 'node-wheel-left',
					targetName: 'wheels',
					op: 'set_overlay_highlight',
					value: [0.58, 0.54, 0.86, 1]
				}
			]
		});

		applyChatResponse(
			buildResponse({
				historyAction: 'clear_highlights'
			}),
			assetId,
			'ledger-a'
		);

		expect(semanticRuntimeState.getAssetState(assetId).selectedGroupId).toBeNull();
	});

	it('notes when viewer modes remain active after clearing highlight overlays', () => {
		vehiclePatchState.apply(assetId, {
			kind: 'operations',
			intentLabel: 'wireframe on',
			operations: [
				{
					targetType: 'viewer',
					targetId: 'wireframe',
					op: 'set_enabled',
					value: true
				}
			]
		});
		vehiclePatchState.apply(assetId, {
			kind: 'operations',
			intentLabel: 'highlight wheel',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-wheel-left',
					targetName: 'Wheel Left',
					op: 'set_overlay_highlight',
					value: [0.58, 0.54, 0.86, 1]
				}
			]
		});

		expect(
			applyChatResponse(
				buildResponse({
					historyAction: 'clear_highlights'
				}),
				assetId,
				'ledger-a'
			)
		).toBe('Cleared 1 highlight region(s). wireframe view remains active.');
	});

	it('preserves material edits when restore-all resets the view', () => {
		vehiclePatchState.apply(assetId, {
			kind: 'operations',
			intentLabel: 'paint and isolate',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-body',
					targetName: 'Body',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				},
				{
					targetType: 'node',
					targetId: 'node-door-left',
					targetName: 'Left Door',
					op: 'set_alpha',
					value: 0.08
				},
				{
					targetType: 'material',
					targetId: 'material-glass',
					targetName: 'Glass',
					op: 'set_alpha',
					value: 0.12
				}
			]
		});

		expect(
			applyChatResponse(
				buildResponse({
					presentationRestore: {
						restoreAll: true,
						label: 'restore original view'
					}
				}),
				assetId,
				'ledger-a'
			)
		).toBe('Restored the vehicle to its original view while preserving paint and finish edits.');
		const state = get(vehiclePatchState);
		expect(state.presentation.materialOperations).toHaveLength(1);
		expect(state.presentation.nodeVisibilityOperations).toHaveLength(0);
	});
});
