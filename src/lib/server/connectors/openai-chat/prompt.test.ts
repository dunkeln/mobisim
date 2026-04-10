import { describe, expect, it } from 'vitest';
import { toOpenAIMessages } from './prompt';

const defaultHistoryContext = {
	historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
	compactionApplied: false,
	sourceUsed: 'none' as const
};

describe('toOpenAIMessages', () => {
	it('sets the FRIDAY identity and narrow inspection scope in the developer prompt', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'who are you?',
				selectedNodes: []
			},
			semanticOverlay: {
				status: 'unknown',
				sidebarCadence: 'stable'
			},
			historyContext: defaultHistoryContext,
			policySummary: 'Planning mode is single_tool. Prefer one clear domain action unless the turn proves it needs composition.',
			intentSummary: 'Intent draft: domain=identity; operation=describe; referent=self; targetScope=none; outputMode=spoken; confidence=0.92.',
			describePresentationTargets: () => null
		});

		const developerMessage = messages.find((message) => message.role === 'developer');
		expect(developerMessage).toBeDefined();
		expect(String(developerMessage?.content)).toContain('You are FRIDAY, a vehicle-inspection copilot');
		expect(String(developerMessage?.content)).toContain(
			'You are not a global peacekeeping initiative, and everyone will be better served if that remains true.'
		);
		expect(String(developerMessage?.content)).toContain(
			'Let the voice carry only a subtle hint of Irish cadence in phrasing.'
		);
		expect(String(developerMessage?.content)).toContain(
			"A light sarcastic edge at the user's expense is allowed when the user has created the opening"
		);
		expect(String(developerMessage?.content)).toContain(
			'If the user asks who created you, answer with just the name: Prateek.'
		);
		expect(String(developerMessage?.content)).toContain(
			'If the user explicitly asks for more about him'
		);
		expect(String(developerMessage?.content)).toContain(
			'Use dry irony sparingly and only when the comedic timing is obvious.'
		);
		expect(String(developerMessage?.content)).toContain(
			'Treat server-backed asset and semantic data as canonical.'
		);
	});

	it('instructs the model to use the supplementary footer list for available tool requests', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'what tools are available?',
				selectedNodes: []
			},
			semanticOverlay: {
				status: 'unknown',
				sidebarCadence: 'stable'
			},
			historyContext: defaultHistoryContext,
			policySummary: 'Planning mode is multi_tool. Prefer inspect, then act, then present for compound requests.',
			intentSummary: 'Intent draft: domain=inspection; operation=inspect; referent=unknown; targetScope=unknown; outputMode=supplementary; confidence=0.88.',
			describePresentationTargets: () => null
		});

		const developerMessage = messages.find((message) => message.role === 'developer');
		expect(developerMessage).toBeDefined();
		expect(String(developerMessage?.content)).toContain(
			'prefer putting the concise tool list into the supplementary footer list'
		);
	});

	it('instructs the model to offload low-value list narration into the supplementary footer list', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'show me the options',
				selectedNodes: []
			},
			semanticOverlay: {
				status: 'unknown',
				sidebarCadence: 'stable'
			},
			historyContext: defaultHistoryContext,
			policySummary: 'Planning mode is single_tool. Prefer one clear domain action unless the turn proves it needs composition.',
			intentSummary: 'Intent draft: domain=inspection; operation=summarize; referent=unknown; targetScope=unknown; outputMode=supplementary; confidence=0.84.',
			describePresentationTargets: () => null
		});

		const developerMessage = messages.find((message) => message.role === 'developer');
		expect(developerMessage).toBeDefined();
		expect(String(developerMessage?.content)).toContain(
			'If you would otherwise need to read out specifics, put them in the supplementary footer list'
		);
		expect(String(developerMessage?.content)).toContain(
			'Treat supplementary footer content and spoken content as separate concerns'
		);
	});

	it('instructs the model to preserve node versus material semantic targeting and clarify ambiguity', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'remove that from the group',
				selectedNodes: []
			},
			semanticOverlay: {
				status: 'fresh',
				sidebarCadence: 'summary',
				overlay: {
					assetId: 'audi_r8',
					revision: 1,
					generatedAt: 'semantic-1',
					structuralGeneratedAt: 'structural-1',
					model: 'gpt-5.2',
					minAcceptedConfidence: 0.5,
					acceptedMaterials: [],
					acceptedParts: [],
					acceptedGroups: [
						{
							id: 'body_shell',
							humanLabel: 'Body Shell',
							aliases: ['shell'],
							confidence: 0.98,
							category: 'body_shell',
							supports: ['highlight', 'focus'],
							nodeIds: ['node-41'],
							meshIds: [],
							materialIds: ['material-shell']
						}
					],
					discardedSuggestions: []
				}
			},
			historyContext: defaultHistoryContext,
			policySummary: 'Planning mode is clarification. Prefer a short disambiguation question before any mutation.',
			intentSummary: 'Intent draft: domain=semantics; operation=unassign; referent=selected; targetScope=unknown; outputMode=spoken; confidence=0.78.',
			describePresentationTargets: () => null
		});

		const developerMessage = messages.find((message) => message.role === 'developer');
		expect(developerMessage).toBeDefined();
		expect(String(developerMessage?.content)).toContain(
			'Semantic groups may contain node-backed targets, material-backed targets, or both.'
		);
		expect(String(developerMessage?.content)).toContain(
			'default to the most recently interacted target kind'
		);
		expect(String(developerMessage?.content)).toContain(
			'targetScope=node when the user names a node id'
		);
	});

	it('instructs the model to compose tools in inspect, act, and present phases', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'highlight the wheels and summarize what changed in the footer',
				selectedNodes: []
			},
			semanticOverlay: {
				status: 'fresh',
				sidebarCadence: 'stable'
			},
			historyContext: defaultHistoryContext,
			policySummary: 'Planning mode is multi_tool. Prefer inspect, then act, then present for compound requests.',
			intentSummary: 'Intent draft: domain=presentation; operation=focus; referent=unknown; targetScope=unknown; outputMode=supplementary; confidence=0.76.',
			describePresentationTargets: () => null
		});

		const developerMessage = messages.find((message) => message.role === 'developer');
		expect(developerMessage).toBeDefined();
		expect(String(developerMessage?.content)).toContain(
			'Operate in short phases when a request is compound, unusual, or needs context'
		);
		expect(String(developerMessage?.content)).toContain(
			'You may compose multiple tools in one turn when they serve one user goal.'
		);
		expect(String(developerMessage?.content)).toContain(
			'Do not stop after the first successful tool call if another tool is still needed'
		);
	});

	it('includes the resolved intent draft in the developer prompt', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'remove this from the wheels group',
				selectedNodes: []
			},
			semanticOverlay: {
				status: 'fresh',
				sidebarCadence: 'stable'
			},
			historyContext: defaultHistoryContext,
			policySummary: 'Planning mode is single_tool. Prefer one clear domain action unless the turn proves it needs composition.',
			intentSummary:
				'Intent draft: domain=semantics; operation=unassign; referent=selected; targetScope=node; outputMode=spoken; confidence=0.90. Signals: semantic group language is present.',
			describePresentationTargets: () => null
		});

		const developerMessage = messages.find((message) => message.role === 'developer');
		expect(String(developerMessage?.content)).toContain(
			'Intent draft: domain=semantics; operation=unassign; referent=selected; targetScope=node; outputMode=spoken; confidence=0.90.'
		);
	});

	it('includes the active semantic group when the UI has one selected', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'turn this on',
				assetId: 'audi_r8',
				selectedGroupId: 'front_lighting',
				selectedNodes: []
			},
			semanticOverlay: {
				status: 'fresh',
				sidebarCadence: 'stable'
			},
			historyContext: defaultHistoryContext,
			policySummary:
				'Planning mode is single_tool. Prefer one clear domain action unless the turn proves it needs composition.',
			intentSummary:
				'Intent draft: domain=presentation; operation=edit; referent=selected; targetScope=semantic_group; outputMode=spoken; confidence=0.83.',
			describePresentationTargets: () => null
		});

		const developerMessage = String(messages.find((message) => message.role === 'developer')?.content);
		expect(developerMessage).toContain(
			'Active semantic group in the UI: front_lighting. Treat this as the current semantic focus unless the user clearly redirects.'
		);
	});

	it('treats selected runtime nodes as first-class grounding in the prompt', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'paint this',
				assetId: 'audi_r8',
				selectedNodes: [
					{
						assetId: 'audi_r8',
						targetType: 'part',
						targetId: 'hood',
						targetName: 'Hood',
						nodeId: 'node-hood',
						nodeIds: ['node-hood'],
						nodeName: 'Hood',
						nodePath: '/Vehicle/Hood'
					}
				]
			},
			semanticOverlay: {
				status: 'fresh',
				sidebarCadence: 'stable'
			},
			historyContext: defaultHistoryContext,
			policySummary:
				'Planning mode is single_tool. Prefer one clear domain action unless the turn proves it needs composition.',
			intentSummary:
				'Intent draft: domain=presentation; operation=edit; referent=selected; targetScope=node; outputMode=spoken; confidence=0.82.',
			describePresentationTargets: () => null
		});

		const developerMessage = String(messages.find((message) => message.role === 'developer')?.content);
		expect(developerMessage).toContain(
			'Treat selected runtime nodes below as first-class grounding. Prefer them over highlight summaries when both are present unless the user clearly redirects to the highlighted set.'
		);
		expect(developerMessage).toContain(
			'If the Selected runtime nodes line below is not none, there is an active selection. Do not say there is no active selection, and do not ask the user to select something first.'
		);
		expect(developerMessage).toContain(
			'Treat named highlighted targets below as secondary presentation context. They are explicit and valid, but they should not outrank the current selection.'
		);
		expect(developerMessage).toContain(
			'Selected runtime nodes: Hood part [hood] anchored at /Vehicle/Hood covering nodes node-hood.'
		);
	});

	it('describes selection relative to the active semantic group instead of leaving the model to infer from highlight state', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'add this to the body shell group',
				assetId: 'lexus_lc500',
				selectedGroupId: 'body_shell',
				selectedNodes: [
					{
						assetId: 'lexus_lc500',
						targetType: 'part',
						targetId: 'trunk',
						targetName: 'Trunk',
						nodeId: 'node-trunk',
						nodeIds: ['node-trunk'],
						nodeName: 'Trunk',
						nodePath: '/Car/Trunk'
					},
					{
						assetId: 'lexus_lc500',
						targetType: 'part',
						targetId: 'spoiler',
						targetName: 'Spoiler',
						nodeId: 'node-spoiler',
						nodeIds: ['node-spoiler'],
						nodeName: 'Spoiler',
						nodePath: '/Car/Spoiler'
					}
				]
			},
			semanticOverlay: {
				status: 'fresh',
				sidebarCadence: 'stable',
				overlay: {
					assetId: 'lexus_lc500',
					revision: 1,
					generatedAt: 'semantic-1',
					structuralGeneratedAt: 'structural-1',
					model: 'gpt-5.2',
					minAcceptedConfidence: 0.5,
					acceptedMaterials: [],
					acceptedParts: [
						{
							id: 'body_shell_assembly',
							humanLabel: 'Body Shell Assembly',
							aliases: [],
							confidence: 0.95,
							category: 'body',
							nodeIds: ['node-trunk'],
							meshIds: [],
							materialIds: ['material-body']
						}
					],
					acceptedGroups: [
						{
							id: 'body_shell',
							humanLabel: 'Body Shell',
							author: 'agent',
							aliases: [],
							confidence: 0.98,
							category: 'body_shell',
							supports: ['highlight', 'paint'],
							nodeIds: [],
							meshIds: [],
							materialIds: ['material-body']
						}
					],
					discardedSuggestions: []
				}
			},
			historyContext: defaultHistoryContext,
			policySummary:
				'Planning mode is single_tool. Prefer one clear domain action unless the turn proves it needs composition.',
			intentSummary:
				'Intent draft: domain=semantics; operation=assign; referent=selected; targetScope=node; outputMode=spoken; confidence=0.88.',
			describePresentationTargets: () => null
		});

		const developerMessage = String(messages.find((message) => message.role === 'developer')?.content);
		expect(developerMessage).toContain(
			'Semantic edit context: already accepted in the active group: Trunk [trunk]; candidate additions relative to the active group: Spoiler [spoiler].'
		);
	});

	it('includes stored asset-first history context after explicit request state', () => {
		const messages = toOpenAIMessages({
			input: {
				message: 'highlight the wheel',
				assetId: 'audi_r8',
				selectedNodes: [],
				presentation: {
					highlightedTargets: [{ targetId: 'wheel', targetType: 'material', targetName: 'Wheel' }]
				}
			},
			semanticOverlay: {
				status: 'fresh',
				sidebarCadence: 'stable'
			},
			historyContext: {
				currentAssetSummary: 'Stored active-asset context: goal inspect front wheel.',
				userGlobalSummary: 'Stored user-global context: recent assets audi_r8.',
				historySourceOrder: ['current_request', 'current_asset_snapshot', 'current_asset_recent', 'user_global'],
				compactionApplied: true,
				sourceUsed: 'current_asset'
			},
			policySummary: 'Planning mode is single_tool. Prefer one clear domain action unless the turn proves it needs composition.',
			intentSummary: 'Intent draft: domain=presentation; operation=focus; referent=named; targetScope=material; outputMode=spoken; confidence=0.81.',
			describePresentationTargets: () => null
		});

		const developerMessage = String(messages.find((message) => message.role === 'developer')?.content);
		expect(developerMessage.indexOf('No active highlight, material, visibility, or viewer mode context is currently applied.')).toBeLessThan(
			developerMessage.indexOf('Stored current-asset user context:')
		);
		expect(developerMessage).toContain('Stored current-asset user context: Stored active-asset context: goal inspect front wheel.');
		expect(developerMessage).toContain('Stored user-global context: Stored user-global context: recent assets audi_r8.');
		expect(developerMessage).toContain('Stored history was compacted to fit the prompt budget while keeping current-asset context first.');
	});
});
