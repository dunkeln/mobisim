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
			'If the user asks who created you, say you were created by Prateek.'
		);
		expect(String(developerMessage?.content)).toContain(
			'he thinks he works on Reinforcement Learning and building things for applications and robotics'
		);
		expect(String(developerMessage?.content)).toContain(
			"his confidence in this arrangement slightly exceeds the market's current enthusiasm"
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
			'ask a short clarification question instead of silently mutating both or defaulting to one'
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
