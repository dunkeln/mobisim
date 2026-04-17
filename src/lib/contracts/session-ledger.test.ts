import { describe, expect, it } from 'vitest';
import { buildSessionLedger } from './session-ledger';

describe('buildSessionLedger', () => {
	it('normalizes and sorts ephemeral session state into a stable key', () => {
		const ledger = buildSessionLedger({
			assetId: 'audi_r8',
			structuralGeneratedAt: '  structural-1  ',
			semanticOverlayStatus: 'fresh',
			semanticOverlayRevision: 4,
			selectedGroupId: '  body_shell  ',
			selectedNodeId: '  node-9  ',
			selectedNodeName: '  Body  ',
			selectedNodePath: '  Scene/Body  ',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-2',
					nodeName: 'B',
					nodePath: 'Scene/B',
					targetId: '  target-b  ',
					targetName: '  B target  ',
					materialIndex: 2
				},
				{
					assetId: 'audi_r8',
					nodeId: 'node-1',
					nodeName: 'A',
					nodePath: 'Scene/A',
					targetId: '  target-a  ',
					targetName: '  A target  ',
					nodeIds: ['node-1', ''],
					anchorNodeId: '  node-1  ',
					materialName: '  Paint  '
				}
			],
			presentation: {
				activeIntentLabel: '  highlight body  ',
				highlightedTargets: [
					{ targetId: 'z', targetName: 'Z', targetType: 'node', operation: 'set_overlay_highlight' },
					{ targetId: 'a', targetName: 'A', targetType: 'material', operation: 'set_overlay_highlight' }
				],
				materialTargets: [
					{ targetId: 'm', targetName: 'M', targetType: 'material', operation: 'set_base_color_factor' }
				],
				hiddenTargets: [
					{ targetId: 'h', targetName: 'H', targetType: 'node', operation: 'set_visibility' }
				],
				viewerModes: ['uv_debug', 'wireframe']
			},
			sidebar: {
				active: true,
				cards: [
					{
						title: '  Zeta  ',
						entries: { b: '2', a: '1' }
					},
					{
						title: 'Alpha',
						entries: { c: '3' }
					}
				]
			},
			supplementaryList: {
				active: true,
				entries: { b: '2', a: '1' }
			}
		});

		expect(ledger.structuralGeneratedAt).toBe('structural-1');
		expect(ledger.selectedGroupId).toBe('body_shell');
		expect(ledger.selectedNodes?.[0]?.nodeId).toBe('node-1');
		expect(ledger.selectedNodes?.[0]?.materialName).toBe('Paint');
		expect(ledger.contextKey).toContain('"assetId":"audi_r8"');
		expect(ledger.contextKey).toContain('"selectedGroupId":"body_shell"');
		expect(ledger.contextKey).toContain('"viewerModes":["uv_debug","wireframe"]');
	});

	it('treats equivalent ephemeral state as the same ledger key', () => {
		const first = buildSessionLedger({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'scene-1',
			semanticOverlayStatus: 'fresh',
			semanticOverlayRevision: 1,
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-2',
					nodeName: 'B',
					nodePath: 'Scene/B'
				},
				{
					assetId: 'audi_r8',
					nodeId: 'node-1',
					nodeName: 'A',
					nodePath: 'Scene/A'
				}
			]
		});
		const second = buildSessionLedger({
			assetId: 'audi_r8',
			structuralGeneratedAt: ' scene-1 ',
			semanticOverlayStatus: 'fresh',
			semanticOverlayRevision: 1,
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-1',
					nodeName: 'A',
					nodePath: 'Scene/A'
				},
				{
					assetId: 'audi_r8',
					nodeId: 'node-2',
					nodeName: 'B',
					nodePath: 'Scene/B'
				}
			]
		});

		expect(first.contextKey).toBe(second.contextKey);
	});

	it('keeps the session key stable when only sidebar or supplementary state changes', () => {
		const base = buildSessionLedger({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'scene-1',
			semanticOverlayStatus: 'fresh',
			semanticOverlayRevision: 1,
			selectedGroupId: 'body_shell',
			sidebar: {
				active: true,
				cards: [
					{
						title: 'First',
						entries: {
							a: '1'
						}
					}
				]
			},
			supplementaryList: {
				active: true,
				entries: {
					a: '1'
				}
			}
		});
		const changedSidebar = buildSessionLedger({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'scene-1',
			semanticOverlayStatus: 'fresh',
			semanticOverlayRevision: 1,
			selectedGroupId: 'body_shell',
			sidebar: {
				active: true,
				cards: [
					{
						title: 'Second',
						entries: {
							b: '2'
						}
					}
				]
			},
			supplementaryList: {
				active: true,
				entries: {
					b: '2'
				}
			}
		});

		expect(base.contextKey).toBe(changedSidebar.contextKey);
	});
});
