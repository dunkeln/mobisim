import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import {
	buildPresentationRestoreFromInstruction,
	selectMatchingPresentationTargetIds
} from '$lib/contracts/footer-chat-restore';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import { assignSemanticIngress } from '$lib/server/connectors/semantic-ingress';
import {
	annotateVehicleSemanticGroup,
	generateVehicleSemanticOverlay,
	getVehicleSemanticOverlayStatus,
	mutateVehicleSemanticAssignment,
	readVehicleSemanticOverlay
} from '$lib/server/connectors/vehicle-semantic-overlay';
import {
	planNormalizedVehiclePaintIntent,
	resolveVehicleIntent
} from '$lib/server/connectors/vehicle-intents';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import { OpenAIChatInputError } from './errors';
import {
	ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME,
	ASSIGN_SEMANTIC_INGRESS_TOOL_NAME,
	MUTATE_VEHICLE_SEMANTIC_ASSIGNMENT_TOOL_NAME,
	APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME,
	APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME,
	GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
	RESTORE_VEHICLE_PRESENTATION_TOOL_NAME,
	type AssignSemanticIngressToolArgs,
	type ApplyVehicleAppearanceIntentToolArgs,
	type ApplyVehicleFocusIntentToolArgs,
	type ExecutedToolResult,
	type ExpandVehicleSelectionToolArgs,
	type FooterChatExecutionRoute,
	type GetVehicleToolCatalogToolArgs,
	type MutateVehicleSemanticAssignmentToolArgs,
	type NormalizedFooterChatRequest,
	type RefreshVehicleSemanticsToolArgs,
	type RestoreVehiclePresentationToolArgs,
	type SemanticOverlayPromptContext,
	type SemanticOverlayState,
	type SetIntentSidebarToolArgs,
	type SetSupplementaryReferenceListToolArgs,
	type SetVehicleViewModeToolArgs,
	EXPAND_VEHICLE_SELECTION_TOOL_NAME,
	REFRESH_VEHICLE_SEMANTICS_TOOL_NAME,
	SET_INTENT_SIDEBAR_TOOL_NAME,
	SET_SUPPLEMENTARY_REFERENCE_LIST_TOOL_NAME,
	SET_VEHICLE_VIEW_MODE_TOOL_NAME
} from './internal';
import { normalizeSidebarCard, normalizeSupplementaryListState } from './normalize';
import {
	isSelectionExpansionRequest,
	isSemanticAnnotationRequest,
	isSemanticRefreshRequest,
	requestNeedsSemanticGrounding,
	shouldAttemptDirectSelectionEdit,
	shouldAttemptDirectVehicleEdit
} from './routing';
import type {
	FooterChatPresentationContext,
	FooterChatSidebarCard,
	FooterChatSidebarState,
	FooterChatSupplementaryListState,
	FooterChatTrace,
	FooterChatVehiclePatchOperation
} from './types';
import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import { recordSpanError, withActiveSpan } from '$lib/server/telemetry';

