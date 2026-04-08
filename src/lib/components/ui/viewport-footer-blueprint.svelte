<script lang="ts">
	import { scale } from 'svelte/transition';
	import SemanticIngressLiveWindow from '$lib/components/inspector/semantic-ingress-live-window.svelte';
	import SemanticIngressPanel from '$lib/components/inspector/semantic-ingress-panel.svelte';
	import FooterActiveTool from '$lib/components/ui/footer-active-tool.svelte';
	import FooterOrb from '$lib/components/ui/footer-orb.svelte';
	import { footerActiveTool } from '$lib/stores/footer-active-tool';
	import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	let { assetId, class: className = '' }: Props = $props();
	const activeTool = $derived($footerActiveTool);
	const supplementaryList = $derived($footerSupplementaryList);
	const hasSupplementaryList = $derived(
		supplementaryList.active && supplementaryList.items.length > 0
	);
</script>

<div class={`footer-blueprint ${className}`}>
	<div class="footer-blueprint__cluster footer-blueprint__cluster--left">
		<div class="footer-blueprint__ingress-stack">
			<SemanticIngressLiveWindow
				{assetId}
				class="footer-blueprint__hud footer-blueprint__hud--live"
			/>
			<SemanticIngressPanel
				{assetId}
				class="footer-blueprint__hud footer-blueprint__hud--ingress"
			/>
		</div>
	</div>
	<div class="footer-blueprint__cluster footer-blueprint__cluster--center">
		<div class="footer-blueprint__stack footer-blueprint__stack--left">
			{#if activeTool.active && activeTool.label}
				<div
					class="footer-blueprint__tool-stack"
					in:scale={{ duration: 180, start: 0.9 }}
					out:scale={{ duration: 140, start: 1 }}
				>
					<div class="footer-blueprint__tool-layer footer-blueprint__tool-layer--back"></div>
					<div class="footer-blueprint__tool-layer footer-blueprint__tool-layer--mid"></div>
					<FooterActiveTool class="footer-blueprint__tool-chip" />
				</div>
			{/if}
		</div>
		<div class="footer-blueprint__orb-slot">
			<FooterOrb class="footer-blueprint__orb-live" />
			<span class="footer-blueprint__label footer-blueprint__label--orb">not Ultron</span>
		</div>
		<div class="footer-blueprint__stack footer-blueprint__stack--right">
			{#if hasSupplementaryList}
				<div
					class="footer-blueprint__reference-list"
					in:scale={{ duration: 180, start: 0.9 }}
					out:scale={{ duration: 140, start: 1 }}
				>
					<div class="footer-blueprint__reference-panel">
						{#each supplementaryList.items as item, index (`${index}-${item}`)}
							<div
								class="footer-blueprint__reference-item"
								class:footer-blueprint__reference-item--primary={index === 0}
							>
								{item}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.footer-blueprint {
		position: absolute;
		left: 1.25rem;
		right: 1.25rem;
		bottom: 1.85rem;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: end;
		gap: 1rem;
		pointer-events: none;
	}

	.footer-blueprint__cluster {
		position: relative;
		display: flex;
		align-items: end;
		min-width: 0;
	}

	.footer-blueprint__cluster--left {
		justify-content: flex-start;
		align-self: end;
	}

	.footer-blueprint__cluster--center {
		width: 4.6rem;
		height: 4.6rem;
		justify-content: center;
		align-items: center;
	}

	.footer-blueprint__ingress-stack {
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.footer-blueprint__hud {
		transform-origin: bottom left;
		transform: scale(0.84);
	}

	.footer-blueprint__hud--live {
		margin-left: 0.7rem;
	}

	.footer-blueprint__hud--ingress {
		margin-bottom: 0;
	}

	.footer-blueprint__stack {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.footer-blueprint__stack--left {
		position: absolute;
		right: calc(100% - 0.55rem);
		top: 50%;
		transform: translateY(-50%);
		z-index: 1;
	}

	.footer-blueprint__stack--right {
		position: absolute;
		left: calc(100% - 0.45rem);
		top: 50%;
		transform: translateY(-62%);
		z-index: 1;
	}

	.footer-blueprint__orb-slot {
		position: relative;
		border: 1px dashed color-mix(in oklab, var(--boundary-primary) 38%, var(--boundary-text) 8%);
		background: color-mix(in oklab, var(--boundary-background) 18%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--boundary-text) 3%, transparent);
	}

	.footer-blueprint__orb-slot {
		display: inline-flex;
		width: 4.6rem;
		height: 4.6rem;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		pointer-events: auto;
		z-index: 2;
	}

	.footer-blueprint__orb-live {
		transform: scale(0.82);
	}

	.footer-blueprint__tool-stack {
		--footer-tool-stack-width: 8.9rem;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		width: 10.4rem;
		height: 2.8rem;
		padding-right: 0.72rem;
		isolation: isolate;
		transform-origin: right center;
	}

	.footer-blueprint__tool-layer,
	:global(.footer-blueprint__tool-chip .tool-shell) {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		border-radius: 999px;
	}

	.footer-blueprint__tool-layer {
		width: var(--footer-tool-stack-width);
		height: 2rem;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 10%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 3%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.6%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 4%, transparent),
			0 8px 20px color-mix(in srgb, var(--color-boundary-background) 10%, transparent);
		backdrop-filter: blur(16px) saturate(106%);
		-webkit-backdrop-filter: blur(16px) saturate(106%);
	}

	.footer-blueprint__tool-layer--mid {
		right: 0.24rem;
		top: calc(50% - 0.12rem);
		opacity: 0.42;
		z-index: 0;
	}

	.footer-blueprint__tool-layer--back {
		right: 0.48rem;
		top: calc(50% - 0.24rem);
		opacity: 0.42;
		z-index: -1;
	}

	:global(.footer-blueprint__tool-chip) {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		z-index: 1;
		width: var(--footer-tool-stack-width);
		max-width: var(--footer-tool-stack-width);
	}

	:global(.footer-blueprint__tool-chip .tool-shell) {
		right: 0;
		width: var(--footer-tool-stack-width);
		max-width: var(--footer-tool-stack-width);
	}

	.footer-blueprint__reference-list {
		--footer-reference-width: 10.6rem;
		position: relative;
		display: inline-flex;
		min-width: var(--footer-reference-width);
		isolation: isolate;
		transform-origin: left center;
	}

	.footer-blueprint__reference-items {
		display: none;
	}

	.footer-blueprint__reference-panel {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.42rem;
		width: var(--footer-reference-width);
		padding: 0.9rem 0.82rem 0.86rem;
		border-radius: 1.1rem;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 12%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 4%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2.5%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.75%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 6%, transparent),
			0 10px 24px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		backdrop-filter: blur(16px) saturate(106%);
		-webkit-backdrop-filter: blur(16px) saturate(106%);
		isolation: isolate;
	}

	.footer-blueprint__reference-panel::before {
		content: '';
		position: absolute;
		inset: 1px;
		border-radius: inherit;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 6%, transparent);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, white 3%, transparent),
				transparent 24%,
				transparent 100%
			),
			radial-gradient(
				110% 70% at 18% 0%,
				color-mix(in srgb, white 3%, transparent),
				transparent 26%
			);
		pointer-events: none;
	}

	.footer-blueprint__reference-item {
		position: relative;
		z-index: 1;
		width: 100%;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--color-boundary-text) 78%, transparent);
		line-height: 1.35;
		white-space: normal;
		overflow: visible;
	}

	.footer-blueprint__reference-item--primary {
		color: color-mix(in srgb, var(--color-boundary-text) 90%, transparent);
	}

	.footer-blueprint__label {
		font-family: var(--font-mono);
		font-size: 0.54rem;
		letter-spacing: 0.16em;
		color: color-mix(in oklab, var(--boundary-text) 54%, var(--boundary-primary));
		white-space: nowrap;
	}

	.footer-blueprint__label--orb {
		position: absolute;
		bottom: -1rem;
		left: 50%;
		transform: translateX(-50%);
	}

	@media (max-width: 960px) {
		.footer-blueprint {
			left: 0.9rem;
			right: 0.9rem;
			gap: 0.7rem;
		}

		.footer-blueprint__cluster--left,
		.footer-blueprint__cluster--right {
			display: none;
		}

		.footer-blueprint {
			grid-template-columns: 1fr;
		}
	}
</style>
