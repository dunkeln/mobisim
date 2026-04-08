import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyChatResponse,
	beginFooterResponseCycle
} from '$lib/components/chat/footer-chat-client';
import { footerActiveTool } from '$lib/stores/footer-active-tool';
import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
import type { FooterChatResponse } from '$lib/server/connectors/openai-chat/types';

function buildResponse(overrides: Partial<FooterChatResponse> = {}): FooterChatResponse {
	return {
		message: {
			role: 'assistant',
			content: 'Updated the footer state.'
		},
		model: 'test-model',
		...overrides
	};
}

describe('footer chat footer lifecycle', () => {
	beforeEach(() => {
		footerActiveTool.reset();
		footerSupplementaryList.reset();
	});

	it('tears down tool and supplementary footer UI at the start of a new model cycle', () => {
		footerActiveTool.setFromToolCalls(['set_vehicle_view_mode']);
		footerSupplementaryList.set({
			active: true,
			items: ['selected body shell']
		});

		beginFooterResponseCycle();

		expect(footerActiveTool.getSnapshot()).toEqual({
			active: false,
			label: '',
			toolName: null,
			toolLabels: [],
			toolNames: []
		});
		expect(footerSupplementaryList.getContext()).toEqual({
			active: false,
			items: []
		});
	});

	it('clears the supplementary list when the response does not provide one', () => {
		footerSupplementaryList.set({
			active: true,
			items: ['selected body shell']
		});

		applyChatResponse(
			buildResponse({
				trace: {
					route: 'llm',
					semanticOverlayStatus: 'fresh',
					toolCalls: [],
					sidebarAction: 'unchanged',
					supplementaryListAction: 'cleared'
				}
			})
		);

		expect(footerSupplementaryList.getContext()).toEqual({
			active: false,
			items: []
		});
	});
});
