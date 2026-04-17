<script lang="ts">
	import { onMount, tick } from 'svelte';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import RestRequestToast from '$lib/components/ui/rest-request-toast.svelte';
	import { toast } from '$lib/components/ui/sonner';
	import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
	import type { VehicleSemanticOverlaySnapshot } from '$lib/server/connectors/vehicle-semantic-overlay/types';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	let { assetId, class: className = '' }: Props = $props();
	let isPending = $state(false);

	async function loadCurrentOverlay(): Promise<void> {
		try {
			const response = await fetch(`/api/vehicle-assets/${assetId}/semantic-overlay`, {
				method: 'GET'
			});

			if (!response.ok) {
				return;
			}

			const payload = (await response.json()) as VehicleSemanticOverlaySnapshot;
			semanticRuntimeState.applyAssetState(assetId, {
				overlaySnapshot: payload
			});
		} catch {}
	}

	async function reloadOverlay(): Promise<void> {
		if (isPending) {
			return;
		}

		isPending = true;
		await tick();
		const requestPath = `/api/vehicle-assets/${assetId}/semantic-overlay?source=semantic-overlay-control&action=reload`;
		toast.custom(RestRequestToast, {
			componentProps: {
				method: 'GET',
				path: requestPath
			},
			duration: 1400
		});

		try {
			const response = await fetch(requestPath, {
				method: 'GET'
			});

			if (!response.ok) {
				const fallbackReason = await response.text().catch(() => '');
				throw new Error(
					fallbackReason.trim().length > 0
						? fallbackReason
						: `Semantic overlay request failed: ${response.status}`
				);
			}

			const payload = (await response.json()) as VehicleSemanticOverlaySnapshot;

			semanticRuntimeState.applyAssetState(assetId, {
				overlaySnapshot: payload
			});
		} catch {
			// Fail closed. The control should reflect only confirmed shared state.
		} finally {
			isPending = false;
		}
	}

	onMount(() => {
		void loadCurrentOverlay();
	});
</script>

<section class={['overlay-control', className]}>
	<button
		type="button"
		class="overlay-control__button"
		aria-busy={isPending}
		aria-label="Reload semantic overlay"
		title="Reload current semantic overlay"
		disabled={isPending}
		onpointerdown={(event) => {
			event.preventDefault();
			event.stopPropagation();
			void reloadOverlay();
		}}
	>
		{#if isPending}
			<span class="overlay-control__pending">···</span>
		{:else}
			<RotateCcw class="overlay-control__icon" size={14} />
		{/if}
	</button>
</section>

<style>
	.overlay-control {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.overlay-control__button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 12%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 4%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2.5%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.75%, transparent)
			);
		color: color-mix(in oklab, var(--boundary-text) 46%, transparent);
		cursor: pointer;
		user-select: none;
		touch-action: manipulation;
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 6%, transparent),
			0 10px 24px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		backdrop-filter: blur(16px) saturate(106%);
		-webkit-backdrop-filter: blur(16px) saturate(106%);
		transition:
			border-color 180ms ease,
			color 180ms ease,
			box-shadow 180ms ease;
	}

	.overlay-control__button:hover:not(:disabled) {
		color: color-mix(in oklab, var(--boundary-text) 86%, transparent);
		border-color: color-mix(in srgb, var(--color-boundary-text) 16%, transparent);
		background:
			radial-gradient(
				44% 38% at 24% 18%,
				color-mix(in srgb, var(--color-boundary-secondary) 10%, transparent),
				transparent 72%
			),
			radial-gradient(
				34% 32% at 76% 30%,
				color-mix(in srgb, var(--color-boundary-secondary) 7%, transparent),
				transparent 78%
			),
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 5%, transparent), transparent 26%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-secondary) 6%, transparent),
				color-mix(in srgb, var(--color-boundary-secondary) 2%, transparent) 55%,
				color-mix(in srgb, var(--color-boundary-text) 1.25%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 7%, transparent),
			inset 0 0 20px color-mix(in srgb, var(--color-boundary-secondary) 5%, transparent),
			0 12px 28px color-mix(in srgb, var(--color-boundary-background) 14%, transparent);
		transform: translateY(-1px);
	}

	.overlay-control__button:disabled {
		cursor: wait;
		opacity: 0.45;
	}

	.overlay-control__icon {
		flex-shrink: 0;
	}

	.overlay-control__pending {
		font-size: 0.6rem;
		font-family: var(--font-mono, monospace);
		letter-spacing: 0.08em;
		color: color-mix(in oklab, var(--boundary-tertiary) 72%, transparent);
	}
</style>
