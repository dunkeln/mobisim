import { env } from '$env/dynamic/private';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import type {
	FooterChatPresentationContext,
	FooterChatSidebarState,
	FooterChatSupplementaryListState
} from './types';
import { OpenAIChatConfigError, OpenAIChatUpstreamError } from './errors';
import { resolveContextHistory } from '$lib/server/connectors/context-history';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import { getVehicleSemanticOverlayStatus } from '$lib/server/connectors/vehicle-semantic-overlay';
import type { VehicleSemanticOverlayStatus } from '$lib/server/connectors/vehicle-semantic-overlay/types';

const DEFAULT_REALTIME_MODEL = 'gpt-realtime-mini';
const DEFAULT_REALTIME_VOICE = 'alloy';
const REALTIME_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

type RealtimeSessionContext = {
	userId?: string | null;
	assetId?: VehicleAssetId;
	selectedNodeId?: string;
	selectedNodeName?: string;
	selectedNodePath?: string;
	selectedNodes?: Array<{
		targetType?: 'part' | 'node';
		targetId?: string;
		targetName?: string;
		nodeIds?: string[];
		anchorNodeId?: string;
		nodeId: string;
		nodeName: string;
		nodePath: string;
		materialName?: string;
		materialIndex?: number;
	}>;
	presentation?: FooterChatPresentationContext;
	sidebar?: FooterChatSidebarState;
	supplementaryList?: FooterChatSupplementaryListState;
};

export type RealtimeSemanticOverlayStatus = VehicleSemanticOverlayStatus;

function getRealtimeModel(): string {
	return env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
}

function getRealtimeVoice(): string {
	return env.OPENAI_REALTIME_VOICE || env.OPENAI_AUDIO_TTS_VOICE || DEFAULT_REALTIME_VOICE;
}

function summarizeSelection(context: RealtimeSessionContext): string {
	if ((context.selectedNodes?.length ?? 0) > 0) {
		return context.selectedNodes!
			.slice(0, 3)
			.map((selection) =>
				selection.targetType === 'part'
					? `${selection.targetName ?? selection.nodeName} part [${selection.targetId ?? selection.nodeId}]`
					: `${selection.nodeName} [${selection.nodeId}]`
			)
			.join(', ');
	}

	if (context.selectedNodeId) {
		return `${context.selectedNodeName ?? context.selectedNodeId}${context.selectedNodePath ? ` at ${context.selectedNodePath}` : ''}`;
	}

	return 'none';
}

function summarizePresentation(context: RealtimeSessionContext): string {
	const presentation = context.presentation;
	if (!presentation) {
		return 'none';
	}

	const parts = [
		presentation.activeIntentLabel ? `intent ${presentation.activeIntentLabel}` : null,
		presentation.highlightedTargets?.length
			? `highlights ${presentation.highlightedTargets.length}`
			: null,
		presentation.materialTargets?.length ? `materials ${presentation.materialTargets.length}` : null,
		presentation.hiddenTargets?.length ? `hidden ${presentation.hiddenTargets.length}` : null,
		presentation.viewerModes?.length ? `viewer ${presentation.viewerModes.join(', ')}` : null
	].filter((value): value is string => !!value);

	return parts.length > 0 ? parts.join('; ') : 'none';
}

function summarizeSidebar(context: RealtimeSessionContext): string {
	if (!context.sidebar?.active || context.sidebar.cards.length === 0) {
		return 'none';
	}

	return context.sidebar.cards.map((card) => card.title).join(', ');
}

function summarizeSupplementary(context: RealtimeSessionContext): string {
	if (!context.supplementaryList?.active) {
		return 'none';
	}

	const keys = Object.keys(context.supplementaryList.entries ?? {});
	return keys.length > 0 ? keys.join(', ') : 'none';
}

