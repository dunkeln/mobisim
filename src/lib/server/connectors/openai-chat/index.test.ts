import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = {
	OPENAI_API_KEY: 'test-key',
	OPENAI_MODEL: 'gpt-5.2',
	OPENAI_TOOL_MODEL: 'gpt-5.2-reasoner',
	OPENAI_REPLY_MODEL: 'gpt-4o-mini'
};

const createMock = vi.fn();
const resolveVehicleIntentMock = vi.fn();
const planNormalizedVehiclePaintIntentMock = vi.fn();
const deriveVehicleInspectionCapabilitiesMock = vi.fn();
const deriveStructuralAssetSnapshotMock = vi.fn();
const readVehicleSemanticOverlayMock = vi.fn();
const generateVehicleSemanticOverlayMock = vi.fn();
const getVehicleSemanticOverlayStatusMock = vi.fn();
const assignSemanticIngressMock = vi.fn();
const listSemanticIngressBindingsMock = vi.fn();
const mutateVehicleSemanticAssignmentMock = vi.fn();
const createSemanticGroupDefinitionMock = vi.fn();
const findSemanticGroupDefinitionMock = vi.fn();
const patchSemanticGroupDefinitionMock = vi.fn();
const deleteSemanticGroupDefinitionMock = vi.fn();
const writeVehicleSemanticOverlayMock = vi.fn();
const resolveContextHistoryMock = vi.fn();
const persistContextHistoryMock = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: envMock
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
	writeVehicleSemanticOverlay: writeVehicleSemanticOverlayMock,
	generateVehicleSemanticOverlay: generateVehicleSemanticOverlayMock,
	mutateVehicleSemanticAssignment: mutateVehicleSemanticAssignmentMock,
	refreshVehicleSemanticOverlayInBackground: vi.fn()
}));

vi.mock('$lib/server/connectors/semantic-groups', () => ({
	createSemanticGroupDefinition: createSemanticGroupDefinitionMock,
	findSemanticGroupDefinition: findSemanticGroupDefinitionMock,
	patchSemanticGroupDefinition: patchSemanticGroupDefinitionMock,
	deleteSemanticGroupDefinition: deleteSemanticGroupDefinitionMock
}));

vi.mock('$lib/server/connectors/semantic-ingress', () => ({
	assignSemanticIngress: assignSemanticIngressMock,
	listSemanticIngressBindings: listSemanticIngressBindingsMock
}));

vi.mock('$lib/server/connectors/context-history', () => ({
	resolveContextHistory: resolveContextHistoryMock,
	persistContextHistory: persistContextHistoryMock,
	buildHistoryTrace: (context: { sourceUsed: string; compactionApplied: boolean }) =>
		context.sourceUsed === 'none' && !context.compactionApplied
			? {}
			: {
					historySourceUsed: context.sourceUsed,
					historyCompactionApplied: context.compactionApplied
				}
}));

