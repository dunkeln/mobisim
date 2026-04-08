import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();
const resolveVehicleIntentMock = vi.fn();
const planNormalizedVehiclePaintIntentMock = vi.fn();
const annotateVehicleSemanticGroupMock = vi.fn();
const deriveVehicleInspectionCapabilitiesMock = vi.fn();
const deriveStructuralAssetSnapshotMock = vi.fn();
const readVehicleSemanticOverlayMock = vi.fn();
const generateVehicleSemanticOverlayMock = vi.fn();
const getVehicleSemanticOverlayStatusMock = vi.fn();
const assignSemanticIngressMock = vi.fn();
const mutateVehicleSemanticAssignmentMock = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: {
		OPENAI_API_KEY: 'test-key',
		OPENAI_MODEL: 'gpt-5.2'
	}
}));

vi.mock('openai', () => {
	class APIError extends Error {}

	class OpenAI {
		static APIError = APIError;
		chat = {
			completions: {
				create: createMock
			}
		};
	}

	return { default: OpenAI };
});

vi.mock('$lib/server/connectors/vehicle-intents', () => ({
	isVehicleEditRequest: (message: string) =>
		/\b(paint|tint|highlight|select|selected|choose|pick|headlight|wireframe|xray|x-ray|postprocess)\b/i.test(
			message
		),
	resolveVehicleIntent: resolveVehicleIntentMock,
	planNormalizedVehiclePaintIntent: planNormalizedVehiclePaintIntentMock
}));

vi.mock('$lib/server/connectors/gltf-preprocess', () => ({
	deriveVehicleInspectionCapabilities: deriveVehicleInspectionCapabilitiesMock
}));

vi.mock('$lib/server/connectors/gltf-structure', () => ({
	deriveStructuralAssetSnapshot: deriveStructuralAssetSnapshotMock
}));

vi.mock('$lib/server/connectors/vehicle-semantic-overlay', () => ({
	getVehicleSemanticOverlayStatus: getVehicleSemanticOverlayStatusMock,
	readVehicleSemanticOverlay: readVehicleSemanticOverlayMock,
	generateVehicleSemanticOverlay: generateVehicleSemanticOverlayMock,
	annotateVehicleSemanticGroup: annotateVehicleSemanticGroupMock,
	mutateVehicleSemanticAssignment: mutateVehicleSemanticAssignmentMock,
	refreshVehicleSemanticOverlayInBackground: vi.fn()
}));

vi.mock('$lib/server/connectors/semantic-ingress', () => ({
	assignSemanticIngress: assignSemanticIngressMock
}));