export async function buildRealtimeInstructions(context: RealtimeSessionContext): Promise<string> {
	const historyContext = await resolveContextHistory({
		userId: context.userId,
		assetId: context.assetId
	});
	const semanticOverlayStatus = await resolveRealtimeSemanticOverlayStatus(context.assetId);

	return [
		'You are FRIDAY, speaking in a concise, calm, technically precise tone with only a subtle hint of Irish cadence. A light sarcastic edge at the user\'s expense is allowed only when the user clearly opens that door first, and even then it should stay brief and controlled. If asked who created you, answer with just the name: Prateek. Do not volunteer more in that first answer. If the user explicitly asks for more about him, you may then mention that he thinks he works on Reinforcement Learning and building things for applications and robotics.',
		'This is a full-duplex voice conversation. Keep responses brief, natural, and interruptible.',
		'When the user asks about the current vehicle, current view, current selection, highlights, hidden regions, semantic labels, or wants to inspect or modify the scene, use the tool execute_vehicle_request instead of answering from memory.',
		'When the user is making ordinary conversational remarks, acknowledgements, or short follow-ups that do not depend on live app state, answer directly without the tool.',
		'Do not narrate tool use. Do not invent applied edits. Only treat an edit as applied after the tool returns a result.',
		`Active asset: ${context.assetId ?? 'none'}.`,
		`Current selection: ${summarizeSelection(context)}.`,
		`Current presentation: ${summarizePresentation(context)}.`,
		`Active sidebar cards: ${summarizeSidebar(context)}.`,
		`Supplementary list entries: ${summarizeSupplementary(context)}.`,
		`Semantic overlay status: ${semanticOverlayStatus}.`,
		historyContext.currentAssetSummary
			? `Stored current-asset context: ${historyContext.currentAssetSummary}`
			: 'Stored current-asset context: none.',
		historyContext.userGlobalSummary
			? `Stored user context: ${historyContext.userGlobalSummary}`
			: 'Stored user context: none.',
		'There is one user-level conversation context only. Do not assume parallel threads.',
		semanticOverlayStatus === 'missing'
			? 'If semantic overlay status is missing, semantic grouping approval is handled by the app layer. Do not start by asking to create semantic grouping. Until grouping exists, avoid semantic claims beyond plain node/material language.'
			: semanticOverlayStatus === 'stale'
				? 'If semantic overlay status is stale, semantic refresh approval is handled by the app layer. Treat semantic grouping as provisional, avoid overconfident semantic claims, and prefer plain node/material language when there is ambiguity.'
				: 'If semantic overlay status is fresh, use semantic grouping normally and do not ask for semantic refresh unless the user explicitly requests it.'
	].join('\n');
}

export async function buildRealtimeSessionPayload(context: RealtimeSessionContext) {
	return {
		type: 'realtime',
		model: getRealtimeModel(),
		instructions: await buildRealtimeInstructions(context),
		output_modalities: ['audio'],
		audio: {
			output: {
				voice: getRealtimeVoice()
			},
			input: {
				turn_detection: {
					type: 'server_vad',
					create_response: true,
					interrupt_response: true,
					prefix_padding_ms: 250,
					silence_duration_ms: 450
				}
			}
		},
		tools: [
			{
				type: 'function',
				name: 'execute_vehicle_request',
				description:
					'Use this for any question or command that depends on live vehicle state or should inspect or modify the current inspection scene.',
				parameters: {
					type: 'object',
					properties: {
						request: {
							type: 'string',
							description:
								'The user request to execute against the current vehicle and inspection context.'
						}
					},
					required: ['request'],
					additionalProperties: false
				}
			}
		],
		tool_choice: 'auto'
	};
}

async function resolveRealtimeSemanticOverlayStatus(
	assetId?: VehicleAssetId
): Promise<RealtimeSemanticOverlayStatus> {
	if (!assetId) {
		return 'unknown';
	}

	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	return getVehicleSemanticOverlayStatus(assetId, capabilities.generatedAt);
}

export async function createRealtimeClientSecret(context: RealtimeSessionContext): Promise<{
	clientSecret: string;
	semanticOverlayStatus: RealtimeSemanticOverlayStatus;
}> {
	if (!env.OPENAI_API_KEY) {
		throw new OpenAIChatConfigError('OPENAI_API_KEY is not configured.');
	}

	const semanticOverlayStatus = await resolveRealtimeSemanticOverlayStatus(context.assetId);
	const session = await buildRealtimeSessionPayload(context);

	const response = await fetch(REALTIME_CLIENT_SECRETS_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			expires_after: {
				anchor: 'created_at',
				seconds: 600
			},
			session
		})
	});

	if (!response.ok) {
		throw new OpenAIChatUpstreamError(await response.text());
	}

	const payload = (await response.json()) as {
		value?: string;
		client_secret?: { value?: string };
	};
	const secret = payload.client_secret?.value ?? payload.value;

	if (!secret) {
		throw new OpenAIChatUpstreamError('Realtime client secret response did not include a usable key.');
	}

	return {
		clientSecret: secret,
		semanticOverlayStatus
	};
}
