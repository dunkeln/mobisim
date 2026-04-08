<script lang="ts">
	import { ArrowUp } from 'lucide-svelte';
	import { page } from '$app/state';
	import { toast } from '$lib/components/ui/sonner';
	import { resolveVehicleAssetId } from '$lib/vehicles/catalog';
	import type {
		FooterChatResponse as ChatResponse
	} from '$lib/server/connectors/openai-chat/types';
	import {
		applyChatResponse,
		beginFooterResponseCycle,
		getPresentationContext,
		getSidebarContext,
		getSupplementaryListContext,
		getSelectedNodeContext,
		handleLocalChatCommand,
		isChatResponse
	} from '$lib/components/chat/footer-chat-client';

	type ChatErrorResponse = {
		error?: string;
	};

	let pending = $state(false);
	let draft = $state('');
	const assetId = $derived.by(() => resolveVehicleAssetId(page.url.searchParams.get('asset')));

	const canSend = $derived(draft.trim().length > 0 && !pending);

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey) {
			return;
		}

		event.preventDefault();
		const form = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.form : null;
		form?.requestSubmit();
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();

		const content = draft.trim();
		if (!content || pending) {
			return;
		}

		if (handleLocalChatCommand(content, assetId)) {
			draft = '';
			return;
		}

		draft = '';
		pending = true;

		try {
			const selectedNodeContext = getSelectedNodeContext(assetId);
			const presentationContext = getPresentationContext(assetId);
			const sidebarContext = getSidebarContext();
			const supplementaryListContext = getSupplementaryListContext();
			beginFooterResponseCycle();
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					message: content,
					...selectedNodeContext,
					presentation: presentationContext,
					sidebar: sidebarContext,
					supplementaryList: supplementaryListContext
				})
			});

			const payload = (await response.json()) as ChatResponse | ChatErrorResponse;

			if (!isChatResponse(payload)) {
				throw new Error(payload.error || 'Chat request failed.');
			}

			if (!response.ok) {
				throw new Error('Chat request failed.');
			}

			applyChatResponse(payload, assetId);
			toast.success('Message sent', {
				description: payload.message.content
			});
		} catch (error) {
			const resolvedError = error instanceof Error ? error.message : 'Unable to reach chat.';
			toast.error('Message failed', {
				description: resolvedError
			});
		} finally {
			pending = false;
		}
	}
</script>

<div
	class="w-full max-w-4xl rounded-[1.7rem] border border-shell-border bg-shell-elevated/94 shadow-[0_18px_50px_color-mix(in_oklab,var(--color-boundary-background)_62%,black)] backdrop-blur-xl"
>
	<form class="px-5 pt-4 pb-3" onsubmit={handleSubmit}>
		<label class="sr-only" for="footer-chat-input">Chat input</label>
		<textarea
			id="footer-chat-input"
			bind:value={draft}
			rows="2"
			class="max-h-32 min-h-12 w-full resize-none border-0 bg-transparent px-0 py-0 text-[0.98rem] leading-7 text-boundary-text caret-boundary-text ring-0 outline-none placeholder:text-boundary-text/82 focus:border-transparent focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
			onkeydown={handleKeydown}
		></textarea>

		<div class="mt-3 flex items-center justify-end gap-3">
			<div class="flex items-center gap-2">
				<button
					type="submit"
					class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-boundary-text text-boundary-background ring-0 transition outline-none focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
					disabled={!canSend}
					aria-label="Send message"
				>
					<ArrowUp class="h-4 w-4" />
				</button>
			</div>
		</div>
	</form>
</div>