export const CHAT_TOOLS: ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: GET_VEHICLE_TOOL_CATALOG_TOOL_NAME,
			description:
				'Read-only gateway for tool choice. Returns the vehicle tool catalog, when each tool should be used, what state it operates on, and context-sensitive recommendations for the current goal and current selection or presentation state.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					goal: {
						type: 'string',
						description:
							'Optional restatement of the current user goal so the catalog can recommend the best tool or tool sequence.'
					},
					includeExamples: {
						type: 'boolean',
						description: 'Set true to include short usage examples in the catalog response.'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function',
		function: {
			name: APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME,
			description:
				'Apply material and appearance edits to the active asset or current selection. Use this for paint, tint, recolor, chrome, matte, gloss, metallic, pearl, and other appearance changes. This is for how something looks, not what it is semantically.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					request: {
						type: 'string',
						description:
							'Optional freeform appearance request such as 5% black tint, smoked glass, dark purple chrome, or make this matte black.'
					},
					colorFamily: {
						type: 'string',
						description:
							'Optional normalized core color family such as purple, blue, red, green, black, silver, white, bronze, gold, or gray.'
					},
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
					hex: {
						type: 'string',
						description: 'Optional exact color override in #RRGGBB, RRGGBB, #RGB, or RGB format.'
					},
					scope: {
						type: 'string',
						enum: ['asset', 'selection'],
						description:
							'Optional execution scope. Use selection when the user refers to the current selected runtime region.'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function',
		function: {
			name: APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME,
			description:
				'Apply visual focus operations to the active asset or current selection. Use this for highlight, focus, isolate, select, choose, pick out, remove, spotlight, and bring-out style presentation changes. This is for visual emphasis, not semantic classification.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					request: {
						type: 'string',
						description:
							'Freeform focus request such as highlight the wheels, select that wheel, choose these windows, isolate these windows, remove the front lighting, or bring out the grille.'
					},
					scope: {
						type: 'string',
						enum: ['asset', 'selection'],
						description:
							'Optional execution scope. Use selection when the user refers to the current selected runtime region.'
					}
				},
				required: ['request']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: RESTORE_VEHICLE_PRESENTATION_TOOL_NAME,
			description:
				'Clear or restore active presentation state from the current view context. Use this for remove all highlights, unhighlight these parts, restore hidden regions, disable active viewer modes, restore material drift, or return the current presentation to normal. This operates on current presentation state, not semantic meaning.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kind: {
						type: 'string',
						enum: ['highlights', 'hidden', 'viewer_modes', 'materials', 'all']
					},
					scope: {
						type: 'string',
						enum: ['all', 'matching'],
						description:
							'Use all to clear the whole active set of that presentation kind. Use matching when only a subset described by query should be restored.'
					},
					query: {
						type: 'string',
						description:
							'Optional freeform subset matcher such as wheels, shell, left door, or wireframe. Use this only with matching scope.'
					}
				},
				required: ['kind']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: SET_VEHICLE_VIEW_MODE_TOOL_NAME,
			description:
				'Enable or disable viewer-wide diagnostic modes on the active asset, such as wireframe, xray, uv debug, or postprocess.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					mode: {
						type: 'string',
						enum: ['wireframe', 'xray', 'uv_debug', 'postprocess']
					},
					enabled: {
						type: 'boolean',
						description: 'Set true to enable the mode or false to disable it.'
					}
				},
				required: ['mode', 'enabled']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: EXPAND_VEHICLE_SELECTION_TOOL_NAME,
			description:
				'Expand the current selected runtime region into a larger deterministic abstraction such as the whole node, a semantic part, or a semantic group.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					target: {
						type: 'string',
						enum: ['node', 'part', 'semantic_group']
					},
					query: {
						type: 'string',
						description:
							'Optional freeform semantic target such as wheel, wheels, glasshouse, or front lighting when expanding into a part or semantic group.'
					}
				},
				required: ['target']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME,
			description:
				'Assign currently selected runtime nodes or material regions into a shared semantic group for the active asset. Use this for straightforward assign-only semantic labeling of the current selection.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					nodeId: { type: 'string', description: 'A selected runtime node ID to annotate. Use this for single-node assignment.' },
					nodeIds: {
						type: 'array',
						items: { type: 'string' },
						description:
							'Optional list of selected runtime node IDs to annotate together when the user has multiselected nodes.'
					},
					semanticGroup: {
						type: 'string',
						description:
							'Freeform semantic group name from the user such as headlights, wheels, glasshouse, number plate, or propeller. Prefer this when mirroring the user wording.'
					},
					category: {
						type: 'string',
						enum: ['wheels', 'doors', 'front_lighting', 'rear_lighting', 'glasshouse', 'body_shell', 'front_face', 'trim', 'interior', 'other']
					},
					humanLabel: { type: 'string' },
					aliases: { type: 'array', items: { type: 'string' } }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: REFRESH_VEHICLE_SEMANTICS_TOOL_NAME,
			description:
				'Generate or refresh the semantic overlay for the active vehicle asset without changing structural manifest IDs. Use this only when the user explicitly wants semantic refresh, rebuild, regeneration, or reanalysis.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					force: {
						type: 'boolean',
						description:
							'Set true only when the user explicitly asks to refresh, rebuild, or regenerate semantics even if the overlay is already fresh.'
					}
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: MUTATE_VEHICLE_SEMANTIC_ASSIGNMENT_TOOL_NAME,
			description:
				'Assign, reassign, or unassign semantic meaning for selected, highlighted, hidden, or otherwise described runtime regions on the active asset. Use this when the user is saying what things are, should be, are no longer, or should move to semantically.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					action: {
						type: 'string',
						enum: ['assign', 'reassign', 'unassign']
					},
					scope: {
						type: 'string',
						enum: ['selected', 'highlighted', 'material_targets', 'hidden']
					},
					query: {
						type: 'string',
						description:
							'Optional freeform subset matcher for highlighted, hidden, or material-target scopes such as wheels, shell, left door, or headlights.'
					},
					nodeIds: {
						type: 'array',
						items: { type: 'string' }
					},
					semanticGroup: { type: 'string' },
					category: {
						type: 'string',
						enum: ['wheels', 'doors', 'front_lighting', 'rear_lighting', 'glasshouse', 'body_shell', 'front_face', 'trim', 'interior', 'other']
					},
					humanLabel: { type: 'string' },
					aliases: { type: 'array', items: { type: 'string' } }
				},
				required: ['action']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: ASSIGN_SEMANTIC_INGRESS_TOOL_NAME,
			description:
				'Assign a stable ingress endpoint set to a semantic group or semantic node on the active asset. Use this for endpoint, ingress, stream, feed, or hook requests tied to semantic targets.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					targetType: {
						type: 'string',
						enum: ['semantic_group', 'semantic_node']
					},
					targetId: {
						type: 'string',
						description: 'Semantic group id or runtime node id to bind.'
					},
					targetLabel: {
						type: 'string',
						description: 'Optional human label for the target.'
					},
					transport: {
						type: 'string',
						enum: ['rest_sse', 'stream']
					}
				},
				required: ['targetType', 'targetId', 'transport']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: SET_SUPPLEMENTARY_REFERENCE_LIST_TOOL_NAME,
			description:
				'Activate, deactivate, or update the footer supplementary reference list. Use this when a short list of reminders, active targets, compact next steps, or concise referential context would help the user without you saying every detail out loud.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					active: {
						type: 'boolean',
						description: 'Set true to show the supplementary list or false to clear it.'
					},
					items: {
						type: 'array',
						items: { type: 'string' },
						description:
							'Short list items for the supplementary footer pad. Prefer three to five terse entries.'
					}
				},
				required: ['active', 'items']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: SET_INTENT_SIDEBAR_TOOL_NAME,
			description:
				'Activate, deactivate, or update the inspector sidebar cards. Use sparingly when structured cards materially help the current inspection context.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					active: { type: 'boolean', description: 'Set true to show the sidebar or false to hide it.' },
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
					}
				},
				required: ['active', 'cards']
			}
		}
	}
];

