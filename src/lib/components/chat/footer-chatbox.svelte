<script lang="ts">
	import { get } from 'svelte/store';
	import { ArrowUp, Plus } from 'lucide-svelte';
	import { page } from '$app/state';
	import { toast } from '$lib/components/ui/sonner';
	import { vehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import { resolveVehicleAssetId } from '$lib/vehicles/catalog';
	import type {
		FooterChatMessage as ChatMessage,
		FooterChatResponse as ChatResponse
	} from '$lib/server/connectors/openai-chat/types';

	type ChatErrorResponse = {
		error?: string;
	};

	let pending = $state(false);
	let draft = $state('');
	const assetId = $derived.by(() => resolveVehicleAssetId(page.url.searchParams.get('asset')));
	const selectedNode = $derived($vehicleNodeSelection);

	const canSend = $derived(draft.trim().length > 0 && !pending);

	function isChatResponse(payload: ChatResponse | ChatErrorResponse): payload is ChatResponse {
		return 'message' in payload && 'model' in payload;
	}

	function isUndoRequest(content: string): boolean {
		return /\b(undo|revert|go back|step back)\b/i.test(content.trim());
	}

	function isRedoRequest(content: string): boolean {
		return /\b(redo|reapply|do that again)\b/i.test(content.trim());
	}

	function isResetRequest(content: string): boolean {
		return /^(reset|reset (the )?(car|vehicle|view|changes)|undo all|revert all|clear changes|start over)$/i.test(
			content.trim()
		);
	}

	function isClearHighlightRequest(content: string): boolean {
		return /^(clear|remove|undo|reset) (the )?(highlight|highlights)$/i.test(content.trim());
	}

	function describeIntentLabel(label: string | null | undefined, fallback: string): string {
		const normalized = label?.trim();
		return normalized && normalized.length > 0 ? normalized : fallback;
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();

		const content = draft.trim();
		if (!content || pending) {
			return;
		}

		if (isUndoRequest(content)) {
			const previousState = get(vehiclePatchState);
			const didUndo = vehiclePatchState.undo(assetId);
			const nextState = get(vehiclePatchState);
			const undoneLabel = describeIntentLabel(previousState.intentLabel, 'the last vehicle change');
			const restoredLabel = describeIntentLabel(nextState.intentLabel, 'the previous vehicle state');
			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: didUndo
					? `Undid ${undoneLabel} and restored ${restoredLabel}.`
					: 'There is no vehicle change to undo.'
			};
			draft = '';
			toast.success(didUndo ? 'Undo applied' : 'Nothing to undo', {
				description: assistantMessage.content
			});
			return;
		}

		if (isRedoRequest(content)) {
			const previousState = get(vehiclePatchState);
			const didRedo = vehiclePatchState.redo(assetId);
			const nextState = get(vehiclePatchState);
			const redoneLabel = describeIntentLabel(nextState.intentLabel, previousState.intentLabel ?? 'the last undone change');
			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: didRedo
					? `Reapplied ${redoneLabel}.`
					: 'There is no vehicle change to redo.'
			};
			draft = '';
			toast.success(didRedo ? 'Redo applied' : 'Nothing to redo', {
				description: assistantMessage.content
			});
			return;
		}

		if (isResetRequest(content)) {
			const didReset = vehiclePatchState.reset(assetId);
			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: didReset
					? 'Reset the vehicle to its original GLB state.'
					: 'There are no vehicle changes to reset.'
			};
			draft = '';
			toast.success(didReset ? 'Vehicle reset' : 'Nothing to reset', {
				description: assistantMessage.content
			});
			return;
		}

		if (isClearHighlightRequest(content)) {
			const didClear = vehiclePatchState.clearHighlights(assetId);
			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: didClear
					? 'Cleared the active highlight overlays.'
					: 'There are no highlight overlays to clear.'
			};
			draft = '';
			toast.success(didClear ? 'Highlights cleared' : 'No highlights to clear', {
				description: assistantMessage.content
			});
			return;
		}

		draft = '';
		pending = true;

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					message: content,
					assetId,
					selectedNodeId: selectedNode?.assetId === assetId ? selectedNode.nodeId : undefined,
					selectedNodeName: selectedNode?.assetId === assetId ? selectedNode.nodeName : undefined,
					selectedNodePath: selectedNode?.assetId === assetId ? selectedNode.nodePath : undefined
				})
			});

			const payload = (await response.json()) as ChatResponse | ChatErrorResponse;

			if (!isChatResponse(payload)) {
				throw new Error(payload.error || 'Chat request failed.');
			}

			if (!response.ok) {
				throw new Error('Chat request failed.');
			}

			if (payload.vehiclePatchOperations && payload.vehiclePatchOperations.length > 0) {
				const targetAssetId = payload.vehiclePatchAssetId;

				if (targetAssetId && targetAssetId === assetId) {
					vehiclePatchState.queue(
						targetAssetId,
						payload.vehiclePatchOperations,
						payload.vehiclePatchLabel ?? payload.message.content
					);
				} else {
					throw new Error('Chat returned patch operations for a different vehicle asset.');
				}
			}
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
			placeholder=""
		></textarea>

		<div class="mt-3 flex items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-1.5 text-shell-subtle">
				<button
					type="button"
					class="inline-flex h-7 w-7 items-center justify-center rounded-full ring-0 transition outline-none hover:text-boundary-text focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
					aria-label="Add context"
				>
					<Plus class="h-4 w-4" />
				</button>
			</div>

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
