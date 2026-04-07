import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import type {
	ChatCompletionMessageParam,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption
} from 'openai/resources/chat/completions';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import {
	annotateVehicleSemanticGroup,
	generateVehicleSemanticOverlay,
	getVehicleSemanticOverlayStatus
} from '$lib/server/connectors/vehicle-semantic-overlay';
import {
	isVehicleEditRequest,
	planNormalizedVehiclePaintIntent,
	resolveVehicleIntent,
	type NormalizedVehiclePaintIntent
} from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId, type VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	FooterChatRequest,
	FooterChatResponse,
	FooterChatVehiclePatchOperation
} from './types';
import type { VehicleSemanticGroupAnnotation } from '$lib/server/connectors/vehicle-semantic-overlay/types';

const DEFAULT_MODEL = 'gpt-5.2';
const MAX_TOOL_ROUNDS = 2;
const APPLY_VEHICLE_INTENT_TOOL_NAME = 'apply_vehicle_intent';
const APPLY_VEHICLE_PAINT_INTENT_TOOL_NAME = 'apply_vehicle_paint_intent';
const ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME = 'annotate_vehicle_semantic_group';
const REFRESH_VEHICLE_SEMANTICS_TOOL_NAME = 'refresh_vehicle_semantics';

let client: OpenAI | null = null;

export class OpenAIChatConfigError extends Error {}
export class OpenAIChatInputError extends Error {}
export class OpenAIChatUpstreamError extends Error {}

function getClient(): OpenAI {
	if (!env.OPENAI_API_KEY) {
		throw new OpenAIChatConfigError('OPENAI_API_KEY is not configured.');
	}

	client ??= new OpenAI({
		apiKey: env.OPENAI_API_KEY
	});

	return client;
}

type NormalizedFooterChatRequest = {
	message: string;
	assetId?: VehicleAssetId;
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
};

type SemanticOverlayState = 'missing' | 'stale' | 'fresh' | 'unknown';

function normalizeRequest(input: FooterChatRequest): NormalizedFooterChatRequest {
	const message = input.message.trim();

	if (!message) {
		throw new OpenAIChatInputError('Message is required.');
	}

	return {
		message,
		assetId: input.assetId && isVehicleAssetId(input.assetId) ? input.assetId : undefined,
		selectedNodeId: typeof input.selectedNodeId === 'string' ? input.selectedNodeId.trim() || undefined : undefined,
		selectedNodeName:
			typeof input.selectedNodeName === 'string' ? input.selectedNodeName.trim() || undefined : undefined,
		selectedNodePath:
			typeof input.selectedNodePath === 'string' ? input.selectedNodePath.trim() || undefined : undefined
	};
}

function toOpenAIMessages(
	input: NormalizedFooterChatRequest,
	semanticOverlayState: SemanticOverlayState
): ChatCompletionMessageParam[] {
	const activeAssetLine = input.assetId
		? `Active asset ID: ${input.assetId}.`
		: 'No active asset ID was provided.';
	const semanticOverlayLine = input.assetId
		? `Semantic overlay status for the active asset: ${semanticOverlayState}.`
		: 'Semantic overlay status is unavailable because no active asset was provided.';
	const selectedNodeLine =
		input.assetId && input.selectedNodeId
			? `Selected runtime node context: ${input.selectedNodeId}${input.selectedNodeName ? ` (${input.selectedNodeName})` : ''}${input.selectedNodePath ? ` at path ${input.selectedNodePath}` : ''}.`
			: 'No runtime node is currently selected.';

	return [
		{
			role: 'developer',
			content: `You are the Mobisim footer assistant. Be concise, practical, and technical. Keep responses short by default.
Use the vehicle intent tool whenever the user asks to change the current vehicle or viewer state, such as wireframe, highlights, body color, window tint, headlights, visibility, or postprocessing.
For nuanced body paint requests, prefer the normalized paint intent tool so you can express color family, shade, saturation, and finish explicitly.
Use the semantic refresh tool when the user explicitly asks to enrich, refresh, rebuild, or reanalyze vehicle semantics.
Use the semantic group annotation tool when the user says the selected node belongs to a semantic group like wheels, doors, glasshouse, body shell, front face, trim, interior, front lighting, rear lighting, or other. Only do this when the user is explicitly assigning semantics, not when merely asking a question.
Do not regenerate semantic overlays unless the user explicitly asks to refresh, rebuild, or regenerate semantics.
Semantic overlays are shared cached artifacts across sessions. Missing or stale overlays should be reported, not rebuilt automatically.
Infer the user's intent freely from the request, but rely on the tool to resolve that request into valid deterministic operations.
Only say a vehicle edit was applied when the tool returned one or more accepted operations. If no operations were accepted, say that you could not apply the requested change.
The executor owns asset selection deterministically. The tool always applies to the active asset only, never to an inferred or alternate asset.
${activeAssetLine}
${semanticOverlayLine}
${selectedNodeLine}`
		},
		{
			role: 'user',
			content: input.message
		}
	];
}