function parseApplyVehicleAppearanceIntentToolArgs(input: string): ApplyVehicleAppearanceIntentToolArgs {
	const parsed = JSON.parse(input) as ApplyVehicleAppearanceIntentToolArgs;
	return {
		request: typeof parsed.request === 'string' ? parsed.request.trim() || undefined : undefined,
		colorFamily:
			typeof parsed.colorFamily === 'string' ? parsed.colorFamily.trim() || undefined : undefined,
		shade: parsed.shade,
		saturation: parsed.saturation,
		finish: parsed.finish,
		hex: parsed.hex,
		scope: parsed.scope === 'selection' ? 'selection' : 'asset'
	};
}

function parseApplyVehicleFocusIntentToolArgs(input: string): ApplyVehicleFocusIntentToolArgs {
	const parsed = JSON.parse(input) as ApplyVehicleFocusIntentToolArgs;
	return {
		request: parsed.request,
		scope: parsed.scope === 'selection' ? 'selection' : 'asset'
	};
}

function parseSetVehicleViewModeToolArgs(input: string): SetVehicleViewModeToolArgs {
	const parsed = JSON.parse(input) as SetVehicleViewModeToolArgs;
	if (!['wireframe', 'xray', 'uv_debug', 'postprocess'].includes(parsed.mode)) {
		throw new OpenAIChatInputError('A valid vehicle view mode is required.');
	}

	return {
		mode: parsed.mode,
		enabled: parsed.enabled !== false
	};
}

function parseGetVehicleToolCatalogToolArgs(input: string): GetVehicleToolCatalogToolArgs {
	if (!input.trim()) {
		return {};
	}

	const parsed = JSON.parse(input) as {
		goal?: unknown;
		includeExamples?: unknown;
	};

	return {
		goal: typeof parsed.goal === 'string' ? parsed.goal.trim() || undefined : undefined,
		includeExamples: parsed.includeExamples === true
	};
}

function parseRestoreVehiclePresentationToolArgs(
	input: string
): RestoreVehiclePresentationToolArgs {
	const parsed = JSON.parse(input) as RestoreVehiclePresentationToolArgs;
	if (!['highlights', 'hidden', 'viewer_modes', 'materials', 'all'].includes(parsed.kind)) {
		throw new OpenAIChatInputError('A valid presentation restore kind is required.');
	}

	return {
		kind: parsed.kind,
		scope: parsed.scope === 'matching' ? 'matching' : 'all',
		query: typeof parsed.query === 'string' ? parsed.query.trim() || undefined : undefined
	};
}

function parseExpandVehicleSelectionToolArgs(input: string): ExpandVehicleSelectionToolArgs {
	const parsed = JSON.parse(input) as ExpandVehicleSelectionToolArgs;
	if (!['node', 'part', 'semantic_group'].includes(parsed.target)) {
		throw new OpenAIChatInputError('A valid selection expansion target is required.');
	}

	return {
		target: parsed.target,
		query: typeof parsed.query === 'string' ? parsed.query.trim() || undefined : undefined
	};
}

function parseAnnotateVehicleSemanticGroupToolArgs(input: string) {
	const parsed = JSON.parse(input) as {
		nodeId?: string;
		nodeIds?: string[];
		semanticGroup?: string;
		category?: string;
		humanLabel?: string;
		aliases?: string[];
	};
	return {
		nodeIds: Array.isArray(parsed.nodeIds)
			? parsed.nodeIds
			: typeof parsed.nodeId === 'string'
				? [parsed.nodeId]
				: [],
		semanticGroup:
			typeof parsed.semanticGroup === 'string' ? parsed.semanticGroup.trim() || undefined : undefined,
		category: parsed.category as Parameters<typeof annotateVehicleSemanticGroup>[1]['category'],
		humanLabel: parsed.humanLabel,
		aliases: parsed.aliases
	};
}

function parseRefreshVehicleSemanticsToolArgs(input: string): RefreshVehicleSemanticsToolArgs {
	if (!input.trim()) {
		return {};
	}

	const parsed = JSON.parse(input) as RefreshVehicleSemanticsToolArgs;
	return {
		force: parsed.force === true
	};
}

function parseSetIntentSidebarToolArgs(input: string): SetIntentSidebarToolArgs {
	const parsed = JSON.parse(input) as SetIntentSidebarToolArgs;
	return {
		active: parsed.active === true,
		cards: Array.isArray(parsed.cards)
			? parsed.cards
					.map((card) => normalizeSidebarCard(card))
					.filter((card): card is FooterChatSidebarCard => card !== null)
			: []
	};
}

function parseSetSupplementaryReferenceListToolArgs(
	input: string
): SetSupplementaryReferenceListToolArgs {
	const parsed = JSON.parse(input) as SetSupplementaryReferenceListToolArgs;
	const normalized = normalizeSupplementaryListState({
		active: parsed.active === true,
		items: Array.isArray(parsed.items) ? parsed.items : []
	});

	return normalized ?? { active: false, items: [] };
}

