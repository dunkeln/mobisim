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
			'saying it out loud would mostly waste time'
		);
	});
});