const CHAT_TOOLS: ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: APPLY_VEHICLE_INTENT_TOOL_NAME,
			description:
				'Resolve a freeform vehicle-edit request into validated deterministic patch operations for the active vehicle asset.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					request: {
						type: 'string',
						description:
							'Freeform vehicle-edit request such as black panther purple body, 5% tint, highlight wheels, turn headlights on, show wireframe, or enable xray.'
					}
				},
				required: ['request']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: APPLY_VEHICLE_PAINT_INTENT_TOOL_NAME,
			description:
				'Apply a normalized body-paint intent for the active asset using deterministic server-side color and finish mapping.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					colorFamily: {
						type: 'string',
						description:
							'Core color family such as purple, blue, red, green, black, silver, white, bronze, gold, or gray.'
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
						description:
							'Optional exact color override in #RRGGBB, RRGGBB, #RGB, or RGB format.'
					}
				},
				required: ['colorFamily']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: ANNOTATE_VEHICLE_SEMANTIC_GROUP_TOOL_NAME,
			description:
				'Assign the currently selected runtime node to a shared semantic group for the active asset.',
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					nodeId: {
						type: 'string',
						description:
							'The selected runtime node ID to annotate. Copy this from the provided selected node context.'
					},
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
					humanLabel: {
						type: 'string',
						description:
							'Optional human label, especially useful when category is other, such as propeller or number plate.'
					},
					aliases: {
						type: 'array',
						items: { type: 'string' }
					}
				},
				required: ['nodeId', 'category']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: REFRESH_VEHICLE_SEMANTICS_TOOL_NAME,
			description:
				'Generate or refresh the semantic overlay for the active vehicle asset without changing any structural manifest IDs.',
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
	}
];

type ApplyVehicleIntentToolArgs = {
	request: string;
};

type ApplyVehiclePaintIntentToolArgs = NormalizedVehiclePaintIntent;
type AnnotateVehicleSemanticGroupToolArgs = VehicleSemanticGroupAnnotation;

type RefreshVehicleSemanticsToolArgs = {
	force?: boolean;
};

type ExecutedToolResult = {
	message: ChatCompletionMessageParam;
	plannedOperations?: FooterChatVehiclePatchOperation[];
	intentLabel?: string;
};

function isSemanticRefreshRequest(message: string): boolean {
	return /\b(refresh|rebuild|regenerate|reanaly[sz]e|enrich)\b.*\b(semantic|semantics|overlay|manifest|labels?)\b/i.test(
		message
	);
}

function requestNeedsSemanticGrounding(message: string): boolean {
	return /\b(paint|repaint|body color|body paint|glass|window|tint|headlight|headlights|wheel|wheels|rim|rims|grille|highlight|isolate|spotlight)\b/i.test(
		message
	);
}