describe('createFooterChatResponse', () => {
	beforeEach(() => {
		createMock.mockReset();
		resolveVehicleIntentMock.mockReset();
		planNormalizedVehiclePaintIntentMock.mockReset();
		annotateVehicleSemanticGroupMock.mockReset();
		deriveVehicleInspectionCapabilitiesMock.mockReset();
		deriveStructuralAssetSnapshotMock.mockReset();
		readVehicleSemanticOverlayMock.mockReset();
		generateVehicleSemanticOverlayMock.mockReset();
		getVehicleSemanticOverlayStatusMock.mockReset();
		assignSemanticIngressMock.mockReset();
		mutateVehicleSemanticAssignmentMock.mockReset();
	});

	it('refreshes semantic overlays through the chat tool loop', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('missing');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		generateVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'semantic-1',
			structuralGeneratedAt: 'structural-1',
			acceptedMaterials: [{ targetId: 'material-1' }],
			acceptedParts: [],
			acceptedGroups: [],
			discardedSuggestions: []
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-1',
									type: 'function',
									function: {
										name: 'refresh_vehicle_semantics',
										arguments: JSON.stringify({ force: true })
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Semantic overlay refreshed.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'refresh the semantic overlay for this asset'
		});

		expect(generateVehicleSemanticOverlayMock).toHaveBeenCalledWith('audi_r8', { force: true });
		expect(response.message.content).toBe('Semantic overlay refreshed.');
	});

	it('does not auto-refresh semantics during normal edit requests', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-2'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('missing');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-9',
					op: 'set_base_color_factor',
					value: [0.2, 0.1, 0.4, 1]
				}
			],
			rejected: [],
			summary: 'Applied body paint.'
		});
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'I could not apply that directly from the current reasoning pass.'
					}
				}
			]
		});
		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'paint the body midnight purple'
		});

		expect(generateVehicleSemanticOverlayMock).not.toHaveBeenCalled();
		expect(createMock).toHaveBeenCalledTimes(1);
		expect(resolveVehicleIntentMock).toHaveBeenCalledWith(
			'audi_r8',
			'paint the body midnight purple'
		);
		expect(response.vehiclePatchLabel).toBe('Applied body paint.');
		expect(response.vehiclePatchOperations).toHaveLength(1);
		expect(response.message.content).toBe('Applied body paint.');
		expect(response.trace).toEqual({
			route: 'direct_edit',
			semanticOverlayStatus: 'missing',
			toolCalls: [],
			sidebarAction: 'unchanged',
			supplementaryListAction: 'unchanged'
		});
	});

	it('routes structured paint intents through the appearance tool catalog', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-3'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		planNormalizedVehiclePaintIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			resolvedColor: [0.22, 0.12, 0.34, 1],
			operations: [
				{
					targetType: 'material',
					targetId: 'material-9',
					op: 'set_base_color_factor',
					value: [0.22, 0.12, 0.34, 1]
				},
				{
					targetType: 'material',
					targetId: 'material-9',
					op: 'set_metalness_factor',
					value: 1
				}
			],
			rejected: [],
			summary: 'Applied chrome body paint to 1 material region(s).'
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-3',
									type: 'function',
									function: {
										name: 'apply_vehicle_appearance_intent',
										arguments: JSON.stringify({
											colorFamily: 'purple',
											shade: 'dark',
											finish: 'chrome',
											saturation: 'balanced'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Applied the requested chrome purple finish.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'make the body dark purple chrome'
		});

		expect(planNormalizedVehiclePaintIntentMock).toHaveBeenCalledWith('audi_r8', {
			colorFamily: 'purple',
			shade: 'dark',
			finish: 'chrome',
			saturation: 'balanced',
			hex: undefined
		});
		expect(resolveVehicleIntentMock).not.toHaveBeenCalled();
		expect(response.vehiclePatchOperations).toHaveLength(2);
		expect(response.vehiclePatchLabel).toBe('Applied chrome body paint to 1 material region(s).');
	});

	it('can scope focus tool execution to the selected material region only', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-3b'
		});
		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-3b',
			nodes: [
				{ id: 'node-12', meshId: 'mesh-1' },
				{ id: 'node-13', meshId: 'mesh-2' }
			],
			meshes: [
				{
					id: 'mesh-1',
					materialIds: ['material-9'],
					materialNames: ['Glass']
				},
				{
					id: 'mesh-2',
					materialIds: ['material-10'],
					materialNames: ['Lamp']
				}
			]
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-9',
					op: 'set_overlay_highlight',
					value: [0.2, 0.1, 0.4, 1]
				},
				{
					targetType: 'material',
					targetId: 'material-10',
					op: 'set_overlay_highlight',
					value: [0.2, 0.1, 0.4, 1]
				}
			],
			rejected: [],
			summary: 'Highlighted 2 matching material region(s).'
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-3b',
									type: 'function',
									function: {
										name: 'apply_vehicle_focus_intent',
										arguments: JSON.stringify({
											request: 'highlight these',
											scope: 'selection'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Highlighted the selected region.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'highlight these',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-12',
					nodeName: 'Glass',
					nodePath: 'Scene/Glass',
					materialIndex: 0,
					materialName: 'Glass'
				}
			]
		});

		expect(resolveVehicleIntentMock).toHaveBeenCalledWith('audi_r8', 'highlight these');
		expect(response.vehiclePatchOperations).toEqual([
			{
				targetType: 'material',
				targetId: 'material-9',
				op: 'set_overlay_highlight',
				value: [0.2, 0.1, 0.4, 1]
			}
		]);
	});

	it('treats select phrasing as visual focus guidance in the developer prompt', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-select-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [],
			rejected: [],
			summary: 'No valid highlight targets were accepted.'
		});
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'Understood.'
					}
				}
			]
		});

		await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'select that wheel'
		});

		const developerPrompt = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content;
		expect(typeof developerPrompt).toBe('string');
		expect(developerPrompt).toContain(
			'When the user says select, selected, pick, choose, call out, or mark while referring to a visible region or the current selection, prefer the focus tool unless they are explicitly asking for semantic grouping, selection expansion, or a viewer mode.'
		);
		expect(developerPrompt).toContain(
			'focus tool: highlight, focus, isolate, select, pick out, choose, remove, bring out'
		);
	});

	it('applies viewer mode requests directly when the deterministic executor already understands them', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-view-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('unknown');
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [
				{
					targetType: 'viewer',
					targetId: 'xray',
					op: 'set_enabled',
					value: true
				}
			],
			rejected: [],
			summary: 'Enabled xray view.'
		});
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'I could not apply xray from the current reasoning pass.'
					}
				}
			]
		});
		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'turn on xray'
		});

		expect(createMock).toHaveBeenCalledTimes(1);
		expect(resolveVehicleIntentMock).toHaveBeenCalledWith('audi_r8', 'turn on xray');
		expect(response.vehiclePatchOperations).toEqual([
			{
				targetType: 'viewer',
				targetId: 'xray',
				op: 'set_enabled',
				value: true
			}
		]);
	});

	it('grounds chat requests with active presentation context when highlights or viewer modes are already applied', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-context-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'I can work from the current highlight and xray context.'
					}
				}
			]
		});

		await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'what is highlighted right now?',
			presentation: {
				activeIntentLabel: 'highlight body shell',
				highlightedTargets: [
					{
						targetId: 'material-body-shell',
						targetName: 'Body Shell'
					}
				],
				materialTargets: [
					{
						targetId: 'material-headlight',
						targetName: 'Headlight Lens',
						operation: 'set_emissive_factor'
					}
				],
				hiddenTargets: [
					{
						targetId: 'node-door-left',
						targetName: 'Left Door'
					}
				],
				viewerModes: ['xray']
			}
		});

		expect(createMock).toHaveBeenCalledTimes(1);
		const firstRequest = createMock.mock.calls[0]?.[0];
		const developerPrompt = firstRequest?.messages?.[0]?.content;
		expect(developerPrompt).toContain('Active presentation intent: highlight body shell.');
		expect(developerPrompt).toContain(
			'Active highlighted material regions: material-body-shell (Body Shell).'
		);
		expect(developerPrompt).toContain(
			'Active material edits: material-headlight (Headlight Lens) via set_emissive_factor.'
		);
		expect(developerPrompt).toContain('Active hidden runtime nodes: node-door-left (Left Door).');
		expect(developerPrompt).toContain('Active viewer modes: xray.');
	});

	it('includes current sidebar state in the developer prompt', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-sidebar-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'Sidebar acknowledged.'
					}
				}
			]
		});

		await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'what is the current inspection state?',
			sidebar: {
				active: true,
				cards: [
					{
						title: 'Focus',
						entries: {
							target: 'Body Shell',
							status: 'Active'
						}
					}
				]
			}
		});

		const firstRequest = createMock.mock.calls[0]?.[0];
		const developerPrompt = firstRequest?.messages?.[0]?.content;
		expect(developerPrompt).toContain(
			'Intent sidebar is active with cards: Focus [target: Body Shell; status: Active].'
		);
		expect(createMock).toHaveBeenCalledTimes(1);
	});

	it('grounds the model with the latest semantic overlay summary and sidebar cadence', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-semantic-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'semantic-1',
			structuralGeneratedAt: 'structural-semantic-1',
			model: 'gpt-5.2',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [
				{
					targetType: 'material',
					targetId: 'material-body',
					targetName: 'Paint_Body',
					humanLabel: 'Body Paint',
					aliases: ['shell'],
					semanticTags: ['body_paint_candidate'],
					confidence: 0.92
				}
			],
			acceptedParts: [
				{
					id: 'part-shell',
					humanLabel: 'Body Shell',
					aliases: ['shell'],
					confidence: 0.93,
					category: 'body',
					nodeIds: ['node-1'],
					meshIds: ['mesh-1'],
					materialIds: ['material-body'],
					region: 'full',
					side: 'center'
				}
			],
			acceptedGroups: [
				{
					id: 'group-shell',
					humanLabel: 'Body Shell',
					aliases: ['shell'],
					confidence: 0.95,
					category: 'body_shell',
					supports: ['highlight', 'paint'],
					nodeIds: ['node-1'],
					meshIds: ['mesh-1'],
					materialIds: ['material-body'],
					derivedFrom: ['llm']
				}
			],
			discardedSuggestions: []
		});
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'Semantic summary acknowledged.'
					}
				}
			]
		});

		await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'what semantic groups are available for this asset?'
		});

		const firstRequest = createMock.mock.calls[0]?.[0];
		const developerPrompt = firstRequest?.messages?.[0]?.content;
		expect(developerPrompt).toContain('Semantic overlay status for the active asset: fresh.');
		expect(developerPrompt).toContain(
			'Latest semantic overlay summary: generated semantic-1; structural basis structural-semantic-1; accepted materials 1; accepted parts 1; accepted groups 1; top groups Body Shell; top material tags body_paint_candidate (1).'
		);
		expect(developerPrompt).toContain(
			'Semantic panel inventory available for tool grounding: Body Shell [group-shell] -> Body Shell [part-shell]. Group and node labels from this inventory are valid grounding terms for semantic tool calls, semantic ingress targets, and freeform semantic requests.'
		);
		expect(developerPrompt).toContain(
			'Semantic sidebar cadence: semantic grounding is central right now and a single concise Semantics summary card may help if it reduces ambiguity.'
		);
	});

	it('reports tool usage and sidebar updates in the response trace', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-trace-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-sidebar-1',
									type: 'function',
									function: {
										name: 'set_intent_sidebar',
										arguments: JSON.stringify({
											active: true,
											cards: [
												{
													title: 'Semantics',
													entries: {
														status: 'fresh',
														groups: 4
													}
												}
											]
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Semantic cache looks current.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'summarize the semantic state',
			sidebar: {
				active: false,
				cards: []
			}
		});

		expect(response.trace).toEqual({
			route: 'llm',
			semanticOverlayStatus: 'fresh',
			toolCalls: ['set_intent_sidebar'],
			sidebarAction: 'updated',
			supplementaryListAction: 'unchanged'
		});
		expect(response.sidebar).toEqual({
			active: true,
			cards: [
				{
					title: 'Semantics',
					entries: {
						status: 'fresh',
						groups: 4
					}
				}
			]
		});
	});

	it('reports supplementary footer list updates in the response trace', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-supplementary-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-supplementary-1',
									type: 'function',
									function: {
										name: 'set_supplementary_reference_list',
										arguments: JSON.stringify({
											active: true,
											items: ['Wheels selected', 'Bronze paint applied', 'Front quarter focus']
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Shell updated. Refer to the footer list for the active targets.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'summarize the active targets quietly',
			supplementaryList: {
				active: false,
				items: []
			}
		});

		expect(response.trace).toEqual({
			route: 'llm',
			semanticOverlayStatus: 'fresh',
			toolCalls: ['set_supplementary_reference_list'],
			sidebarAction: 'unchanged',
			supplementaryListAction: 'updated'
		});
		expect(response.supplementaryList).toEqual({
			active: true,
			items: ['Wheels selected', 'Bronze paint applied', 'Front quarter focus']
		});
	});

	it('assigns semantic ingress through the chat tool loop', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-ingress-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'semantic-1',
			structuralGeneratedAt: 'structural-ingress-1',
			model: 'gpt-5.2',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [],
			discardedSuggestions: []
		});
		assignSemanticIngressMock.mockResolvedValue({
			ingressId: 'semantic_group-body_shell-rest_sse',
			assetId: 'audi_r8',
			structuralGeneratedAt: 'structural-ingress-1',
			targetType: 'semantic_group',
			targetId: 'body_shell',
			targetLabel: 'Body Shell',
			transport: 'rest_sse',
			assignedAt: '2026-04-07T00:00:00.000Z',
			assignedBy: 'model',
			restPath: '/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body_shell-rest_sse',
			ssePath:
				'/api/vehicle-assets/audi_r8/semantic-ingress/semantic_group-body_shell-rest_sse/events'
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-ingress-1',
									type: 'function',
									function: {
										name: 'assign_semantic_ingress',
										arguments: JSON.stringify({
											targetType: 'semantic_group',
											targetId: 'body_shell',
											targetLabel: 'Body Shell',
											transport: 'rest_sse'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Ingress assigned for Body Shell.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'assign a rest and sse ingress for the body shell semantic group'
		});

		expect(assignSemanticIngressMock).toHaveBeenCalledWith({
			assetId: 'audi_r8',
			targetType: 'semantic_group',
			targetId: 'body_shell',
			targetLabel: 'Body Shell',
			transport: 'rest_sse',
			assignedBy: 'model'
		});
		expect(response.trace?.toolCalls).toEqual(['assign_semantic_ingress']);
		expect(response.message.content).toBe('Ingress assigned for Body Shell.');
	});

	it('restores targeted hidden nodes through the presentation restore tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-restore-hidden'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-restore-hidden',
									type: 'function',
									function: {
										name: 'restore_vehicle_presentation',
										arguments: JSON.stringify({
											kind: 'hidden',
											scope: 'matching',
											query: 'wheel'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Wheel visibility restored.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'bring the wheels back',
			presentation: {
				hiddenTargets: [
					{
						targetId: 'node-wheel-left',
						targetName: 'Left Wheel'
					},
					{
						targetId: 'node-door-left',
						targetName: 'Left Door'
					}
				]
			}
		});

		expect(resolveVehicleIntentMock).not.toHaveBeenCalled();
		expect(response.presentationRestore).toEqual({
			hiddenTargetIds: ['node-wheel-left'],
			label: 'restore original view'
		});
		expect(response.trace?.toolCalls).toEqual(['restore_vehicle_presentation']);
	});

	it('restores the full active presentation context for make it normal again through the presentation tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-restore-all'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-restore-all',
									type: 'function',
									function: {
										name: 'restore_vehicle_presentation',
										arguments: JSON.stringify({
											kind: 'all',
											scope: 'all'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Presentation restored to normal.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'make it normal again',
			presentation: {
				highlightedTargets: [{ targetId: 'material-wheel', targetName: 'Wheel' }],
				materialTargets: [{ targetId: 'material-body', targetName: 'Body' }],
				hiddenTargets: [{ targetId: 'node-wheel-left', targetName: 'Left Wheel' }],
				viewerModes: ['xray']
			}
		});

		expect(resolveVehicleIntentMock).not.toHaveBeenCalled();
		expect(response.presentationRestore).toEqual({
			restoreAll: true,
			label: 'restore original view'
		});
		expect(response.trace?.toolCalls).toEqual(['restore_vehicle_presentation']);
	});

	it('restores semantic material drift like shell removals through the presentation restore tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-restore-material'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-restore-material',
									type: 'function',
									function: {
										name: 'restore_vehicle_presentation',
										arguments: JSON.stringify({
											kind: 'materials',
											scope: 'matching',
											query: 'shell'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Shell material restored.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'bring back the shell',
			presentation: {
				activeIntentLabel: 'Removed body shell by reducing matched-part alpha.',
				materialTargets: [
					{
						targetId: 'material-body-shell',
						targetName: 'Paint_Body (body shell)',
						operation: 'set_alpha'
					}
				]
			}
		});

		expect(resolveVehicleIntentMock).not.toHaveBeenCalled();
		expect(response.presentationRestore).toEqual({
			materialTargetIds: ['material-body-shell'],
			label: 'restore original view'
		});
		expect(response.trace?.toolCalls).toEqual(['restore_vehicle_presentation']);
	});

	it('clears highlighted regions from active presentation context through the presentation restore tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-restore-highlight'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-restore-highlight',
									type: 'function',
									function: {
										name: 'restore_vehicle_presentation',
										arguments: JSON.stringify({
											kind: 'highlights',
											scope: 'all'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Highlights cleared.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'unhighlight the regions',
			presentation: {
				highlightedTargets: [
					{ targetId: 'material-lamp-left', targetName: 'Lamp Left' },
					{ targetId: 'material-lamp-right', targetName: 'Lamp Right' }
				]
			}
		});

		expect(resolveVehicleIntentMock).not.toHaveBeenCalled();
		expect(response.presentationRestore).toEqual({
			highlightedTargetIds: ['material-lamp-left', 'material-lamp-right'],
			label: 'restore original view'
		});
		expect(response.trace?.toolCalls).toEqual(['restore_vehicle_presentation']);
	});

	it('uses the presentation restore tool to clear all active highlights from inferred wording', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-restore-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-restore-1',
									type: 'function',
									function: {
										name: 'restore_vehicle_presentation',
										arguments: JSON.stringify({
											kind: 'highlights',
											scope: 'all'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Current highlight overlays cleared.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'drop all current highlight overlays',
			presentation: {
				highlightedTargets: [
					{ targetId: 'material-wheel-left', targetName: 'Wheel Left' },
					{ targetId: 'material-wheel-right', targetName: 'Wheel Right' }
				]
			}
		});

		expect(response.presentationRestore).toEqual({
			highlightedTargetIds: ['material-wheel-left', 'material-wheel-right'],
			label: 'restore original view'
		});
		expect(response.trace?.toolCalls).toEqual(['restore_vehicle_presentation']);
		expect(response.message.content).toBe('Current highlight overlays cleared.');
	});

	it('uses the presentation restore tool to clear only matching highlighted regions', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-restore-2'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue(null);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-restore-2',
									type: 'function',
									function: {
										name: 'restore_vehicle_presentation',
										arguments: JSON.stringify({
											kind: 'highlights',
											scope: 'matching',
											query: 'wheel'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Wheel highlight removed.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'strip the wheel emphasis from the current view',
			presentation: {
				highlightedTargets: [
					{ targetId: 'material-wheel-left', targetName: 'Wheel Left' },
					{ targetId: 'material-door-left', targetName: 'Door Left' }
				]
			}
		});

		expect(response.presentationRestore).toEqual({
			highlightedTargetIds: ['material-wheel-left'],
			label: 'restore original view'
		});
		expect(response.trace?.toolCalls).toEqual(['restore_vehicle_presentation']);
		expect(response.message.content).toBe('Wheel highlight removed.');
	});

	it('applies terse tint edits directly to the current selection without an LLM round trip', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-3c'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('unknown');
		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-3c',
			nodes: [{ id: 'node-12', meshId: 'mesh-1' }],
			meshes: [
				{
					id: 'mesh-1',
					materialIds: ['material-9', 'material-10'],
					materialNames: ['Glass', 'Lamp']
				}
			]
		});
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-9',
					op: 'set_base_color_factor',
					value: [0.08, 0.08, 0.08, 0.92]
				},
				{
					targetType: 'material',
					targetId: 'material-10',
					op: 'set_base_color_factor',
					value: [0.08, 0.08, 0.08, 0.92]
				}
			],
			rejected: [],
			summary: 'Applied 5% dark tint.'
		});
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'I could not apply that tint from the current reasoning pass.'
					}
				}
			]
		});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: '5% black tint',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-12',
					nodeName: 'Windshield',
					nodePath: 'Scene/Windshield',
					materialIndex: 0,
					materialName: 'Glass'
				}
			]
		});

		expect(createMock).toHaveBeenCalledTimes(1);
		expect(resolveVehicleIntentMock).toHaveBeenCalledWith('audi_r8', '5% black tint');
		expect(response.message.content).toBe('Applied 5% dark tint. Scoped to selection.');
		expect(response.vehiclePatchOperations).toEqual([
			{
				targetType: 'material',
				targetId: 'material-9',
				op: 'set_base_color_factor',
				value: [0.08, 0.08, 0.08, 0.92]
			}
		]);
	});

	it('falls back to a direct selection edit when the llm narrates failure for a selected tint request', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-fallback-1'
		});
		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-fallback-1',
			nodes: [{ id: 'node-12', meshId: 'mesh-1' }],
			meshes: [
				{
					id: 'mesh-1',
					materialIds: ['material-9', 'material-10'],
					materialNames: ['Glass', 'Lamp']
				}
			]
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [
				{
					targetType: 'material',
					targetId: 'material-9',
					op: 'set_base_color_factor',
					value: [0.04, 0.04, 0.05, 0.94]
				},
				{
					targetType: 'material',
					targetId: 'material-10',
					op: 'set_base_color_factor',
					value: [0.04, 0.04, 0.05, 0.94]
				}
			],
			rejected: [],
			summary: 'Applied 5% dark tint.'
		});
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content:
							'I couldn’t apply that tint to the selected window region. The tint operation wasn’t resolved for the current selection.'
					}
				}
			]
		});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: '5% black tint',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-12',
					nodeName: 'Windshield',
					nodePath: 'Scene/Windshield',
					materialIndex: 0,
					materialName: 'Glass'
				}
			]
		});

		expect(response.message.content).toBe('Applied 5% dark tint. Scoped to selection.');
		expect(response.vehiclePatchOperations).toEqual([
			{
				targetType: 'material',
				targetId: 'material-9',
				op: 'set_base_color_factor',
				value: [0.04, 0.04, 0.05, 0.94]
			}
		]);
	});

	it('falls back to a direct asset edit when the llm narrates failure for a view mode request', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-fallback-view-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('unknown');
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [
				{
					targetType: 'viewer',
					targetId: 'xray',
					op: 'set_enabled',
					value: true
				}
			],
			rejected: [],
			summary: 'Enabled xray view.'
		});
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: 'assistant',
						content: 'I couldn’t apply xray mode to the current vehicle.'
					}
				}
			]
		});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'turn on xray'
		});

		expect(response.message.content).toBe('Enabled xray view.');
		expect(response.vehiclePatchOperations).toEqual([
			{
				targetType: 'viewer',
				targetId: 'xray',
				op: 'set_enabled',
				value: true
			}
		]);
	});

	it('annotates a selected node into a shared semantic group through the chat tool loop', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-4'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		annotateVehicleSemanticGroupMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'group_doors' }]
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-4',
									type: 'function',
									function: {
										name: 'annotate_vehicle_semantic_group',
										arguments: JSON.stringify({
											nodeId: 'node-12',
											category: 'doors',
											humanLabel: 'doors'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Updated the semantic grouping for the selected node.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'this belongs to the doors group',
			selectedNodeId: 'node-12',
			selectedNodeName: 'Door Panel',
			selectedNodePath: 'Scene/Door Panel',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-12',
					nodeName: 'Door Panel',
					nodePath: 'Scene/Door Panel'
				}
			]
		});

		expect(annotateVehicleSemanticGroupMock).toHaveBeenCalledWith('audi_r8', {
			nodeIds: ['node-12'],
			semanticGroup: undefined,
			category: 'doors',
			humanLabel: 'doors',
			aliases: undefined,
			materialSelections: [
				{
					nodeId: 'node-12',
					materialIndex: undefined,
					materialName: undefined
				}
			]
		});
		expect(response.message.content).toBe('Updated the semantic grouping for the selected node.');
	});

	it('accepts freeform semantic assignment phrases like "these are headlights"', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-5'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		annotateVehicleSemanticGroupMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'group_front_lighting' }]
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-5',
									type: 'function',
									function: {
										name: 'annotate_vehicle_semantic_group',
										arguments: JSON.stringify({
											semanticGroup: 'headlights',
											nodeIds: ['node-12', 'node-13']
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Updated the semantic grouping for the selected nodes.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'these are headlights',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-12',
					nodeName: 'Lamp Left',
					nodePath: 'Scene/Lamp Left'
				},
				{
					assetId: 'audi_r8',
					nodeId: 'node-13',
					nodeName: 'Lamp Right',
					nodePath: 'Scene/Lamp Right'
				}
			]
		});

		expect(annotateVehicleSemanticGroupMock).toHaveBeenCalledWith('audi_r8', {
			nodeIds: ['node-12', 'node-13'],
			semanticGroup: 'headlights',
			category: undefined,
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: [
				{
					nodeId: 'node-12',
					materialIndex: undefined,
					materialName: undefined
				},
				{
					nodeId: 'node-13',
					materialIndex: undefined,
					materialName: undefined
				}
			]
		});
		expect(response.message.content).toBe('Updated the semantic grouping for the selected nodes.');
	});

	it('reassigns selected nodes through the semantic mutation tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-5b'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'doors' }]
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-5b',
									type: 'function',
									function: {
										name: 'mutate_vehicle_semantic_assignment',
										arguments: JSON.stringify({
											action: 'reassign',
											scope: 'selected',
											category: 'doors'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Reassigned the selected nodes to doors.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'these are doors instead',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-12',
					nodeName: 'Lamp Left',
					nodePath: 'Scene/Lamp Left'
				}
			]
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'reassign',
			nodeIds: ['node-12'],
			materialIds: [],
			semanticGroup: undefined,
			category: 'doors',
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: [
				{
					nodeId: 'node-12',
					materialIndex: undefined,
					materialName: undefined
				}
			]
		});
		expect(response.message.content).toBe('Reassigned the selected nodes to doors.');
	});

	it('unassigns highlighted targets through the semantic mutation tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-5c'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: []
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-5c',
									type: 'function',
									function: {
										name: 'mutate_vehicle_semantic_assignment',
										arguments: JSON.stringify({
											action: 'unassign',
											scope: 'highlighted',
											semanticGroup: 'headlights'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Removed the highlighted regions from headlights.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'the highlighted regions are not headlights anymore',
			presentation: {
				highlightedTargets: [
					{
						targetId: 'material-12',
						targetName: 'Lamp Lens'
					}
				]
			}
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'unassign',
			nodeIds: [],
			materialIds: ['material-12'],
			semanticGroup: 'headlights',
			category: undefined,
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: undefined
		});
		expect(response.presentationRestore).toEqual({
			highlightedTargetIds: ['material-12'],
			label: 'restore original view'
		});
		expect(response.message.content).toBe('Removed the highlighted regions from headlights.');
	});

	it('filters highlighted semantic mutation scope by query to avoid cross-highlight bleed', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-5d'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: []
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-5d',
									type: 'function',
									function: {
										name: 'mutate_vehicle_semantic_assignment',
										arguments: JSON.stringify({
											action: 'unassign',
											scope: 'highlighted',
											query: 'wheel',
											semanticGroup: 'headlights'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Removed the highlighted wheel regions from headlights.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'the highlighted wheels are not headlights anymore',
			presentation: {
				highlightedTargets: [
					{
						targetId: 'material-wheel',
						targetName: 'Wheel'
					},
					{
						targetId: 'material-headlight',
						targetName: 'Headlight'
					}
				]
			}
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'unassign',
			nodeIds: [],
			materialIds: ['material-wheel'],
			semanticGroup: 'headlights',
			category: undefined,
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: undefined
		});
		expect(response.presentationRestore).toEqual({
			highlightedTargetIds: ['material-wheel'],
			label: 'restore original view'
		});
		expect(response.message.content).toBe(
			'Removed the highlighted wheel regions from headlights.'
		);
	});

	it('expands the current selection into a semantic group through the chat tool loop', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-expand-1'
		});
		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-expand-1',
			nodes: [
				{ id: 'node-10', name: 'Wheel FL', path: 'Scene/Wheel FL', meshId: 'mesh-1' },
				{ id: 'node-11', name: 'Wheel FR', path: 'Scene/Wheel FR', meshId: 'mesh-2' }
			],
			meshes: [
				{ id: 'mesh-1', materialIds: ['material-1'], materialNames: ['Rim'] },
				{ id: 'mesh-2', materialIds: ['material-2'], materialNames: ['Rim'] }
			],
			materials: [
				{ id: 'material-1', nodeIds: ['node-10'] },
				{ id: 'material-2', nodeIds: ['node-11'] }
			]
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'structural-expand-1',
			generatedAt: 'semantic-expand-1',
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [
				{
					id: 'group_wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims'],
					confidence: 0.95,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: ['node-10', 'node-11'],
					meshIds: ['mesh-1', 'mesh-2'],
					materialIds: ['material-1', 'material-2'],
					derivedFrom: ['user']
				}
			],
			discardedSuggestions: []
		});
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-expand-1',
									type: 'function',
									function: {
										name: 'expand_vehicle_selection',
										arguments: JSON.stringify({
											target: 'semantic_group',
											query: 'wheels'
										})
									}
								}
							]
						}
					}
				]
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Expanded the current selection to wheels.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'expand this to wheels',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-10',
					nodeName: 'Wheel FL',
					nodePath: 'Scene/Wheel FL'
				}
			]
		});

		expect(response.selectionUpdate).toEqual({
			mode: 'replace',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-10',
					nodeName: 'Wheel FL',
					nodePath: 'Scene/Wheel FL'
				},
				{
					assetId: 'audi_r8',
					nodeId: 'node-11',
					nodeName: 'Wheel FR',
					nodePath: 'Scene/Wheel FR'
				}
			],
			label: 'Expanded selection to semantic group wheels.'
		});
	});
});
