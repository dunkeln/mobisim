import type { VehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
import type { FooterChatTrace } from '$lib/server/connectors/openai-chat/types';
import {
	applyHistoryActionToPresentationContext,
	applyOperationsToPresentationContext,
	applyPresentationRestoreToContext
} from '$lib/server/connectors/openai-chat/presentation-context';
import { getContextHistoryConfig } from './config';
import { createDynamoDbContextHistoryPort } from './dynamodb';
import type {
	ContextHistoryPort,
	ContextHistorySelectionSummary,
	PersistContextHistoryInput,
	ResolvedHistoryContext,
	ResolveContextHistoryInput,
	UserAssetContextEvent,
	UserAssetContextSnapshot,
	UserGlobalContextSnapshot
} from './types';

let historyPort: ContextHistoryPort | null = null;

function getHistoryPort(): ContextHistoryPort | null {
	const config = getContextHistoryConfig();
	if (!config.enabled) {
		return null;
	}

	if (!historyPort) {
		historyPort = createDynamoDbContextHistoryPort(config);
	}

	return historyPort;
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function truncateToBudget(text: string, remainingTokens: number): string {
	if (remainingTokens <= 0) {
		return '';
	}

	const maxChars = remainingTokens * 4;
	if (text.length <= maxChars) {
		return text;
	}

	if (maxChars <= 3) {
		return text.slice(0, Math.max(maxChars, 0));
	}

	return `${text.slice(0, maxChars - 3)}...`;
}

function summarizeSelection(selection: ContextHistorySelectionSummary[]): string {
	if (selection.length === 0) {
		return 'selection none';
	}

	return `selection ${selection
		.slice(0, 3)
		.map((item) => `${item.nodeName} [${item.nodeId}]`)
		.join(', ')}${selection.length > 3 ? ` +${selection.length - 3}` : ''}`;
}

function summarizePresentation(snapshot: UserAssetContextSnapshot['presentation']): string {
	if (!snapshot) {
		return 'presentation none';
	}

	const parts = [
		snapshot.activeIntentLabel ? `intent ${snapshot.activeIntentLabel}` : null,
		snapshot.highlightedTargets?.length ? `highlights ${snapshot.highlightedTargets.length}` : null,
		snapshot.materialTargets?.length ? `materials ${snapshot.materialTargets.length}` : null,
		snapshot.hiddenTargets?.length ? `hidden ${snapshot.hiddenTargets.length}` : null,
		snapshot.viewerModes?.length ? `viewer ${snapshot.viewerModes.join(', ')}` : null
	].filter((value): value is string => !!value);

	return parts.length > 0 ? `presentation ${parts.join('; ')}` : 'presentation none';
}

function summarizeAssetSnapshot(snapshot: UserAssetContextSnapshot): string {
	const aliases =
		snapshot.recentAliases.length > 0
			? `aliases ${snapshot.recentAliases.slice(0, 4).join(', ')}`
			: 'aliases none';
	const goal = snapshot.recentGoalSummary ? `goal ${snapshot.recentGoalSummary}` : 'goal none';
	const action = snapshot.lastActionSummary ? `last ${snapshot.lastActionSummary}` : 'last none';
	const semantic = snapshot.semanticOverlayStatus
		? `semantic ${snapshot.semanticOverlayStatus}${typeof snapshot.semanticOverlayRevision === 'number' ? ` rev ${snapshot.semanticOverlayRevision}` : ''}`
		: 'semantic unknown';

	return `Stored active-asset context: ${goal}; ${action}; ${summarizeSelection(snapshot.selection)}; ${summarizePresentation(snapshot.presentation)}; ${semantic}; ${aliases}.`;
}

function summarizeAssetEvent(event: UserAssetContextEvent): string {
	return `${event.messageSummary} -> ${event.resultSummary}`;
}

function summarizeUserGlobalSnapshot(snapshot: UserGlobalContextSnapshot): string {
	const assets =
		snapshot.recentAssetIds.length > 0
			? `recent assets ${snapshot.recentAssetIds.join(', ')}`
			: 'recent assets none';
	const goals =
		snapshot.recentGoalSummaries.length > 0
			? `recent goals ${snapshot.recentGoalSummaries.slice(0, 3).join(' | ')}`
			: 'recent goals none';
	const aliases =
		snapshot.stableAliases.length > 0
			? `stable aliases ${snapshot.stableAliases.slice(0, 6).join(', ')}`
			: 'stable aliases none';

	return `Stored user-global context: ${assets}; ${goals}; ${aliases}.`;
}

export function compactResolvedHistoryContext(input: {
	tokenBudget: number;
	currentAssetSnapshot?: UserAssetContextSnapshot | null;
	currentAssetEvents?: UserAssetContextEvent[];
	userGlobalSnapshot?: UserGlobalContextSnapshot | null;
}): ResolvedHistoryContext {
	let remainingTokens = input.tokenBudget;
	let compactionApplied = false;
	let currentAssetSummary: string | undefined;
	let userGlobalSummary: string | undefined;
	const currentAssetSnapshot = input.currentAssetSnapshot ?? undefined;

	if (currentAssetSnapshot) {
		const summary = summarizeAssetSnapshot(currentAssetSnapshot);
		const fitted = truncateToBudget(summary, remainingTokens);
		currentAssetSummary = fitted;
		compactionApplied ||= fitted !== summary;
		remainingTokens -= estimateTokens(fitted);
	}

	const eventSummaries: string[] = [];
	const droppedEventSummaries: string[] = [];

	for (const event of input.currentAssetEvents ?? []) {
		const summary = summarizeAssetEvent(event);
		const needed = estimateTokens(summary);
		if (needed <= remainingTokens) {
			eventSummaries.push(summary);
			remainingTokens -= needed;
			continue;
		}

		droppedEventSummaries.push(summary);
		compactionApplied = true;
	}

	if (eventSummaries.length > 0 || droppedEventSummaries.length > 0) {
		const compactEvents = [
			eventSummaries.length > 0 ? `Recent asset turns: ${eventSummaries.join(' | ')}` : null,
			droppedEventSummaries.length > 0
				? `Older asset turns compressed: ${droppedEventSummaries.length} additional turns.`
				: null
		]
			.filter((value): value is string => !!value)
			.join(' ');
		if (compactEvents) {
			currentAssetSummary = currentAssetSummary
				? `${currentAssetSummary} ${compactEvents}`
				: compactEvents;
		}
	}

	if (input.userGlobalSnapshot && remainingTokens > 0) {
		const summary = summarizeUserGlobalSnapshot(input.userGlobalSnapshot);
		const fitted = truncateToBudget(summary, remainingTokens);
		if (fitted.length > 0) {
			userGlobalSummary = fitted;
			compactionApplied ||= fitted !== summary;
			remainingTokens -= estimateTokens(fitted);
		} else {
			compactionApplied = true;
		}
	}

	return {
		currentAssetSnapshot,
		currentAssetSummary,
		userGlobalSummary,
		historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
		compactionApplied,
		sourceUsed: currentAssetSummary
			? 'current_asset'
			: userGlobalSummary
				? 'user_global'
				: 'none'
	};
}

function toSelectionSummary(selectedNodes: VehicleNodeSelection[]): ContextHistorySelectionSummary[] {
	return selectedNodes.map((selection) => ({
		nodeId: selection.nodeId,
		nodeName: selection.nodeName,
		nodePath: selection.nodePath,
		materialName: selection.materialName,
		materialIndex: selection.materialIndex
	}));
}

function extractAliases(input: {
	requestMessage: string;
	snapshot?: UserAssetContextSnapshot | null;
	selection: ContextHistorySelectionSummary[];
	response: PersistContextHistoryInput['response'];
}): string[] {
	const aliases = new Set<string>();

	for (const word of input.requestMessage.toLowerCase().split(/[^a-z0-9_]+/)) {
		if (word.length >= 4) {
			aliases.add(word);
		}
	}

	for (const selection of input.selection) {
		aliases.add(selection.nodeName.toLowerCase());
	}

	for (const operation of input.response.vehiclePatchOperations ?? []) {
		if (operation.targetName) {
			aliases.add(operation.targetName.toLowerCase());
		}
	}

	for (const alias of input.snapshot?.recentAliases ?? []) {
		aliases.add(alias);
	}

	return Array.from(aliases).filter((alias) => alias.length > 0).slice(0, 8);
}

function summarizeGoal(message: string): string {
	return message.trim().replace(/\s+/g, ' ').slice(0, 160);
}

function summarizeResult(response: PersistContextHistoryInput['response']): string {
	if (response.vehiclePatchLabel) {
		return response.vehiclePatchLabel;
	}

	if (response.presentationRestore?.label) {
		return response.presentationRestore.label;
	}

	if (response.historyAction) {
		return response.historyAction.replace(/_/g, ' ');
	}

	return response.message.content.trim().replace(/\s+/g, ' ').slice(0, 160);
}

function deriveNextSelection(input: PersistContextHistoryInput): ContextHistorySelectionSummary[] {
	const requestSelection = toSelectionSummary(
		input.request.selectedNodes.filter((selection) => selection.assetId === input.request.assetId)
	);
	if (input.response.selectionUpdate?.mode === 'replace') {
		return toSelectionSummary(input.response.selectionUpdate.selectedNodes);
	}

	return requestSelection;
}

function deriveNextPresentation(input: PersistContextHistoryInput): UserAssetContextSnapshot['presentation'] {
	let nextPresentation = input.request.presentation;

	if (input.response.vehiclePatchOperations && input.response.vehiclePatchOperations.length > 0) {
		nextPresentation = applyOperationsToPresentationContext(
			nextPresentation,
			input.response.vehiclePatchOperations,
			input.response.vehiclePatchLabel
		);
	}

	if (input.response.presentationRestore) {
		nextPresentation = applyPresentationRestoreToContext(
			nextPresentation,
			input.response.presentationRestore
		);
	}

	if (input.response.historyAction) {
		nextPresentation = applyHistoryActionToPresentationContext(
			nextPresentation,
			input.response.historyAction
		);
	}

	return nextPresentation;
}

function deriveNextSidebar(input: PersistContextHistoryInput): UserAssetContextSnapshot['sidebar'] {
	return input.response.sidebar ?? input.request.sidebar;
}

function deriveNextSupplementaryList(
	input: PersistContextHistoryInput
): UserAssetContextSnapshot['supplementaryList'] {
	return input.response.supplementaryList ?? input.request.supplementaryList;
}

function deriveNextAssetSnapshot(input: {
	userId: string;
	previousSnapshot?: UserAssetContextSnapshot | null;
	persistInput: PersistContextHistoryInput;
}): UserAssetContextSnapshot | null {
	const { persistInput } = input;
	if (!persistInput.request.assetId) {
		return null;
	}

	const selection = deriveNextSelection(persistInput);
	const presentation = deriveNextPresentation(persistInput);
	const sidebar = deriveNextSidebar(persistInput);
	const supplementaryList = deriveNextSupplementaryList(persistInput);
	const aliases = extractAliases({
		requestMessage: persistInput.request.message,
		snapshot: input.previousSnapshot,
		selection,
		response: persistInput.response
	});

	return {
		userId: input.userId,
		assetId: persistInput.request.assetId,
		selection,
		presentation,
		sidebar,
		supplementaryList,
		semanticOverlayStatus: persistInput.response.semanticOverlayStatus,
		semanticOverlayRevision: persistInput.response.semanticOverlay?.revision,
		recentAliases: aliases,
		recentGoalSummary: summarizeGoal(persistInput.request.message),
		lastActionSummary: summarizeResult(persistInput.response),
		updatedAt: new Date().toISOString()
	};
}

function deriveAssetEvent(input: {
	userId: string;
	persistInput: PersistContextHistoryInput;
	selection: ContextHistorySelectionSummary[];
	aliases: string[];
}): UserAssetContextEvent | null {
	const assetId = input.persistInput.request.assetId;
	if (!assetId) {
		return null;
	}

	return {
		userId: input.userId,
		assetId,
		eventAt: new Date().toISOString(),
		messageSummary: summarizeGoal(input.persistInput.request.message),
		resultSummary: summarizeResult(input.persistInput.response),
		semanticOverlayStatus: input.persistInput.response.semanticOverlayStatus,
		semanticOverlayRevision: input.persistInput.response.semanticOverlay?.revision,
		selection: input.selection,
		presentation: deriveNextPresentation(input.persistInput),
		aliases: input.aliases,
		rawUserMessage: getContextHistoryConfig().rawRetentionEnabled
			? input.persistInput.rawUserMessage ?? input.persistInput.request.message
			: undefined
	};
}

function deriveUserGlobalSnapshot(input: {
	userId: string;
	previousSnapshot?: UserGlobalContextSnapshot | null;
	persistInput: PersistContextHistoryInput;
	assetSnapshot?: UserAssetContextSnapshot | null;
}): UserGlobalContextSnapshot {
	const recentAssetIds = Array.from(
		new Set(
			[
				input.assetSnapshot?.assetId,
				...(input.previousSnapshot?.recentAssetIds ?? [])
			].filter((value): value is NonNullable<typeof value> => !!value)
		)
	).slice(0, 6);

	const stableAliases = Array.from(
		new Set([...(input.assetSnapshot?.recentAliases ?? []), ...(input.previousSnapshot?.stableAliases ?? [])])
	).slice(0, 12);

	const recentGoalSummaries = Array.from(
		new Set([summarizeGoal(input.persistInput.request.message), ...(input.previousSnapshot?.recentGoalSummaries ?? [])])
	).slice(0, 6);

	return {
		userId: input.userId,
		recentAssetIds,
		stableAliases,
		recentGoalSummaries,
		workflowPreferences: input.previousSnapshot?.workflowPreferences ?? ['asset_first_context'],
		updatedAt: new Date().toISOString()
	};
}

export async function resolveContextHistory(
	input: ResolveContextHistoryInput
): Promise<ResolvedHistoryContext> {
	const port = getHistoryPort();
	const config = getContextHistoryConfig();
	if (!port || !config.enabled || !input.userId) {
		return {
			historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
			compactionApplied: false,
			sourceUsed: 'none'
		};
	}

	try {
		const currentAssetSnapshot =
			input.assetId ? await port.getAssetSnapshot(input.userId, input.assetId) : null;
		const currentAssetEvents =
			input.assetId ? await port.listAssetEvents(input.userId, input.assetId, 8) : [];
		const userGlobalSnapshot = await port.getUserGlobalSnapshot(input.userId);

		return compactResolvedHistoryContext({
			tokenBudget: config.tokenBudget,
			currentAssetSnapshot,
			currentAssetEvents,
			userGlobalSnapshot
		});
	} catch (error) {
		console.error('context history resolve error', error);
		return {
			historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
			compactionApplied: false,
			sourceUsed: 'none'
		};
	}
}

export async function persistContextHistory(input: PersistContextHistoryInput): Promise<void> {
	const port = getHistoryPort();
	const config = getContextHistoryConfig();
	if (!port || !config.enabled || !input.userId) {
		return;
	}

	try {
		const previousAssetSnapshot =
			input.request.assetId ? await port.getAssetSnapshot(input.userId, input.request.assetId) : null;
		const nextAssetSnapshot = deriveNextAssetSnapshot({
			userId: input.userId,
			previousSnapshot: previousAssetSnapshot,
			persistInput: input
		});

		if (nextAssetSnapshot) {
			await port.putAssetSnapshot(nextAssetSnapshot);
		}

		if (nextAssetSnapshot) {
			const event = deriveAssetEvent({
				userId: input.userId,
				persistInput: input,
				selection: nextAssetSnapshot.selection,
				aliases: nextAssetSnapshot.recentAliases
			});
			if (event) {
				await port.putAssetEvent(event);
			}
		}

		const previousGlobalSnapshot = await port.getUserGlobalSnapshot(input.userId);
		const nextGlobalSnapshot = deriveUserGlobalSnapshot({
			userId: input.userId,
			previousSnapshot: previousGlobalSnapshot,
			persistInput: input,
			assetSnapshot: nextAssetSnapshot
		});
		await port.putUserGlobalSnapshot(nextGlobalSnapshot);
	} catch (error) {
		console.error('context history persist error', error);
	}
}

export function buildHistoryTrace(input: ResolvedHistoryContext): Partial<Pick<
	FooterChatTrace,
	'historySourceUsed' | 'historyCompactionApplied'
>> {
	if (input.sourceUsed === 'none' && !input.compactionApplied) {
		return {};
	}

	return {
		historySourceUsed: input.sourceUsed,
		historyCompactionApplied: input.compactionApplied
	};
}
