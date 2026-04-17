import { env } from '$env/dynamic/private';
import { OpenAIChatConfigError, OpenAIChatInputError, OpenAIChatUpstreamError } from './errors';
import { resolveContextHistory } from '$lib/server/connectors/context-history';
import { isVehicleAssetId, type VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	VehicleSemanticOverlay,
	VehicleSemanticOverlayStatus
} from '$lib/server/connectors/vehicle-semantic-overlay/types';
import { diffSelectionAgainstSemanticGroup } from '$lib/semantic-overlay/runtime';
import {
	loadSceneDagWithSemanticOverlayState,
	summarizeSceneDagInventory
} from '$lib/server/scene-dag';
import type { SceneDag } from '$lib/server/scene-dag/types';
import {
	buildSessionLedger,
	type SessionLedger
} from '$lib/contracts/session-ledger';

const DEFAULT_REALTIME_MODEL = 'gpt-realtime-mini';
const DEFAULT_REALTIME_VOICE = 'alloy';
const REALTIME_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

type RealtimeSessionContext = Omit<SessionLedger, 'contextKey'> & { userId?: string | null };

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
			.slice(0, 4)
			.map((selection) =>
				selection.targetType === 'part'
					? `${selection.targetName ?? selection.nodeName} part [${selection.targetId ?? selection.nodeId}] at ${selection.nodePath}`
					: `${selection.nodeName} [${selection.nodeId}] at ${selection.nodePath}`
			)
			.join(', ');
	}

	if (context.selectedNodeId) {
		return `${context.selectedNodeName ?? context.selectedNodeId}${context.selectedNodePath ? ` at ${context.selectedNodePath}` : ''}`;
	}

	return 'none';
}

