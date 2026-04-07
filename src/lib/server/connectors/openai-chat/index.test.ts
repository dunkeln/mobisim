import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();
const resolveVehicleIntentMock = vi.fn();
const planNormalizedVehiclePaintIntentMock = vi.fn();
const annotateVehicleSemanticGroupMock = vi.fn();
const deriveVehicleInspectionCapabilitiesMock = vi.fn();
const readVehicleSemanticOverlayMock = vi.fn();
const generateVehicleSemanticOverlayMock = vi.fn();
const getVehicleSemanticOverlayStatusMock = vi.fn();

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
		/\b(paint|tint|highlight|headlight|wireframe|xray|x-ray|postprocess)\b/i.test(message),
	resolveVehicleIntent: resolveVehicleIntentMock,
	planNormalizedVehiclePaintIntent: planNormalizedVehiclePaintIntentMock
}));

vi.mock('$lib/server/connectors/gltf-preprocess', () => ({
	deriveVehicleInspectionCapabilities: deriveVehicleInspectionCapabilitiesMock
}));

vi.mock('$lib/server/connectors/vehicle-semantic-overlay', () => ({
	getVehicleSemanticOverlayStatus: getVehicleSemanticOverlayStatusMock,
	readVehicleSemanticOverlay: readVehicleSemanticOverlayMock,
	generateVehicleSemanticOverlay: generateVehicleSemanticOverlayMock,
	annotateVehicleSemanticGroup: annotateVehicleSemanticGroupMock,
	refreshVehicleSemanticOverlayInBackground: vi.fn()
}));

describe('createFooterChatResponse', () => {
	beforeEach(() => {
		createMock.mockReset();
		resolveVehicleIntentMock.mockReset();
		planNormalizedVehiclePaintIntentMock.mockReset();
		annotateVehicleSemanticGroupMock.mockReset();
		deriveVehicleInspectionCapabilitiesMock.mockReset();
		readVehicleSemanticOverlayMock.mockReset();
		generateVehicleSemanticOverlayMock.mockReset();
		getVehicleSemanticOverlayStatusMock.mockReset();
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
		createMock
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
										name: 'apply_vehicle_intent',
										arguments: JSON.stringify({ request: 'paint the body midnight purple' })
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
							content: 'Applied the requested color.'
						}
					}
				]
			});

		const response = await createFooterChatResponse({
			assetId: 'audi_r8',
			message: 'paint the body midnight purple'
		});

		expect(generateVehicleSemanticOverlayMock).not.toHaveBeenCalled();
		expect(resolveVehicleIntentMock).toHaveBeenCalledWith('audi_r8', 'paint the body midnight purple');
		expect(response.vehiclePatchLabel).toBe('Applied body paint.');
		expect(response.vehiclePatchOperations).toHaveLength(1);
		expect(response.message.content).toBe('Applied the requested color.');
	});

	it('routes structured paint intents through the normalized paint tool', async () => {
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
										name: 'apply_vehicle_paint_intent',
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
			selectedNodePath: 'Scene/Door Panel'
		});

		expect(annotateVehicleSemanticGroupMock).toHaveBeenCalledWith('audi_r8', {
			nodeId: 'node-12',
			category: 'doors',
			humanLabel: 'doors',
			aliases: undefined
		});
		expect(response.message.content).toBe('Updated the semantic grouping for the selected node.');
	});
});
