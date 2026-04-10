import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import {
	EDIT_VEHICLE_PRESENTATION_TOOL_NAME,
	EDIT_VEHICLE_SELECTION_TOOL_NAME,
	EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
	SET_ASSISTANT_UI_TOOL_NAME,
	type GetVehicleToolCatalogToolArgs
} from './internal';
import type { FooterChatPresentationContext } from './types';

export const CHAT_TOOLS: ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
			description:
				'Read-only gateway for tool choice. Returns the current domain tools, when to use them, and context-sensitive recommendations.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					goal: { type: 'string' },
					includeExamples: { type: 'boolean' }
				},
				required: []
			}
		}
	},
	{
		type: 'function',
		function: {
			name: EDIT_VEHICLE_PRESENTATION_TOOL_NAME,
			description:
				'Presentation-domain tool. Use this for appearance edits, focus or highlight changes, restoring active visual state, and viewer mode toggles.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					action: {
						type: 'string',
						enum: ['appearance', 'focus', 'restore', 'view_mode']
					},
					request: { type: 'string' },
					scope: { type: 'string', enum: ['asset', 'selection', 'all', 'matching'] },
					setOperation: {
						type: 'string',
						enum: ['replace', 'add', 'subtract', 'intersect', 'union'],
						description:
							'Set-theoretic operation mode. replace (default) replaces the current state. add/union adds to current. subtract removes from current. intersect keeps only the overlap.'
					},
					colorFamily: { type: 'string' },
					shade: {
						type: 'string',
						enum: ['very_dark', 'dark', 'medium', 'light', 'very_light']
					},
					saturation: {
						type: 'string',
						enum: ['muted', 'balanced', 'vivid']
					},
					finish: {
						type: 'string',
						enum: ['solid', 'metallic', 'chrome', 'matte', 'pearl', 'gloss']
					},
					hex: { type: 'string' },
					kind: {
						type: 'string',
						enum: ['highlights', 'hidden', 'viewer_modes', 'materials', 'all']
					},
					query: { type: 'string' },
					mode: {
						type: 'string',
						enum: ['wireframe', 'xray', 'uv_debug', 'postprocess']
					},
					enabled: { type: 'boolean' }
				},
				required: ['action']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: EDIT_VEHICLE_SELECTION_TOOL_NAME,
			description:
				'Selection-domain tool. Use this to expand the current runtime selection into a node, part, or semantic group.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					action: { type: 'string', enum: ['expand'] },
					target: { type: 'string', enum: ['node', 'part', 'semantic_group'] },
					query: { type: 'string' }
				},
				required: ['action', 'target']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
			description:
				'Semantics-domain tool. Use this for semantic assign or unassign, semantic group create or patch or delete or get, semantic refresh, and semantic ingress binding.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					action: {
						type: 'string',
						enum: [
							'assign',
							'reassign',
							'unassign',
							'create_group',
							'patch_group',
							'delete_group',
							'get_group',
							'get_node',
							'refresh',
							'assign_ingress'
						]
					},
					scope: {
						type: 'string',
						enum: ['selected', 'highlighted', 'material_targets', 'hidden']
					},
					setOperation: {
						type: 'string',
						enum: ['replace', 'add', 'subtract', 'intersect', 'union'],
						description:
							'Set-theoretic operation for group membership. add/union adds targets to the group. subtract removes targets from the group. intersect keeps only targets already in the group. replace (default) replaces group membership.'
					},
					targetScope: { type: 'string', enum: ['node', 'material', 'mixed'] },
					query: { type: 'string' },
					nodeIds: { type: 'array', items: { type: 'string' } },
					materialIds: { type: 'array', items: { type: 'string' } },
					semanticGroup: { type: 'string' },
					groupId: { type: 'string' },
					nodeId: { type: 'string' },
					humanLabel: { type: 'string' },
					aliases: { type: 'array', items: { type: 'string' } },
					category: {
						type: 'string',
						enum: [
							'wheels',
							'doors',
							'front_lighting',
							'rear_lighting',
							'glasshouse',
							'body_shell',
							'front_face',
							'trim',
							'interior',
							'other'
						]
					},
					supports: {
						type: 'array',
						items: {
							type: 'string',
							enum: ['highlight', 'focus', 'isolate', 'paint', 'tint']
						}
					},
					assignmentMode: { type: 'string', enum: ['exclusive', 'overlay'] },
					exclusiveFamily: { type: ['string', 'null'] },
					force: { type: 'boolean' },
					targetType: { type: 'string', enum: ['semantic_group', 'semantic_node'] },
					targetId: { type: 'string' },
					targetLabel: { type: 'string' },
					transport: { type: 'string', enum: ['rest_sse', 'stream'] }
				},
				required: ['action']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: SET_ASSISTANT_UI_TOOL_NAME,
			description:
				'Assistant-UI tool. Use this to update the sidebar cards or the supplementary footer list.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					action: { type: 'string', enum: ['sidebar', 'supplementary_list'] },
					active: { type: 'boolean' },
					cards: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								title: { type: 'string' },
								entries: {
									type: 'object',
									additionalProperties: {
										anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }]
									}
								}
							},
							required: ['title', 'entries']
						}
					},
					entries: {
						type: 'object',
						additionalProperties: {
							type: 'string'
						}
					}
				},
				required: ['action', 'active']
			}
		}
	}
];