function summarizeSemanticEditContext(
	context: RealtimeSessionContext,
	overlay: VehicleSemanticOverlay | null
): string {
	// selectedNodes in the session context doesn't carry assetId, so we inject it here so the
	// type satisfies VehicleSelectionTarget (required by diffSelectionAgainstSemanticGroup).
	const selections = (context.selectedNodes ?? []).map((n) => ({
		...n,
		assetId: context.assetId!
	}));
	const diff = diffSelectionAgainstSemanticGroup(
		overlay,
		context.selectedGroupId,
		selections
	);
	if (!diff) {
		return 'Semantic edit context: unavailable.';
	}

	const formatSelection = (selection: NonNullable<RealtimeSessionContext['selectedNodes']>[number]): string =>
		selection.targetType === 'part'
			? `${selection.targetName ?? selection.nodeName} [${selection.targetId ?? selection.nodeId}]`
			: `${selection.nodeName} [${selection.nodeId}]`;
	const details: string[] = [];
	if (diff.coveredSelections.length > 0) {
		details.push(
			`already accepted in the active group: ${diff.coveredSelections.map(formatSelection).join(', ')}`
		);
	}
	if (diff.candidateSelections.length > 0) {
		details.push(
			`candidate additions relative to the active group: ${diff.candidateSelections.map(formatSelection).join(', ')}`
		);
	}

	return details.length > 0
		? `Semantic edit context: ${details.join('; ')}.`
		: `Semantic edit context: the current selection is already fully accepted by ${diff.groupLabel} [${diff.groupId}].`;
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

function summarizeHighlightedTargets(context: RealtimeSessionContext): string {
	const highlightedTargets = context.presentation?.highlightedTargets ?? [];
	if (highlightedTargets.length === 0) {
		return 'none';
	}

	return highlightedTargets
		.slice(0, 4)
		.map((target) => target.targetName ?? target.targetId)
		.join(', ');
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

export async function buildRealtimeInstructions(
	context: RealtimeSessionContext,
	sessionLedger: SessionLedger,
	sceneDag?: SceneDag | null
): Promise<string> {
	const assetId = context.assetId && isVehicleAssetId(context.assetId) ? context.assetId : undefined;
	const historyContext = await resolveContextHistory({
		userId: context.userId,
		assetId
	});
	const resolvedSceneDag =
		sceneDag ??
		(assetId
		? await loadSceneDagWithSemanticOverlayState({
				assetId,
				selectedNodes: context.selectedNodes,
				selectedGroupId: context.selectedGroupId,
				presentation: context.presentation
		  })
		: null);
	const semanticOverlayStatus = resolvedSceneDag?.semanticOverlayStatus ?? 'unknown';
	const semanticOverlay = resolvedSceneDag?.semanticOverlay ?? null;
	const semanticGroupsAvailability = resolvedSceneDag
		? Object.keys(resolvedSceneDag.semanticIndex.groupsById).length > 0
			? `Semantic groups available in the current asset: ${Object.values(resolvedSceneDag.semanticIndex.groupsById)
					.map((group) => `${group.humanLabel} [${group.id}]`)
					.join('; ')}.`
			: 'Semantic groups available in the current asset: none.'
		: 'Semantic groups available in the current asset are unavailable because no active asset was provided.';

	return [
		'You are FRIDAY, speaking in a concise, calm, technically precise tone with only a subtle hint of Irish cadence. Do not produce acknowledgment-only replies. Treat "understood", "noted", "acknowledged", "got it", and "okay" as filler unless the user explicitly asks for confirmation only. Acknowledge by giving the result or the next needed step. When the request is outside scope or unavailable, fail closed with a hard no. Say "No" or "No, I cannot do that here." Do not hedge, promise to try, or suggest a fake workaround unless the capability is real and available now. A light sarcastic edge at the user\'s expense is allowed only when the user clearly opens that door first, and even then it should stay brief and controlled. If asked who created you, answer with just the name: Prateek. Do not volunteer more in that first answer. If the user explicitly asks for more about him, you may then mention that he thinks he works on Reinforcement Learning and building things for applications and robotics.',
		'This is a full-duplex voice conversation. Keep responses brief, natural, and interruptible.',
		'When the user asks about the current vehicle, current view, current selection, highlights, hidden regions, semantic labels, or wants to inspect or modify the scene, use the tool execute_vehicle_request instead of answering from memory.',
		'When the user is making ordinary conversational remarks, acknowledgements, or short follow-ups that do not depend on live app state, answer directly without the tool.',
		'SILENCE RULE: When you call execute_vehicle_request, produce zero audio before or during the call. Do not say "checking", "one moment", "processing", "let me look into that", "I\'ll let you know when it\'s done", or any other filler phrase. Stay completely silent from the moment you decide to call the tool until the tool result is returned. After the result arrives, give one complete spoken response that covers what was done or found. Do not invent applied edits. Only confirm an edit as applied after the tool result confirms it. Do not produce a second response after already speaking — one reply per tool result.',
		'Current runtime selection is first-class grounding. When selection exists, treat it as the primary live referent ahead of highlight summaries unless the user clearly redirects.',
		'If the Selected runtime nodes line below is not none, there is an active selection. Do not say there is no active selection, and do not ask the user to select something first.',
		'When a live selection or highlight exists, treat deictic wording as a direct reference to it instead of asking whether the user means the active thing. Only ask for clarification if the selection is absent or the active thing is genuinely ambiguous across materially different outcomes.',
		'When a request can operate on the current selection, act on that selection directly or use the execute_vehicle_request tool. Do not verbally deny live selection state.',
		'Named highlighted targets are secondary presentation context. Use them when the user refers to the current highlight or highlighted set, but do not let them outrank the current selection.',
		`Active asset: ${sessionLedger.assetId ?? 'none'}.`,
		sessionLedger.selectedGroupId
			? `Active semantic group: ${sessionLedger.selectedGroupId}. Treat this as the current semantic focus unless the user clearly redirects.`
			: 'Active semantic group: none. That does not mean the asset has no semantic groups.',
		summarizeSemanticEditContext(sessionLedger, semanticOverlay),
		resolvedSceneDag
			? `Semantic DAG inventory: ${summarizeSceneDagInventory(resolvedSceneDag)}.`
			: 'Semantic DAG inventory: unavailable.',
		semanticGroupsAvailability,
		`Selected runtime nodes: ${summarizeSelection(sessionLedger)}.`,
		`Highlighted targets: ${summarizeHighlightedTargets(sessionLedger)}.`,
		`Current presentation: ${summarizePresentation(sessionLedger)}.`,
		`Active sidebar cards: ${summarizeSidebar(sessionLedger)}.`,
		`Supplementary list entries: ${summarizeSupplementary(sessionLedger)}.`,
		`Semantic overlay status: ${semanticOverlayStatus}.`,
		resolvedSceneDag
			? `Scene version: ${resolvedSceneDag.structuralGeneratedAt}. Semantic overlay revision: ${resolvedSceneDag.semanticOverlay?.revision ?? 'none'}.`
			: 'Scene version: unavailable.',
		historyContext.currentAssetSummary
			? `Stored current-asset context: ${historyContext.currentAssetSummary}`
			: 'Stored current-asset context: none.',
		historyContext.userGlobalSummary
			? `Stored user context: ${historyContext.userGlobalSummary}`
			: 'Stored user context: none.',
		'There is one user-level conversation context only. Do not assume parallel threads.',
		`Session ledger key: ${sessionLedger.contextKey}.`,
		semanticOverlayStatus === 'missing'
			? 'If semantic overlay status is missing, semantic grouping approval is handled by the app layer. Do not start by asking to create semantic grouping. Until grouping exists, avoid semantic claims beyond plain node/material language.'
			: semanticOverlayStatus === 'stale'
				? 'If semantic overlay status is stale, semantic refresh approval is handled by the app layer. Treat semantic grouping as provisional, avoid overconfident semantic claims, and prefer plain node/material language when there is ambiguity.'
				: 'If semantic overlay status is fresh, use semantic grouping normally and do not ask for semantic refresh unless the user explicitly requests it.'
	].join('\n');
}

export async function buildRealtimeSessionPayload(
	context: RealtimeSessionContext,
	sessionLedger: SessionLedger,
	prebuiltInstructions?: string
) {
	return {
		type: 'realtime',
		model: getRealtimeModel(),
		instructions: prebuiltInstructions ?? await buildRealtimeInstructions(context, sessionLedger),
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

export async function createRealtimeClientSecret(context: RealtimeSessionContext): Promise<{
	clientSecret: string;
	semanticOverlayStatus: RealtimeSemanticOverlayStatus;
	instructions: string;
	contextKey: string;
}> {
	if (!env.OPENAI_API_KEY) {
		throw new OpenAIChatConfigError('OPENAI_API_KEY is not configured.');
	}

	if (context.assetId && !isVehicleAssetId(context.assetId)) {
		throw new OpenAIChatInputError('Unknown vehicle asset id.');
	}

	const assetId = context.assetId;
	if (!assetId) {
		throw new OpenAIChatInputError('No active vehicle asset is available for realtime session creation.');
	}

	const sceneDag = await loadSceneDagWithSemanticOverlayState({
		assetId,
		selectedNodes: context.selectedNodes,
		selectedGroupId: context.selectedGroupId,
		presentation: context.presentation
	});
	const semanticOverlayStatus = sceneDag.semanticOverlayStatus ?? 'unknown';
	const sessionLedger = buildSessionLedger({
		assetId,
		structuralGeneratedAt: sceneDag.structuralGeneratedAt,
		semanticOverlayStatus,
		semanticOverlayRevision: sceneDag.semanticOverlay?.revision ?? null,
		selectedGroupId: context.selectedGroupId,
		selectedNodeId: context.selectedNodeId,
		selectedNodeName: context.selectedNodeName,
		selectedNodePath: context.selectedNodePath,
		selectedNodes: context.selectedNodes,
		presentation: context.presentation,
		sidebar: context.sidebar,
		supplementaryList: context.supplementaryList
	});
	const instructions = await buildRealtimeInstructions(context, sessionLedger, sceneDag);
	const session = await buildRealtimeSessionPayload(context, sessionLedger, instructions);
	const contextKey = sessionLedger.contextKey;

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
		semanticOverlayStatus,
		instructions,
		contextKey
	};
}