function parseMutateVehicleSemanticAssignmentToolArgs(
	input: string
): MutateVehicleSemanticAssignmentToolArgs {
	const parsed = JSON.parse(input) as MutateVehicleSemanticAssignmentToolArgs;
	if (!['assign', 'reassign', 'unassign'].includes(parsed.action)) {
		throw new OpenAIChatInputError('A valid semantic assignment action is required.');
	}

	return {
		action: parsed.action,
		scope:
			parsed.scope === 'highlighted' ||
			parsed.scope === 'material_targets' ||
			parsed.scope === 'hidden'
				? parsed.scope
				: 'selected',
		nodeIds: Array.isArray(parsed.nodeIds)
			? parsed.nodeIds.filter(
					(value): value is string => typeof value === 'string' && value.trim().length > 0
			  )
			: undefined,
		query: typeof parsed.query === 'string' ? parsed.query.trim() || undefined : undefined,
		semanticGroup:
			typeof parsed.semanticGroup === 'string' ? parsed.semanticGroup.trim() || undefined : undefined,
		category: parsed.category,
		humanLabel:
			typeof parsed.humanLabel === 'string' ? parsed.humanLabel.trim() || undefined : undefined,
		aliases: Array.isArray(parsed.aliases)
			? parsed.aliases.filter(
					(value): value is string => typeof value === 'string' && value.trim().length > 0
			  )
			: undefined
	};
}

function parseAssignSemanticIngressToolArgs(input: string): AssignSemanticIngressToolArgs {
	const parsed = JSON.parse(input) as AssignSemanticIngressToolArgs;
	if (
		(parsed.targetType !== 'semantic_group' && parsed.targetType !== 'semantic_node') ||
		typeof parsed.targetId !== 'string' ||
		(parsed.transport !== 'rest_sse' && parsed.transport !== 'stream')
	) {
		throw new OpenAIChatInputError('A valid semantic ingress target and transport are required.');
	}

	return {
		targetType: parsed.targetType,
		targetId: parsed.targetId.trim(),
		targetLabel: typeof parsed.targetLabel === 'string' ? parsed.targetLabel.trim() || undefined : undefined,
		transport: parsed.transport
	};
}

function buildVehicleToolCatalog(
	args: GetVehicleToolCatalogToolArgs,
	activeAssetId?: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[] = [],
	presentation?: FooterChatPresentationContext
) {
	const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
	const hasHighlightedTargets = (presentation?.highlightedTargets?.length ?? 0) > 0;
	const hasMaterialTargets = (presentation?.materialTargets?.length ?? 0) > 0;
	const hasHiddenTargets = (presentation?.hiddenTargets?.length ?? 0) > 0;
	const hasViewerModes = (presentation?.viewerModes?.length ?? 0) > 0;

	const tools = [
		{
			name: APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME,
			purpose: 'material and appearance edits',
			useWhen:
				'the user wants paint, tint, recolor, finish, chrome, matte, gloss, metallic, pearl, or another look change',
			stateInputs: ['active asset', 'optional current selection'],
			examples: ['make this matte black', '5% black tint', 'paint the shell midnight purple']
		},
		{
			name: APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME,
			purpose: 'visual focus and presentation emphasis',
			useWhen:
				'the user wants highlight, focus, isolate, select, choose, pick out, remove, spotlight, or bring-out style visual emphasis',
			stateInputs: ['active asset', 'optional current selection'],
			examples: [
				'highlight the wheels',
				'select that wheel',
				'choose these windows',
				'isolate these windows',
				'bring out the grille'
			]
		},
		{
			name: RESTORE_VEHICLE_PRESENTATION_TOOL_NAME,
			purpose: 'clear or restore active presentation state',
			useWhen:
				'the user wants to remove current highlights, restore hidden regions, clear active material drift, disable active viewer modes, or return the current view to normal',
			stateInputs: ['active presentation context'],
			examples: [
				'remove all highlights',
				'unhighlight the wheel regions',
				'restore the current view to normal'
			]
		},
		{
			name: SET_VEHICLE_VIEW_MODE_TOOL_NAME,
			purpose: 'viewer-level mode changes',
			useWhen: 'the user wants xray, wireframe, uv debug, or postprocess mode changes',
			stateInputs: ['active asset'],
			examples: ['turn on xray', 'disable wireframe']
		},
		{
			name: EXPAND_VEHICLE_SELECTION_TOOL_NAME,
			purpose: 'expand the current selection to a larger deterministic target',
			useWhen:
				'the current selection is too narrow and should be lifted to a node, semantic part, or semantic group',
			stateInputs: ['active asset', 'current selection'],
			examples: ['expand this to the whole node', 'lift this selection to the wheel group']
		},
		{
			name: ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME,
			purpose: 'straightforward assign-only semantic labeling of the current selection',
			useWhen:
				'the user is simply assigning the current selected targets into a semantic group without reassign or unassign semantics',
			stateInputs: ['active asset', 'current selection'],
			examples: ['these are headlights', 'assign selected nodes to doors']
		},
		{
			name: MUTATE_VEHICLE_SEMANTIC_ASSIGNMENT_TOOL_NAME,
			purpose: 'semantic assign, reassign, or unassign across selected or active presentation targets',
			useWhen:
				'the user is saying what selected, highlighted, hidden, or discussed targets are, should be, are no longer, or should move to semantically',
			stateInputs: ['active asset', 'selection and-or presentation context'],
			examples: [
				'mark them as headlights',
				'the highlighted regions are not headlights anymore',
				'move these to front lighting',
				'the highlighted wheels are not headlights anymore'
			]
		},
		{
			name: REFRESH_VEHICLE_SEMANTICS_TOOL_NAME,
			purpose: 'refresh semantic overlay cache',
			useWhen: 'the user explicitly wants semantic refresh, rebuild, regenerate, or reanalysis',
			stateInputs: ['active asset'],
			examples: ['refresh semantics', 'rebuild the semantic overlay']
		},
		{
			name: ASSIGN_SEMANTIC_INGRESS_TOOL_NAME,
			purpose: 'bind an ingress endpoint to a semantic node or group',
			useWhen: 'the user wants an endpoint, ingress, feed, hook, or stream for a semantic target',
			stateInputs: ['active asset', 'semantic target'],
			examples: ['assign a rest and sse ingress for body shell']
		},
		{
			name: SET_INTENT_SIDEBAR_TOOL_NAME,
			purpose: 'update structured sidebar context',
			useWhen: 'a compact sidebar materially improves the current inspection context',
			stateInputs: ['optional sidebar context'],
			examples: ['show one semantics summary card']
		}
	];

	const recommendations: string[] = [];
	if (!activeAssetId) {
		recommendations.push('Select an active asset before using any mutating vehicle tool.');
	}
	if (scopedSelections.length > 0) {
		recommendations.push(
			'Current selection is available, so selection-scoped appearance, focus, expansion, and semantic assignment tools are valid.'
		);
	}
	if (hasHighlightedTargets || hasMaterialTargets || hasHiddenTargets || hasViewerModes) {
		recommendations.push(
			'Active presentation context is available, so restore_vehicle_presentation can clear current highlights, hidden regions, material drift, or viewer modes, and semantic mutation can target highlighted, hidden, or material-edited regions.'
		);
	}
	if (args.goal) {
		recommendations.push(
			`Current goal for tool choice: ${args.goal}. Choose from meaning and context rather than rigid phrasing.`
		);
	}

	return {
		goal: args.goal ?? null,
		context: {
			activeAssetId: activeAssetId ?? null,
			selectedNodeCount: scopedSelections.length,
			hasHighlightedTargets,
			hasMaterialTargets,
			hasHiddenTargets,
			hasViewerModes
		},
		tools: tools.map((tool) =>
			args.includeExamples ? tool : { ...tool, examples: undefined }
		),
		recommendations
	};
}