export function buildVehicleToolCatalog(
	args: GetVehicleToolCatalogToolArgs,
	activeAssetId?: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[] = [],
	presentation?: FooterChatPresentationContext
) {
	const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
	const tools = [
		{
			name: EDIT_VEHICLE_PRESENTATION_TOOL_NAME,
			purpose: 'appearance, focus, restore, and viewer mode changes',
			useWhen: 'the user is changing how things look or what is visually emphasized',
			actions: ['appearance', 'focus', 'restore', 'view_mode'],
			examples: ['make this matte black', 'highlight the wheels', 'highlight everything except the doors', 'clear highlights', 'turn on xray', 'add the bumper to the current highlight']
		},
		{
			name: EDIT_VEHICLE_SELECTION_TOOL_NAME,
			purpose: 'selection expansion',
			useWhen: 'the current selection should be lifted to a node, part, or semantic group',
			actions: ['expand'],
			examples: ['expand this to the whole node', 'lift this selection to the wheel group']
		},
		{
			name: EDIT_VEHICLE_SEMANTICS_TOOL_NAME,
			purpose: 'semantic assignments, group CRUD, refresh, and ingress binding',
			useWhen: 'the user is talking about what something is semantically, semantic groups, overlay refresh, or semantic endpoints',
			actions: [
				'assign',
				'reassign',
				'unassign',
				'create_group',
				'patch_group',
				'delete_group',
				'get_group',
				'get_node',
				'refresh',
				'assign_ingress'
			],
			examples: [
				'remove node-41 from body shell',
				'add the bumper to the front face group',
				'remove everything except the glass from the glasshouse group',
				'get the wheels semantic group',
				'refresh semantics',
				'create a new roof_rack group',
				'rename the body shell group to exterior shell'
			]
		},
		{
			name: SET_ASSISTANT_UI_TOOL_NAME,
			purpose: 'assistant sidebar and supplementary list updates',
			useWhen: 'structured assistant chrome materially helps the current turn',
			actions: ['sidebar', 'supplementary_list'],
			examples: ['show one semantics card', 'update the footer reference list']
		}
	];

	const recommendations: string[] = [];
	if (!activeAssetId) {
		recommendations.push('Select an active asset before using mutating presentation, selection, or semantics actions.');
	}
	if (scopedSelections.length > 0) {
		recommendations.push('Current selection is available, so selection-scoped presentation and expand actions are valid.');
	}
	if ((presentation?.highlightedTargets?.length ?? 0) > 0 || (presentation?.hiddenTargets?.length ?? 0) > 0) {
		recommendations.push('Active presentation context is available, so restore and semantics actions can target highlighted or hidden regions.');
	}
	if (args.goal) {
		recommendations.push(`Current goal for tool choice: ${args.goal}. Choose the domain first, then the action.`);
	}

	return {
		activeAssetId,
		selectedNodeCount: scopedSelections.length,
		tools: args.includeExamples ? tools : tools.map(({ examples, ...tool }) => tool),
		recommendations
	};
}