describe('createFooterChatResponse', () => {
	beforeEach(() => {
		envMock.OPENAI_MODEL = 'gpt-5.2';
		envMock.OPENAI_TOOL_MODEL = 'gpt-5.2-reasoner';
		envMock.OPENAI_REPLY_MODEL = 'gpt-4o-mini';
		createMock.mockReset();
		resolveVehicleIntentMock.mockReset();
		planNormalizedVehiclePaintIntentMock.mockReset();
		deriveVehicleInspectionCapabilitiesMock.mockReset();
		deriveStructuralAssetSnapshotMock.mockReset();
		readVehicleSemanticOverlayMock.mockReset();
		generateVehicleSemanticOverlayMock.mockReset();
		getVehicleSemanticOverlayStatusMock.mockReset();
		assignSemanticIngressMock.mockReset();
		listSemanticIngressBindingsMock.mockReset();
		mutateVehicleSemanticAssignmentMock.mockReset();
		createSemanticGroupDefinitionMock.mockReset();
		findSemanticGroupDefinitionMock.mockReset();
		patchSemanticGroupDefinitionMock.mockReset();
		deleteSemanticGroupDefinitionMock.mockReset();
		writeVehicleSemanticOverlayMock.mockReset();
		resolveContextHistoryMock.mockReset();
		persistContextHistoryMock.mockReset();
		resolveContextHistoryMock.mockResolvedValue({
			historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
			compactionApplied: false,
			sourceUsed: 'none'
		});
		listSemanticIngressBindingsMock.mockResolvedValue({ bindings: [] });
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
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({ action: 'refresh', force: true })
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

		expect(createMock.mock.calls[0]?.[0]?.model).toBe('gpt-5.2-reasoner');
		expect(generateVehicleSemanticOverlayMock).toHaveBeenCalledWith('audi_r8', { force: true });
		expect(response.message.content).toBe('Semantic overlay refreshed.');
		expect(response.trace?.plannerModel).toBe('gpt-5.2-reasoner');
		expect(response.trace?.planningMode).toBe('single_tool');
	});

	it('surfaces tool execution failures directly instead of continuing the loop', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			revision: 1,
			generatedAt: 'semantic-1',
			structuralGeneratedAt: 'structural-1',
			model: 'gpt-5.2',
			minAcceptedConfidence: 0.5,
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [],
			discardedSuggestions: []
		});
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [],
			rejected: [],
			summary: 'No valid paint operations were accepted.'
		});
		createMock.mockResolvedValueOnce({
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
									name: 'edit_vehicle_presentation',
									arguments: JSON.stringify({ action: 'appearance' })
								}
							}
						]
					}
				}
			]
		});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'paint it'
		});

		expect(response.message.content).toBe(
			'A freeform appearance request or normalized paint fields are required.'
		);
		expect(createMock).toHaveBeenCalledTimes(1);
		expect(response.trace?.toolCalls).toEqual(['edit_vehicle_presentation']);
		expect(response.trace?.planningMode).toBe('direct');
	});

	it('supports a catalog-to-action-to-ui tool chain in one turn', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-1'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			revision: 1,
			generatedAt: 'semantic-1',
			structuralGeneratedAt: 'structural-1',
			model: 'gpt-5.2',
			minAcceptedConfidence: 0.5,
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [],
			discardedSuggestions: []
		});
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [
				{
					targetType: 'material',
					targetId: 'wheel-material',
					op: 'set_overlay_highlight',
					value: true
				}
			],
			rejected: [],
			summary: 'Highlighted the wheels.'
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
										name: 'get_vehicle_tool_catalog',
										arguments: JSON.stringify({
											goal: 'highlight the wheels and summarize the result in the footer'
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
							content: null,
							tool_calls: [
								{
									id: 'tool-2',
									type: 'function',
									function: {
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'focus',
											request: 'highlight the wheels',
											scope: 'asset'
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
							content: null,
							tool_calls: [
								{
									id: 'tool-3',
									type: 'function',
									function: {
										name: 'set_assistant_ui',
										arguments: JSON.stringify({
											action: 'supplementary_list',
											active: true,
											entries: {
												focus: 'Wheels',
												status: 'Highlighted'
											}
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
							content: 'Wheels are highlighted. The footer has the detail.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'highlight the wheels and then put the changed targets in the footer list'
		});

		expect(createMock).toHaveBeenCalledTimes(4);
		expect(response.message.content).toBe('Wheels are highlighted. The footer has the detail.');
		expect(response.vehiclePatchOperations).toEqual([
			{
				targetType: 'material',
				targetId: 'wheel-material',
				op: 'set_overlay_highlight',
				value: true
			}
		]);
		expect(response.supplementaryList).toEqual({
			active: true,
			entries: {
				focus: 'Wheels',
				status: 'Highlighted'
			}
		});
		expect(response.trace?.toolCalls).toEqual([
			'get_vehicle_tool_catalog',
			'edit_vehicle_presentation',
			'set_assistant_ui'
		]);
		expect(response.trace?.planningMode).toBe('multi_tool');
		expect(response.trace?.toolRoundsUsed).toBe(3);
		expect(response.trace?.composedToolChain).toBe(true);
	});

	it('backfills the supplementary footer list from the tool catalog when the model forgets the ui tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-catalog-fallback-1'
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
									id: 'tool-catalog-1',
									type: 'function',
									function: {
										name: 'get_vehicle_tool_catalog',
										arguments: JSON.stringify({
											goal: 'show the available tools'
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
							content: 'The available controls are in the footer.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'what tools are available here?'
		});

		expect(response.message.content).toBe('The available controls are in the footer.');
		expect(response.supplementaryList).toEqual({
			active: true,
			entries: expect.objectContaining({
				edit_vehicle_presentation: 'appearance, focus, restore, and viewer mode changes',
				edit_vehicle_selection: 'selection expansion',
				edit_vehicle_semantics:
					'semantic assignments, group CRUD, refresh, and ingress binding',
				set_assistant_ui: 'assistant sidebar and supplementary list updates'
			})
		});
		expect(response.trace?.supplementaryListAction).toBe('updated');
		expect(response.trace?.toolCalls).toEqual(['get_vehicle_tool_catalog']);
	});

	it('backfills changed-target footer detail when a footer request omits the ui tool call', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-footer-fallback-1'
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
									id: 'tool-highlight-override',
									type: 'function',
									function: {
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'appearance',
											request: 'make the highlighted wheel black'
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
							content: 'Applied wheel finish.'
						}
					}
				]
			})
			.mockResolvedValue({
				choices: [
					{
						message: {
							role: 'assistant',
							content: 'Applied wheel finish.'
						}
					}
				]
			});
		resolveVehicleIntentMock.mockResolvedValue({
			assetId: 'audi_r8',
			operations: [
				{
					targetType: 'material',
					targetId: 'wheel-material',
					targetName: 'Wheels',
					op: 'set_overlay_highlight',
					value: true
				}
			],
			rejected: [],
			summary: 'Highlighted the wheels.'
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
									id: 'tool-catalog-1',
									type: 'function',
									function: {
										name: 'get_vehicle_tool_catalog',
										arguments: JSON.stringify({
											goal: 'highlight the wheels and put the changed targets in the footer list'
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
							content: null,
							tool_calls: [
								{
									id: 'tool-focus-1',
									type: 'function',
									function: {
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'focus',
											request: 'highlight the wheels',
											scope: 'asset'
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
							content: 'Wheels are highlighted.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'highlight the wheels and put the changed targets in the footer list'
		});

		expect(response.vehiclePatchOperations).toEqual([
			{
				targetType: 'material',
				targetId: 'wheel-material',
				targetName: 'Wheels',
				op: 'set_overlay_highlight',
				value: true
			}
		]);
		expect(response.supplementaryList).toEqual({
			active: true,
			entries: {
				Action: 'Highlighted the wheels.',
				Targets: 'Wheels'
			}
		});
		expect(response.trace?.supplementaryListAction).toBe('updated');
		expect(response.trace?.planningMode).toBe('multi_tool');
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
		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'paint the body midnight purple'
		});

		expect(generateVehicleSemanticOverlayMock).not.toHaveBeenCalled();
		expect(createMock).not.toHaveBeenCalled();
		expect(resolveVehicleIntentMock).toHaveBeenCalledWith(
			'audi_r8',
			'paint the body midnight purple',
			{ presentation: undefined }
		);
		expect(response.vehiclePatchLabel).toBe('Applied body paint.');
		expect(response.vehiclePatchOperations).toHaveLength(1);
		expect(response.message.content).toBe('Applied body paint.');
		expect(response.trace).toEqual({
			route: 'direct_edit',
			semanticOverlayStatus: 'unknown',
			toolCalls: [],
			sidebarAction: 'unchanged',
			supplementaryListAction: 'unchanged',
			plannerModel: 'gpt-5.2-reasoner',
			planningMode: 'direct',
			toolRoundsUsed: 0,
			clarificationIssued: false,
			composedToolChain: false
		});
	});

	it('builds a targeted highlight restore when non-highlight operations override highlighted targets', async () => {
		const { buildHighlightOverrideRestore } = await import('./index');

		expect(
			buildHighlightOverrideRestore({
				presentation: {
					highlightedTargets: [
						{
							targetId: 'material-wheel',
							targetType: 'material',
							targetName: 'Wheel'
						}
					]
				},
				vehiclePatchOperations: [
					{
						targetType: 'material',
						targetId: 'material-wheel',
						targetName: 'Wheel',
						op: 'set_base_color_factor',
						value: [0.1, 0.1, 0.1, 1]
					}
				]
			})
		).toEqual({
			highlightedTargetIds: ['material-wheel'],
			label: 'restore original view'
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
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'appearance',
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
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'focus',
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

		expect(resolveVehicleIntentMock).toHaveBeenCalledWith('audi_r8', 'highlight these', {
			presentation: undefined
		});
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
			'When the user says select, selected, pick, choose, call out, or mark while referring to a visible region or the current selection, prefer the presentation domain tool with focus action unless they are explicitly asking for semantic grouping, selection expansion, or a viewer mode.'
		);
		expect(developerPrompt).toContain(
			'presentation domain tool: use for appearance, focus, restore, and viewer mode actions'
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

		expect(createMock).not.toHaveBeenCalled();
		expect(resolveVehicleIntentMock).toHaveBeenCalledWith('audi_r8', 'turn on xray', {
			presentation: undefined
		});
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
					id: 'body_shell',
					humanLabel: 'Body Shell',
					aliases: ['shell'],
					confidence: 0.95,
					category: 'body_shell',
					supports: ['highlight', 'paint'],
					nodeIds: ['node-1'],
					meshIds: ['mesh-1'],
					materialIds: ['material-body'],
					author: 'agent'
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
			'Semantic panel inventory available for tool grounding: Body Shell [body_shell] {nodes 1, materials 1} -> Body Shell [part-shell]. Group and node labels from this inventory are valid grounding terms for semantic tool calls, semantic ingress targets, and freeform semantic requests.'
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
										name: 'set_assistant_ui',
										arguments: JSON.stringify({
											action: 'sidebar',
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
			toolCalls: ['set_assistant_ui'],
			sidebarAction: 'updated',
			supplementaryListAction: 'unchanged',
			plannerModel: 'gpt-5.2-reasoner',
			planningMode: 'single_tool',
			toolRoundsUsed: 1,
			clarificationIssued: false,
			composedToolChain: false
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
										name: 'set_assistant_ui',
										arguments: JSON.stringify({
											action: 'supplementary_list',
											active: true,
											entries: {
												Selection: 'Wheels selected',
												Finish: 'Bronze paint applied',
												View: 'Front quarter focus'
											}
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
				entries: {}
			}
		});

		expect(response.trace).toEqual({
			route: 'llm',
			semanticOverlayStatus: 'fresh',
			toolCalls: ['set_assistant_ui'],
			sidebarAction: 'unchanged',
			supplementaryListAction: 'updated',
			plannerModel: 'gpt-5.2-reasoner',
			planningMode: 'single_tool',
			toolRoundsUsed: 1,
			clarificationIssued: false,
			composedToolChain: false
		});
		expect(response.supplementaryList).toEqual({
			active: true,
			entries: {
				Selection: 'Wheels selected',
				Finish: 'Bronze paint applied',
				View: 'Front quarter focus'
			}
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
			scope: 'global',
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
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'assign_ingress',
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
		expect(response.trace?.toolCalls).toEqual(['edit_vehicle_semantics']);
		expect(response.message.content).toBe('Ingress assigned for Body Shell.');
		expect(response.semanticIngressMutation).toEqual({
			action: 'create',
			targetType: 'semantic_group',
			targetId: 'body_shell',
			targetLabel: 'Body Shell',
			transport: 'rest_sse',
			ingressId: 'semantic_group-body_shell-rest_sse',
			replacedIngressId: undefined
		});
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
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'restore',
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
		expect(response.trace?.toolCalls).toEqual(['edit_vehicle_presentation']);
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
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'restore',
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
		expect(response.trace?.toolCalls).toEqual(['edit_vehicle_presentation']);
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
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'restore',
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
		expect(response.trace?.toolCalls).toEqual(['edit_vehicle_presentation']);
		expect(response.message.content).toBe('Wheel highlight removed.');
	});

	it('returns no presentation restore when the requested restore subset has no matching active targets', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-restore-miss'
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
									id: 'tool-restore-miss',
									type: 'function',
									function: {
										name: 'edit_vehicle_presentation',
										arguments: JSON.stringify({
											action: 'restore',
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
							content: 'No wheel highlight is active right now.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'restore only the wheel overlays',
			presentation: {
				highlightedTargets: [{ targetId: 'material-door-left', targetName: 'Door Left' }]
			}
		});

		expect(response.presentationRestore).toBeUndefined();
		expect(resolveVehicleIntentMock).not.toHaveBeenCalled();
		expect(response.message.content).toBe(
			'No matching active presentation state was available to restore.'
		);
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

		expect(createMock).not.toHaveBeenCalled();
		expect(resolveVehicleIntentMock).toHaveBeenCalledWith('audi_r8', '5% black tint', {
			presentation: undefined
		});
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

	it('assigns a selected node into a shared semantic group through the chat tool loop', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-4'
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
									id: 'tool-4',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'assign',
											nodeIds: ['node-12'],
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

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'assign',
			nodeIds: ['node-12'],
			materialIds: [],
			semanticGroup: 'doors',
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

	it('directly assigns a selected target into a semantic group without relying on model tool selection', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-direct-semantic'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'doors' }]
		});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'assign this to the doors group',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-12',
					nodeName: 'Door Panel',
					nodePath: 'Scene/Door Panel'
				}
			]
		});

		expect(createMock).not.toHaveBeenCalled();
		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'assign',
			nodeIds: ['node-12'],
			materialIds: [],
			semanticGroup: 'doors',
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
		expect(response.trace?.toolCalls).toEqual(['edit_vehicle_semantics']);
	});

	it('accepts freeform semantic assignment phrases like "these are headlights"', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-5'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'front_lighting' }]
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
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'assign',
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

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'assign',
			nodeIds: ['node-12', 'node-13'],
			materialIds: [],
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

	it('routes front lights assignment to front_lighting instead of front_face', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-5'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'front_lighting' }]
		});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'put these in front lights',
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

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'assign',
			nodeIds: ['node-12', 'node-13'],
			materialIds: [],
			semanticGroup: 'front_lighting',
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
										name: 'edit_vehicle_semantics',
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

	it('keeps explicit node-id semantic mutation scoped to node-backed membership', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-typed-node'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'body_shell' }]
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
									id: 'tool-typed-node',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'unassign',
											scope: 'selected',
											targetScope: 'node',
											nodeIds: ['node-41'],
											semanticGroup: 'body_shell'
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
							content: 'Removed node-41 from body shell.'
						}
					}
				]
			});

		await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'remove node-41 from body_shell',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-41',
					nodeName: 'Body Shell',
					nodePath: 'Scene/Body Shell'
				}
			]
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'unassign',
			nodeIds: ['node-41'],
			materialIds: [],
			semanticGroup: 'body_shell',
			category: undefined,
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: [
				{
					nodeId: 'node-41',
					materialIndex: undefined,
					materialName: undefined
				}
			]
		});
	});

	it('keeps explicit material semantic mutation scoped to material-backed membership', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-typed-material'
		});
		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-typed-material',
			nodes: [
				{
					id: 'node-41',
					name: 'Body Shell',
					path: 'Scene/Body Shell',
					meshId: 'mesh-41'
				}
			],
			meshes: [
				{
					id: 'mesh-41',
					materialIds: ['material-shell'],
					materialNames: ['Shell Paint']
				}
			],
			materials: []
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'body_shell' }]
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
									id: 'tool-typed-material',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'unassign',
											scope: 'selected',
											targetScope: 'material',
											semanticGroup: 'body_shell'
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
							content: 'Removed the selected shell material from body shell.'
						}
					}
				]
			});

		await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'remove the material-backed body shell member',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-41',
					nodeName: 'Body Shell',
					nodePath: 'Scene/Body Shell',
					materialName: 'Shell Paint',
					materialIndex: 0
				}
			]
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'unassign',
			nodeIds: [],
			materialIds: ['material-shell'],
			semanticGroup: 'body_shell',
			category: undefined,
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: undefined
		});
	});

	it('supports explicit mixed semantic mutation when the user asks for the whole mixed group membership', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-typed-mixed'
		});
		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-typed-mixed',
			nodes: [
				{
					id: 'node-41',
					name: 'Body Shell',
					path: 'Scene/Body Shell',
					meshId: 'mesh-41'
				}
			],
			meshes: [
				{
					id: 'mesh-41',
					materialIds: ['material-shell'],
					materialNames: ['Shell Paint']
				}
			],
			materials: []
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'audi_r8',
			acceptedGroups: [{ id: 'body_shell' }]
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
									id: 'tool-typed-mixed',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'unassign',
											scope: 'selected',
											targetScope: 'mixed',
											semanticGroup: 'body_shell'
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
							content: 'Removed the whole body shell group membership.'
						}
					}
				]
			});

		await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'remove the whole body_shell group membership',
			selectedNodes: [
				{
					assetId: 'audi_r8',
					nodeId: 'node-41',
					nodeName: 'Body Shell',
					nodePath: 'Scene/Body Shell',
					materialName: 'Shell Paint',
					materialIndex: 0
				}
			]
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'unassign',
			nodeIds: ['node-41'],
			materialIds: ['material-shell'],
			semanticGroup: 'body_shell',
			category: undefined,
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: [
				{
					nodeId: 'node-41',
					materialIndex: 0,
					materialName: 'Shell Paint'
				}
			]
		});
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
										name: 'edit_vehicle_semantics',
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

	it('defaults semantic mutation scope to highlighted targets when no selection exists', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-highlight-default'
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
									id: 'tool-highlight-default',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'assign',
											semanticGroup: 'wheels'
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
							content: 'Added the highlighted target to wheels.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'add that to the wheels group',
			presentation: {
				highlightedTargets: [
					{
						targetId: 'material-wheel',
						targetType: 'material',
						targetName: 'Wheel'
					}
				]
			}
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'assign',
			nodeIds: [],
			materialIds: ['material-wheel'],
			semanticGroup: 'wheels',
			category: 'wheels',
			humanLabel: 'wheels',
			aliases: undefined,
			materialSelections: undefined
		});
		expect(response.message.content).toBe(
			'Added the highlighted material-backed member to wheels.'
		);
		expect(response.presentationRestore).toEqual({
			highlightedTargetIds: ['material-wheel'],
			label: 'restore original view'
		});
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
										name: 'edit_vehicle_semantics',
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

	it('asks for clarification when highlighted semantic mutation is ambiguous across node and material targets', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-typed-ambiguous'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-typed-ambiguous',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'unassign',
											scope: 'highlighted',
											semanticGroup: 'body_shell'
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
							content:
								'Do you want me to remove the node-backed member, the material-backed member, or the whole mixed group?'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'remove that from the group',
			presentation: {
				highlightedTargets: [
					{
						targetId: 'node-41',
						targetType: 'node',
						targetName: 'Body Shell Node'
					},
					{
						targetId: 'material-shell',
						targetType: 'material',
						targetName: 'Shell Paint'
					}
				]
			}
		});

		expect(mutateVehicleSemanticAssignmentMock).not.toHaveBeenCalled();
		expect(response.message.content).toBe(
			'Do you want me to remove the node-backed member, the material-backed member, or the whole mixed group?'
		);
	});

	it('uses explicit material target scope to avoid clarification on mixed highlighted semantic targets', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-typed-explicit-material'
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
									id: 'tool-typed-explicit-material',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'unassign',
											scope: 'highlighted',
											targetScope: 'material',
											semanticGroup: 'body_shell'
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
							content: 'Removed the highlighted material-backed member from body shell.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'remove the highlighted material-backed member from body shell',
			presentation: {
				highlightedTargets: [
					{
						targetId: 'node-41',
						targetType: 'node',
						targetName: 'Body Shell Node'
					},
					{
						targetId: 'material-shell',
						targetType: 'material',
						targetName: 'Shell Paint'
					}
				]
			}
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('audi_r8', {
			action: 'unassign',
			nodeIds: [],
			materialIds: ['material-shell'],
			semanticGroup: 'body_shell',
			category: undefined,
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: undefined
		});
		expect(response.message.content).toBe(
			'Removed the highlighted material-backed member from body shell.'
		);
	});

	it('defaults selected runtime node semantic mutation to node-backed membership even when the click carries material context', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'acura_nsx_type_s_2022',
			generatedAt: 'structural-selected-node-default'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		mutateVehicleSemanticAssignmentMock.mockResolvedValue({
			assetId: 'acura_nsx_type_s_2022',
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
									id: 'tool-selected-node-default',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'assign',
											scope: 'selected',
											semanticGroup: 'body_shell'
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
							content: 'Added the selected nodes to body shell.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'acura_nsx_type_s_2022',
			message: 'put this in body shell',
			selectedNodes: [
				{
					assetId: 'acura_nsx_type_s_2022',
					targetType: 'node',
					targetId: 'node-9',
					targetName: 'Base',
					nodeIds: ['node-9'],
					nodeId: 'node-9',
					nodeName: 'Base',
					nodePath: 'Scene/Base',
					materialIndex: 0,
					materialName: 'Acura_NSXTypeSRewardRecycled_2022Paint_Material'
				}
			]
		});

		expect(mutateVehicleSemanticAssignmentMock).toHaveBeenCalledWith('acura_nsx_type_s_2022', {
			action: 'assign',
			nodeIds: ['node-9'],
			materialIds: [],
			semanticGroup: 'body_shell',
			category: undefined,
			humanLabel: undefined,
			aliases: undefined,
			materialSelections: [
				{
					nodeId: 'node-9',
					materialIndex: 0,
					materialName: 'Acura_NSXTypeSRewardRecycled_2022Paint_Material'
				}
			]
		});
		expect(response.message.content).toBe('Updated the semantic grouping for the selected node.');
	});

	it('gets a semantic group and highlights it through the semantic group management tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-semantic-get',
			materials: [{ id: 'material-wheel', name: 'Wheel Alloy' }]
		});
		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-semantic-get',
			nodes: [],
			meshes: []
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'semantic-semantic-get',
			structuralGeneratedAt: 'structural-semantic-get',
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [
				{
					id: 'wheels',
					humanLabel: 'Wheels',
					aliases: ['wheel'],
					confidence: 0.98,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: [],
					meshIds: [],
					materialIds: ['material-wheel']
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
									id: 'tool-semantic-get',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'get_group',
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
							content: 'Resolved the wheels semantic group.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'get the wheels semantic group'
		});

		expect(response.vehiclePatchOperations).toBeUndefined();
		expect(response.message.content).toBe('Resolved the wheels semantic group.');
	});

	it('patches a semantic group on the active asset and persists the materialized overlay', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-semantic-patch'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		patchSemanticGroupDefinitionMock.mockResolvedValue({
			id: 'number_plate',
			humanLabel: 'Plate Assembly',
			aliases: ['plate', 'plate assembly'],
			category: 'other',
			supports: ['highlight', 'focus', 'isolate'],
			assignmentMode: 'overlay'
		});
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'semantic-semantic-patch',
			structuralGeneratedAt: 'structural-semantic-patch',
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [
				{
					id: 'number_plate',
					humanLabel: 'Plate Assembly',
					aliases: ['plate', 'plate assembly'],
					confidence: 1,
					category: 'other',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: ['node-plate'],
					meshIds: [],
					materialIds: ['material-plate'],
					author: 'user'
				}
			],
			discardedSuggestions: []
		});
		writeVehicleSemanticOverlayMock.mockImplementation(async (overlay) => overlay);
		createMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'tool-semantic-patch',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'patch_group',
											query: 'number plate',
											humanLabel: 'Plate Assembly',
											aliases: ['plate', 'plate assembly']
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
							content: 'Updated the number plate semantic group.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'patch the number plate semantic group aliases'
		});

		expect(patchSemanticGroupDefinitionMock).toHaveBeenCalledWith({
			id: undefined,
			semanticGroup: 'number plate',
			category: undefined,
			humanLabel: 'Plate Assembly',
			aliases: ['plate', 'plate assembly'],
			supports: undefined,
			assignmentMode: undefined,
			exclusiveFamily: undefined
		});
		expect(writeVehicleSemanticOverlayMock).toHaveBeenCalledWith(
			expect.objectContaining({
				assetId: 'audi_r8',
				structuralGeneratedAt: 'structural-semantic-patch',
				acceptedGroups: [
					expect.objectContaining({
						id: 'number_plate',
						humanLabel: 'Plate Assembly'
					})
				]
			})
		);
		expect(response.message.content).toBe('Updated the number plate semantic group.');
	});

	it('deletes a semantic group from the active overlay through the semantic group management tool', async () => {
		const { createFooterChatResponse } = await import('./index');

		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-semantic-delete'
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'semantic-semantic-delete',
			structuralGeneratedAt: 'structural-semantic-delete',
			acceptedMaterials: [],
			acceptedParts: [],
			acceptedGroups: [
				{
					id: 'number_plate',
					humanLabel: 'Number Plate',
					aliases: ['plate'],
					confidence: 0.91,
					category: 'other',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: ['node-plate'],
					meshIds: [],
					materialIds: ['material-plate']
				}
			],
			discardedSuggestions: []
		});
		writeVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'semantic-semantic-delete-2',
			structuralGeneratedAt: 'structural-semantic-delete',
			acceptedMaterials: [],
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
									id: 'tool-semantic-delete',
									type: 'function',
									function: {
										name: 'edit_vehicle_semantics',
										arguments: JSON.stringify({
											action: 'delete_group',
											query: 'number plate'
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
							content: 'Removed the number plate semantic group.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'delete the number plate semantic group'
		});

		expect(writeVehicleSemanticOverlayMock).toHaveBeenCalled();
		expect(response.message.content).toBe('Removed the number plate semantic group.');
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
					id: 'wheels',
					humanLabel: 'wheels',
					aliases: ['wheel', 'rims'],
					confidence: 0.95,
					category: 'wheels',
					supports: ['highlight', 'focus', 'isolate'],
					nodeIds: ['node-10', 'node-11'],
					meshIds: ['mesh-1', 'mesh-2'],
					materialIds: ['material-1', 'material-2'],
					author: 'user'
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
										name: 'edit_vehicle_selection',
										arguments: JSON.stringify({
											action: 'expand',
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
					targetType: 'node',
					targetId: 'node-10',
					targetName: 'Wheel FL',
					nodeIds: ['node-10'],
					nodeId: 'node-10',
					nodeName: 'Wheel FL',
					nodePath: 'Scene/Wheel FL'
				},
				{
					assetId: 'audi_r8',
					targetType: 'node',
					targetId: 'node-11',
					targetName: 'Wheel FR',
					nodeIds: ['node-11'],
					nodeId: 'node-11',
					nodeName: 'Wheel FR',
					nodePath: 'Scene/Wheel FR'
				}
			],
			label: 'Expanded selection to semantic group wheels.'
		});
	});

	it('expands a raw node selection into a reviewed semantic part through the chat tool loop', async () => {
		const { createFooterChatResponse } = await import('./index');
		deriveVehicleInspectionCapabilitiesMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-expand-part-1'
		});
		deriveStructuralAssetSnapshotMock.mockResolvedValue({
			assetId: 'audi_r8',
			generatedAt: 'structural-expand-part-1',
			assetPath: '/tmp/audi_r8.glb',
			scenes: [],
			nodes: [
				{
					id: 'node-10',
					name: 'Wheel FL',
					path: 'Scene/Wheel FL',
					parentId: null,
					childIds: [],
					childCount: 0,
					meshId: 'mesh-1',
					translation: [0, 0, 0],
					worldTranslation: [0, 0, 0],
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1]
				}
			],
			meshes: [
				{
					id: 'mesh-1',
					name: 'Wheel FL',
					primitiveCount: 1,
					attributeSemantics: ['POSITION'],
					materialIds: ['material-1'],
					materialNames: ['Wheel'],
					hasTexcoord0: true,
					hasTexcoord1: false
				}
			],
			materials: [{ id: 'material-1', nodeIds: ['node-10'] }]
		});
		getVehicleSemanticOverlayStatusMock.mockResolvedValue('fresh');
		readVehicleSemanticOverlayMock.mockResolvedValue({
			assetId: 'audi_r8',
			structuralGeneratedAt: 'structural-expand-part-1',
			generatedAt: 'semantic-expand-part-1',
			model: 'test-model',
			minAcceptedConfidence: 0.7,
			acceptedMaterials: [],
			acceptedParts: [
				{
					id: 'front_left_wheel',
					humanLabel: 'front left wheel',
					aliases: ['wheel fl'],
					confidence: 0.96,
					category: 'wheel',
					nodeIds: ['node-10'],
					meshIds: ['mesh-1'],
					materialIds: ['material-1'],
					anchorNodeId: 'node-10',
					side: 'left',
					region: 'front'
				}
			],
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
									id: 'tool-expand-part-1',
									type: 'function',
									function: {
										name: 'edit_vehicle_selection',
										arguments: JSON.stringify({
											action: 'expand',
											target: 'part'
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
							content: 'Expanded the current selection to the front left wheel.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'expand this to the part',
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
					targetType: 'part',
					targetId: 'front_left_wheel',
					targetName: 'front left wheel',
					nodeIds: ['node-10'],
					anchorNodeId: 'node-10',
					nodeId: 'node-10',
					nodeName: 'Wheel FL',
					nodePath: 'Scene/Wheel FL'
				}
			],
			label: 'Expanded selection to part front left wheel.'
		});
	});

});