export function mergePatchOperations(
	current: FooterChatVehiclePatchOperation[],
	incoming: FooterChatVehiclePatchOperation[]
): FooterChatVehiclePatchOperation[] {
	const merged = new Map(
		current.map((operation) => [`${operation.targetType}:${operation.targetId}:${operation.op}`, operation])
	);

	for (const operation of incoming) {
		merged.set(`${operation.targetType}:${operation.targetId}:${operation.op}`, operation);
	}

	return Array.from(merged.values());
}

async function restrictOperationsToSelection(
	activeAssetId: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[],
	operations: FooterChatVehiclePatchOperation[]
): Promise<FooterChatVehiclePatchOperation[]> {
	const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
	if (scopedSelections.length === 0) {
		return [];
	}

	const structure = await deriveStructuralAssetSnapshot(activeAssetId);
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));
	const selectedNodeIds = new Set(scopedSelections.map((selection) => selection.nodeId));
	const selectedMaterialIds = new Set<string>();

	for (const selection of scopedSelections) {
		const node = nodeById.get(selection.nodeId);
		if (!node?.meshId) {
			continue;
		}

		const mesh = meshById.get(node.meshId);
		if (!mesh) {
			continue;
		}

		if (
			typeof selection.materialIndex === 'number' &&
			selection.materialIndex >= 0 &&
			selection.materialIndex < mesh.materialIds.length
		) {
			selectedMaterialIds.add(mesh.materialIds[selection.materialIndex]!);
			continue;
		}

		if (selection.materialName) {
			mesh.materialIds.forEach((materialId, index) => {
				if (mesh.materialNames[index] === selection.materialName) {
					selectedMaterialIds.add(materialId);
				}
			});
			continue;
		}

		mesh.materialIds.forEach((materialId) => selectedMaterialIds.add(materialId));
	}

	return operations.filter((operation) => {
		if (operation.targetType === 'node') {
			return selectedNodeIds.has(operation.targetId);
		}
		if (operation.targetType === 'material') {
			return selectedMaterialIds.has(operation.targetId);
		}
		return false;
	});
}

export async function attemptDirectVehicleEdit(
	input: NormalizedFooterChatRequest,
	model: string
) {
	if (!input.assetId || !shouldAttemptDirectVehicleEdit(input)) {
		return null;
	}

	const result = await resolveVehicleIntent(input.assetId, input.message);
	const shouldScopeToSelection = shouldAttemptDirectSelectionEdit(input);
	const plannedOperations = shouldScopeToSelection
		? await restrictOperationsToSelection(input.assetId, input.selectedNodes, result.operations)
		: result.operations;

	if (plannedOperations.length === 0) {
		return null;
	}

	const summary = shouldScopeToSelection ? `${result.summary} Scoped to selection.` : result.summary;

	return {
		model,
		message: {
			role: 'assistant' as const,
			content: summary
		},
		vehiclePatchAssetId: input.assetId,
		vehiclePatchLabel: summary,
		vehiclePatchOperations: plannedOperations
	};
}

function buildViewModeRequest(args: SetVehicleViewModeToolArgs): string {
	const modeLabel =
		args.mode === 'uv_debug' ? 'uv debug' : args.mode === 'postprocess' ? 'postprocess' : args.mode;
	return `${args.enabled ? 'enable' : 'disable'} ${modeLabel}`;
}

