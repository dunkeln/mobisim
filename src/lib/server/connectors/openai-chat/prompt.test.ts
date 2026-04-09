import { describe, expect, it } from 'vitest';
import { toOpenAIMessages } from './prompt';

describe('toOpenAIMessages', () => {
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
});