function isSemanticAnnotationRequest(message: string): boolean {
	return /\b(belongs to|part of|group this as|classify this as|mark this as|assign this to)\b/i.test(
		message
	);
}

function getToolChoiceForRequest(
	input: NormalizedFooterChatRequest
): ChatCompletionToolChoiceOption | undefined {
	if (
		!isVehicleEditRequest(input.message) &&
		!isSemanticRefreshRequest(input.message) &&
		!(input.selectedNodeId && isSemanticAnnotationRequest(input.message))
	) {
		return undefined;
	}

	return 'required';
}

function parseApplyVehicleIntentToolArgs(input: string): ApplyVehicleIntentToolArgs {
	const parsed = JSON.parse(input) as ApplyVehicleIntentToolArgs;
	return {
		request: parsed.request
	};
}

function parseApplyVehiclePaintIntentToolArgs(input: string): ApplyVehiclePaintIntentToolArgs {
	const parsed = JSON.parse(input) as ApplyVehiclePaintIntentToolArgs;
	return {
		colorFamily: parsed.colorFamily,
		shade: parsed.shade,
		saturation: parsed.saturation,
		finish: parsed.finish,
		hex: parsed.hex
	};
}

function parseAnnotateVehicleSemanticGroupToolArgs(input: string): AnnotateVehicleSemanticGroupToolArgs {
	const parsed = JSON.parse(input) as AnnotateVehicleSemanticGroupToolArgs;
	return {
		nodeId: parsed.nodeId,
		category: parsed.category,
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

function mergePatchOperations(
	current: FooterChatVehiclePatchOperation[],
	incoming: FooterChatVehiclePatchOperation[]
): FooterChatVehiclePatchOperation[] {
	const merged = new Map(
		current.map((operation) => [
			`${operation.targetType}:${operation.targetId}:${operation.op}`,
			operation
		])
	);

	for (const operation of incoming) {
		merged.set(`${operation.targetType}:${operation.targetId}:${operation.op}`, operation);
	}

	return Array.from(merged.values());
}

async function executeToolCall(
	toolCall: {
		id: string;
		function: { name: string; arguments: string };
	},
	activeAssetId?: VehicleAssetId
): Promise<ExecutedToolResult> {
	if (toolCall.function.name === APPLY_VEHICLE_INTENT_TOOL_NAME) {
		try {
			const args = parseApplyVehicleIntentToolArgs(toolCall.function.arguments);

			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}

			const result = await resolveVehicleIntent(activeAssetId, args.request);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify(result)
				},
				plannedOperations: result.operations,
				intentLabel: result.summary
			};
		} catch (error) {
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						error: error instanceof Error ? error.message : 'Tool execution failed.'
					})
				}
			};
		}
	}

	if (toolCall.function.name === APPLY_VEHICLE_PAINT_INTENT_TOOL_NAME) {
		try {
			const args = parseApplyVehiclePaintIntentToolArgs(toolCall.function.arguments);

			if (!activeAssetId) {
				throw new OpenAIChatInputError('No active vehicle asset is available for this request.');
			}

			const result = await planNormalizedVehiclePaintIntent(activeAssetId, args);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify(result)
				},
				plannedOperations: result.operations,
				intentLabel: result.summary
			};
		} catch (error) {
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						error: error instanceof Error ? error.message : 'Tool execution failed.'
					})
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

			const overlay = await annotateVehicleSemanticGroup(activeAssetId, args);
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						assetId: overlay.assetId,
						category: args.category,
						nodeId: args.nodeId,
						acceptedGroupCount: overlay.acceptedGroups.length
					})
				}
			};
		} catch (error) {
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						error: error instanceof Error ? error.message : 'Tool execution failed.'
					})
				}
			};
		}
	}

	if (toolCall.function.name === REFRESH_VEHICLE_SEMANTICS_TOOL_NAME) {
		try {
			const args = parseRefreshVehicleSemanticsToolArgs(toolCall.function.arguments);

			if (!activeAssetId) {
				throw new OpenAIChatInputError(
					'No active vehicle asset is available for semantic refresh.'
				);
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
			return {
				message: {
					role: 'tool',
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						error: error instanceof Error ? error.message : 'Tool execution failed.'
					})
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

async function resolveSemanticOverlayState(
	input: NormalizedFooterChatRequest
): Promise<SemanticOverlayState> {
	if (!input.assetId) {
		return 'unknown';
	}

	if (!isSemanticRefreshRequest(input.message) && !requestNeedsSemanticGrounding(input.message)) {
		return 'unknown';
	}

	const capabilities = await deriveVehicleInspectionCapabilities(input.assetId);
	return getVehicleSemanticOverlayStatus(input.assetId, capabilities.generatedAt);
}

export async function createFooterChatResponse(
	input: FooterChatRequest
): Promise<FooterChatResponse> {
	const normalized = normalizeRequest(input);
	const model = env.OPENAI_MODEL || DEFAULT_MODEL;
	const openai = getClient();
	const toolChoice = getToolChoiceForRequest(normalized);

	try {
		if (toolChoice && !normalized.assetId) {
			return {
				model,
				message: {
					role: 'assistant',
					content: 'Select a vehicle asset first, then I can apply that edit.'
				}
			};
		}

		const semanticOverlayState = await resolveSemanticOverlayState(normalized);

		const messages = toOpenAIMessages(normalized, semanticOverlayState);
		let vehiclePatchOperations: FooterChatVehiclePatchOperation[] = [];
		let vehiclePatchLabel: string | undefined;
		let completion = await openai.chat.completions.create({
			model,
			messages,
			tools: CHAT_TOOLS,
			tool_choice: toolChoice
		});

		for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
			const assistantMessage = completion.choices[0]?.message;
			const toolCalls = assistantMessage?.tool_calls;

			if (!toolCalls || toolCalls.length === 0) {
				break;
			}

			messages.push(assistantMessage);

			for (const toolCall of toolCalls) {
				if (toolCall.type !== 'function') {
					continue;
				}

				const toolResult = await executeToolCall(toolCall, normalized.assetId);
				messages.push(toolResult.message);

				if (toolResult.plannedOperations && toolResult.plannedOperations.length > 0) {
					vehiclePatchOperations = mergePatchOperations(
						vehiclePatchOperations,
						toolResult.plannedOperations
					);
					vehiclePatchLabel = toolResult.intentLabel ?? vehiclePatchLabel;
				}
			}

			completion = await openai.chat.completions.create({
				model,
				messages,
				tools: CHAT_TOOLS
			});
		}

		const content = completion.choices[0]?.message?.content;
		const text = Array.isArray(content)
			? content
					.map((part) => ('text' in part ? part.text : ''))
					.join('')
					.trim()
			: content?.trim();

		if (!text) {
			if (vehiclePatchOperations.length > 0) {
				return {
					model,
					message: {
						role: 'assistant',
						content: 'Applied the requested vehicle edit.'
					},
					vehiclePatchAssetId: normalized.assetId,
					vehiclePatchLabel,
					vehiclePatchOperations
				};
			}

			throw new OpenAIChatConfigError('OpenAI returned an empty response.');
		}

		return {
			model,
			message: {
				role: 'assistant',
				content: text
			},
			vehiclePatchAssetId: vehiclePatchOperations.length > 0 ? normalized.assetId : undefined,
			vehiclePatchLabel: vehiclePatchOperations.length > 0 ? vehiclePatchLabel ?? text : undefined,
			vehiclePatchOperations: vehiclePatchOperations.length > 0 ? vehiclePatchOperations : undefined
		};
	} catch (error) {
		if (error instanceof OpenAI.APIError) {
			throw new OpenAIChatUpstreamError(error.message);
		}

		if (error instanceof OpenAIChatConfigError) {
			throw error;
		}

		throw new OpenAIChatUpstreamError(
			error instanceof Error ? error.message : 'OpenAI request failed.'
		);
	}
}