async function expandVehicleSelection(
	activeAssetId: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[],
	args: ExpandVehicleSelectionToolArgs
): Promise<{ selectedNodes: VehicleNodeSelection[]; label: string }> {
	const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
	if (scopedSelections.length === 0) {
		throw new OpenAIChatInputError('No selected runtime nodes are available to expand.');
	}

	const structure = await deriveStructuralAssetSnapshot(activeAssetId);
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const meshById = new Map(structure.meshes.map((mesh) => [mesh.id, mesh]));

	if (args.target === 'node') {
		return {
			selectedNodes: scopedSelections.map((selection) => ({
				assetId: activeAssetId,
				nodeId: selection.nodeId,
				nodeName: selection.nodeName,
				nodePath: selection.nodePath
			})),
			label: 'Expanded selection to whole node.'
		};
	}

	const overlay = await readVehicleSemanticOverlay(activeAssetId);
	if (!overlay) {
		throw new OpenAIChatInputError('No semantic overlay is available to expand this selection.');
	}

	const selectedNodeIds = new Set(scopedSelections.map((selection) => selection.nodeId));
	const selectedMaterialIds = new Set<string>();
	for (const selection of scopedSelections) {
		const node = nodeById.get(selection.nodeId);
		if (!node?.meshId) {
			continue;
		}
		const mesh = meshById.get(node.meshId);
		if (!mesh) {
			continue;
		}
		if (
			typeof selection.materialIndex === 'number' &&
			selection.materialIndex >= 0 &&
			selection.materialIndex < mesh.materialIds.length
		) {
			selectedMaterialIds.add(mesh.materialIds[selection.materialIndex]!);
			continue;
		}
		if (selection.materialName) {
			mesh.materialIds.forEach((materialId, index) => {
				if (mesh.materialNames[index] === selection.materialName) {
					selectedMaterialIds.add(materialId);
				}
			});
		}
	}

	const query = args.query?.toLowerCase();
	const candidateEntities =
		args.target === 'part'
			? overlay.acceptedParts.filter((part) => {
					const matchesSelection =
						part.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)) ||
						part.materialIds.some((materialId) => selectedMaterialIds.has(materialId));
					if (!matchesSelection) return false;
					if (!query) return true;
					return `${part.id} ${part.humanLabel} ${part.aliases.join(' ')}`
						.toLowerCase()
						.includes(query);
			  })
			: overlay.acceptedGroups.filter((group) => {
					const matchesSelection =
						group.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)) ||
						group.materialIds.some((materialId) => selectedMaterialIds.has(materialId));
					if (!matchesSelection) return false;
					if (!query) return true;
					return `${group.id} ${group.humanLabel} ${group.aliases.join(' ')}`
						.toLowerCase()
						.includes(query);
			  });

	const bestEntity = candidateEntities.sort((left, right) => {
		const leftCoverage = left.nodeIds.length * 10 + left.materialIds.length;
		const rightCoverage = right.nodeIds.length * 10 + right.materialIds.length;
		if (leftCoverage !== rightCoverage) {
			return rightCoverage - leftCoverage;
		}
		return right.confidence - left.confidence;
	})[0];

	if (!bestEntity) {
		throw new OpenAIChatInputError(
			args.target === 'part'
				? 'No semantic part matched the current selection.'
				: 'No semantic group matched the current selection.'
		);
	}

	const expandedNodeIds = Array.from(
		new Set([
			...bestEntity.nodeIds,
			...bestEntity.materialIds.flatMap(
				(materialId) => structure.materials.find((material) => material.id === materialId)?.nodeIds ?? []
			)
		])
	);

	const expandedSelections = expandedNodeIds
		.map((nodeId) => {
			const node = nodeById.get(nodeId);
			if (!node) {
				return null;
			}
			return {
				assetId: activeAssetId,
				nodeId,
				nodeName: node.name.trim() || nodeId,
				nodePath: node.path
			};
		})
		.filter((entry): entry is VehicleNodeSelection => entry !== null);

	if (expandedSelections.length === 0) {
		throw new OpenAIChatInputError('Expanded semantic selection did not resolve any runtime nodes.');
	}

	return {
		selectedNodes: expandedSelections,
		label:
			args.target === 'part'
				? `Expanded selection to part ${bestEntity.humanLabel}.`
				: `Expanded selection to semantic group ${bestEntity.humanLabel}.`
	};
}

