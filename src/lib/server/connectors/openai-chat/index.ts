import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import type {
	ChatCompletionMessageParam,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption
} from 'openai/resources/chat/completions';
import { isVehicleEditRequest, resolveVehicleIntent } from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId, type VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	FooterChatMessage,
	FooterChatRequest,
	FooterChatResponse,
	FooterChatVehiclePatchOperation
} from './types';

const DEFAULT_MODEL = 'gpt-5.2';
const MAX_HISTORY_MESSAGES = 8;
const MAX_TOOL_ROUNDS = 2;
const APPLY_VEHICLE_INTENT_TOOL_NAME = 'apply_vehicle_intent';

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

function isFooterChatMessage(value: unknown): value is FooterChatMessage {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return (
		(candidate.role === 'user' || candidate.role === 'assistant') &&
		typeof candidate.content === 'string'
	);
}

function normalizeHistory(history: unknown): FooterChatMessage[] {
	if (!Array.isArray(history)) {
		return [];
	}

	return history
		.filter(isFooterChatMessage)
		.map((message) => ({
			role: message.role,
			content: message.content.trim()
		}))
		.filter((message) => message.content.length > 0)
		.slice(-MAX_HISTORY_MESSAGES);
}

type NormalizedFooterChatRequest = {
	message: string;
	history: FooterChatMessage[];
	assetId?: VehicleAssetId;
};

function normalizeRequest(input: FooterChatRequest): NormalizedFooterChatRequest {
	const message = input.message.trim();

	if (!message) {
		throw new OpenAIChatInputError('Message is required.');
	}

	return {
		message,
		history: normalizeHistory(input.history),
		assetId: input.assetId && isVehicleAssetId(input.assetId) ? input.assetId : undefined
	};
}

function toOpenAIMessages(input: NormalizedFooterChatRequest): ChatCompletionMessageParam[] {
	const history = input.history.map<ChatCompletionMessageParam>((message) => ({
		role: message.role,
		content: message.content
	}));

	const activeAssetLine = input.assetId
		? `Active asset ID: ${input.assetId}.`
		: 'No active asset ID was provided.';

	return [
		{
			role: 'developer',
			content: `You are the Mobisim footer assistant. Be concise, practical, and technical. Keep responses short by default.
Use the vehicle intent tool whenever the user asks to change the current vehicle or viewer state, such as wireframe, highlights, body color, window tint, headlights, visibility, or postprocessing.
Infer the user's intent freely from the request, but rely on the tool to resolve that request into valid deterministic operations.
Only say a vehicle edit was applied when the tool returned one or more accepted operations. If no operations were accepted, say that you could not apply the requested change.
The executor owns asset selection deterministically. The tool always applies to the active asset only, never to an inferred or alternate asset.
${activeAssetLine}`
		},
		...history,
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
							'Freeform vehicle-edit request such as black panther purple body, 5% tint, highlight wheels, turn headlights on, or show wireframe.'
					}
				},
				required: ['request']
			}
		}
	}
];

type ApplyVehicleIntentToolArgs = {
	request: string;
};

type ExecutedToolResult = {
	message: ChatCompletionMessageParam;
	plannedOperations?: FooterChatVehiclePatchOperation[];
};

function getToolChoiceForRequest(
	input: NormalizedFooterChatRequest
): ChatCompletionToolChoiceOption | undefined {
	if (!isVehicleEditRequest(input.message)) {
		return undefined;
	}

	return {
		type: 'function',
		function: {
			name: APPLY_VEHICLE_INTENT_TOOL_NAME
		}
	};
}

function parseApplyVehicleIntentToolArgs(input: string): ApplyVehicleIntentToolArgs {
	const parsed = JSON.parse(input) as ApplyVehicleIntentToolArgs;
	return {
		request: parsed.request
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
				plannedOperations: result.operations
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

		const messages = toOpenAIMessages(normalized);
		let vehiclePatchOperations: FooterChatVehiclePatchOperation[] = [];
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