export async function executeToolCall(
	toolCall: { id: string; function: { name: string; arguments: string } },
	activeAssetId?: VehicleAssetId,
	selectedNodes: VehicleNodeSelection[] = [],
	presentation?: FooterChatPresentationContext
): Promise<ExecutedToolResult> {
	return withActiveSpan(
		'mobisim.chat',
		`tool.${toolCall.function.name}`,
		{
			attributes: {
				'mobisim.chat.tool_name': toolCall.function.name,
				'mobisim.chat.asset_id': activeAssetId ?? 'none',
				'mobisim.chat.selected_node_count': selectedNodes.filter(
					(selection) => selection.assetId === activeAssetId
				).length,
				'mobisim.chat.has_presentation_context': presentation !== undefined
			}
		},
		async () => {
	if (toolCall.function.name === GET_VEHICLE_TOOL_CATALOG_TOOL_NAME) {
		try {
			const args = parseGetVehicleToolCatalogToolArgs(toolCall.function.arguments);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify(
						buildVehicleToolCatalog(args, activeAssetId, selectedNodes, presentation)
					)
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === APPLY_VEHICLE_APPEARANCE_INTENT_TOOL_NAME) {
		try {
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}
			const args = parseApplyVehicleAppearanceIntentToolArgs(toolCall.function.arguments);
			if (args.colorFamily && !args.request) {
				const result = await planNormalizedVehiclePaintIntent(activeAssetId, {
					colorFamily: args.colorFamily,
					shade: args.shade,
					saturation: args.saturation,
					finish: args.finish,
					hex: args.hex
				});
				const plannedOperations =
					args.scope === 'selection'
						? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
						: result.operations;
				return {
					message: {
						role: 'tool',
						tool_call_id: toolCall.id,
						content: JSON.stringify({ ...result, operations: plannedOperations, scope: args.scope })
					},
					plannedOperations,
					intentLabel:
						args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
				};
			}
			if (!args.request) {
				throw new OpenAIChatInputError(
					'A freeform appearance request or normalized paint fields are required.'
				);
			}
			const result = await resolveVehicleIntent(activeAssetId, args.request);
			const plannedOperations =
				args.scope === 'selection'
					? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
					: result.operations;
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ ...result, operations: plannedOperations, scope: args.scope })
				},
				plannedOperations,
				intentLabel:
					args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === APPLY_VEHICLE_FOCUS_INTENT_TOOL_NAME) {
		try {
			const args = parseApplyVehicleFocusIntentToolArgs(toolCall.function.arguments);
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}
			const result = await resolveVehicleIntent(activeAssetId, args.request);
			const plannedOperations =
				args.scope === 'selection'
					? await restrictOperationsToSelection(activeAssetId, selectedNodes, result.operations)
					: result.operations;
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ ...result, operations: plannedOperations, scope: args.scope })
				},
				plannedOperations,
				intentLabel:
					args.scope === 'selection' ? `${result.summary} Scoped to selection.` : result.summary
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === RESTORE_VEHICLE_PRESENTATION_TOOL_NAME) {
		try {
			const args = parseRestoreVehiclePresentationToolArgs(toolCall.function.arguments);
			const restore = buildPresentationRestoreFromInstruction(args, presentation);
			if (!restore) {
				throw new OpenAIChatInputError(
					'No matching active presentation state was available to restore.'
				);
			}

			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						kind: args.kind,
						scope: args.scope,
						query: args.query,
						restore
					})
				},
				presentationRestore: restore
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === SET_VEHICLE_VIEW_MODE_TOOL_NAME) {
		try {
			const args = parseSetVehicleViewModeToolArgs(toolCall.function.arguments);
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}
			const result = await resolveVehicleIntent(activeAssetId, buildViewModeRequest(args));
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ ...result, mode: args.mode, enabled: args.enabled })
				},
				plannedOperations: result.operations,
				intentLabel: result.summary
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === EXPAND_VEHICLE_SELECTION_TOOL_NAME) {
		try {
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for selection expansion.');
			}
			const args = parseExpandVehicleSelectionToolArgs(toolCall.function.arguments);
			const expansion = await expandVehicleSelection(activeAssetId, selectedNodes, args);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						target: args.target,
						query: args.query,
						selectedNodeCount: expansion.selectedNodes.length,
						label: expansion.label
					})
				},
				selectionUpdate: expansion.selectedNodes,
				selectionUpdateLabel: expansion.label
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME) {
		try {
			const args = parseAnnotateVehicleSemanticGroupToolArgs(toolCall.function.arguments);
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}
			if (args.nodeIds.length === 0) {
				throw new OpenAIChatInputError('No selected runtime node IDs were provided for semantic annotation.');
			}
			if (!args.semanticGroup && !args.category) {
				throw new OpenAIChatInputError('A semantic group name or category is required for semantic annotation.');
			}
			const scopedSelections = selectedNodes.filter(
				(selection) => selection.assetId === activeAssetId && args.nodeIds.includes(selection.nodeId)
			);
			const overlay = await annotateVehicleSemanticGroup(activeAssetId, {
				...args,
				materialSelections: scopedSelections.map((selection) => ({
					nodeId: selection.nodeId,
					materialIndex: selection.materialIndex,
					materialName: selection.materialName
				}))
			});
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						assetId: overlay.assetId,
						category: args.category,
						semanticGroup: args.semanticGroup,
						nodeIds: args.nodeIds,
						acceptedGroupCount: overlay.acceptedGroups.length
					})
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === MUTATE_VEHICLE_SEMANTIC_ASSIGNMENT_TOOL_NAME) {
		try {
			const args = parseMutateVehicleSemanticAssignmentToolArgs(toolCall.function.arguments);
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}

			const scopedSelections = selectedNodes.filter((selection) => selection.assetId === activeAssetId);
			const selectedNodeIds =
				args.nodeIds && args.nodeIds.length > 0
					? args.nodeIds
					: args.scope === 'hidden'
						? args.query
							? selectMatchingPresentationTargetIds(args.query, presentation?.hiddenTargets)
							: (presentation?.hiddenTargets ?? []).map((target) => target.targetId)
						: scopedSelections.map((selection) => selection.nodeId);
			const materialIds =
				args.scope === 'highlighted'
					? args.query
						? selectMatchingPresentationTargetIds(args.query, presentation?.highlightedTargets)
						: (presentation?.highlightedTargets ?? []).map((target) => target.targetId)
					: args.scope === 'material_targets'
						? args.query
							? selectMatchingPresentationTargetIds(args.query, presentation?.materialTargets)
							: (presentation?.materialTargets ?? []).map((target) => target.targetId)
						: [];

			if (selectedNodeIds.length === 0 && materialIds.length === 0) {
				throw new OpenAIChatInputError(
					'No selected, highlighted, hidden, or described runtime targets were available for semantic mutation.'
				);
			}

			const overlay = await mutateVehicleSemanticAssignment(activeAssetId, {
				action: args.action,
				nodeIds: selectedNodeIds,
				materialIds,
				semanticGroup: args.semanticGroup,
				category: args.category,
				humanLabel: args.humanLabel,
				aliases: args.aliases,
				materialSelections:
					args.scope === 'selected'
						? scopedSelections
								.filter((selection) => selectedNodeIds.includes(selection.nodeId))
								.map((selection) => ({
									nodeId: selection.nodeId,
									materialIndex: selection.materialIndex,
									materialName: selection.materialName
								}))
						: undefined
			});
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
						content: JSON.stringify({
							action: args.action,
							nodeIds: selectedNodeIds,
							materialIds,
							query: args.query,
							semanticGroup: args.semanticGroup,
							category: args.category,
							acceptedGroupCount: overlay.acceptedGroups.length
					})
				},
				presentationRestore:
					args.action === 'unassign' && args.scope === 'highlighted' && materialIds.length > 0
						? {
								highlightedTargetIds: materialIds,
								label: 'restore original view'
							}
						: undefined
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === REFRESH_VEHICLE_SEMANTICS_TOOL_NAME) {
		try {
			const args = parseRefreshVehicleSemanticsToolArgs(toolCall.function.arguments);
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for semantic refresh.');
			}
			const overlay = await generateVehicleSemanticOverlay(activeAssetId, {
				force: args.force === true
			});
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						assetId: overlay.assetId,
						generatedAt: overlay.generatedAt,
						structuralGeneratedAt: overlay.structuralGeneratedAt,
						acceptedMaterialCount: overlay.acceptedMaterials.length,
						discardedSuggestionCount: overlay.discardedSuggestions.length
					})
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === SET_INTENT_SIDEBAR_TOOL_NAME) {
		try {
			const args = parseSetIntentSidebarToolArgs(toolCall.function.arguments);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ active: args.active, cardCount: args.cards.length })
				},
				sidebar: {
					active: args.active,
					cards: args.cards
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === SET_SUPPLEMENTARY_REFERENCE_LIST_TOOL_NAME) {
		try {
			const args = parseSetSupplementaryReferenceListToolArgs(toolCall.function.arguments);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ active: args.active, itemCount: args.items.length })
				},
				supplementaryList: {
					active: args.active,
					items: args.items
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	if (toolCall.function.name === ASSIGN_SEMANTIC_INGRESS_TOOL_NAME) {
		try {
			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for semantic ingress.');
			}

			const args = parseAssignSemanticIngressToolArgs(toolCall.function.arguments);
			const binding = await assignSemanticIngress({
				assetId: activeAssetId,
				targetType: args.targetType,
				targetId: args.targetId,
				targetLabel: args.targetLabel,
				transport: args.transport,
				assignedBy: 'model'
			});
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify(binding)
				}
			};
		} catch (error) {
			recordSpanError(error);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed.' })
				}
			};
		}
	}

	return {
		message: {
			role: 'tool',
			tool_call_id: toolCall.id,
			content: JSON.stringify({ error: `Unsupported tool: ${toolCall.function.name}` })
		}
	};
		}
	);
}

function resolveSemanticSidebarCadence(
	input: NormalizedFooterChatRequest,
	status: SemanticOverlayState,
	overlay?: SemanticOverlayPromptContext['overlay']
): SemanticOverlayPromptContext['sidebarCadence'] {
	const semanticsMatter =
		isSemanticRefreshRequest(input.message) ||
		requestNeedsSemanticGrounding(input.message) ||
		isSelectionExpansionRequest(input.message) ||
		isSemanticAnnotationRequest(input.message);

	if (!semanticsMatter) {
		return 'stable';
	}
	if (status === 'missing' || status === 'stale') {
		return 'caution';
	}
	if (status === 'fresh' && overlay) {
		return 'summary';
	}
	return 'stable';
}

export async function resolveSemanticOverlayPromptContext(
	input: NormalizedFooterChatRequest
): Promise<SemanticOverlayPromptContext> {
	if (!input.assetId) {
		return { status: 'unknown', sidebarCadence: 'stable' };
	}

	const capabilities = await deriveVehicleInspectionCapabilities(input.assetId);
	const status = await getVehicleSemanticOverlayStatus(input.assetId, capabilities.generatedAt);
	const overlay =
		status === 'fresh' || status === 'stale' ? await readVehicleSemanticOverlay(input.assetId) : undefined;

	return {
		status,
		overlay: overlay ?? undefined,
		sidebarCadence: resolveSemanticSidebarCadence(input, status, overlay ?? undefined)
	};
}

export function resolveSidebarAction(
	previousSidebar: FooterChatSidebarState | undefined,
	nextSidebar: FooterChatSidebarState | undefined
): FooterChatTrace['sidebarAction'] {
	const previousActive = previousSidebar?.active === true && (previousSidebar.cards.length ?? 0) > 0;
	const nextActive = nextSidebar?.active === true && (nextSidebar.cards.length ?? 0) > 0;

	if (previousActive && !nextActive) {
		return 'cleared';
	}
	if (JSON.stringify(previousSidebar ?? null) !== JSON.stringify(nextSidebar ?? null)) {
		return 'updated';
	}
	return 'unchanged';
}

export function resolveSupplementaryListAction(
	previousList: FooterChatSupplementaryListState | undefined,
	nextList: FooterChatSupplementaryListState | undefined
): FooterChatTrace['supplementaryListAction'] {
	const previousActive = previousList?.active === true && (previousList.items.length ?? 0) > 0;
	const nextActive = nextList?.active === true && (nextList.items.length ?? 0) > 0;

	if (previousActive && !nextActive) {
		return 'cleared';
	}
	if (JSON.stringify(previousList ?? null) !== JSON.stringify(nextList ?? null)) {
		return 'updated';
	}
	return 'unchanged';
}
