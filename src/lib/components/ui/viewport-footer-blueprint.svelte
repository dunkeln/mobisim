<script lang="ts">
	import { scale } from 'svelte/transition';
	import SemanticIngressLiveWindow from '$lib/components/inspector/semantic-ingress-live-window.svelte';
	import SemanticIngressPanel from '$lib/components/inspector/semantic-ingress-panel.svelte';
	import FooterActiveTool from '$lib/components/ui/footer-active-tool.svelte';
	import FooterOrb from '$lib/components/ui/footer-orb.svelte';
	import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	let { assetId, class: className = '' }: Props = $props();
	const supplementaryList = $derived($footerSupplementaryList);
	const hasSupplementaryList = $derived(
		supplementaryList.active && Object.keys(supplementaryList.entries).length > 0
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
			<FooterActiveTool class="footer-blueprint__tool-chip" />
		</div>
		<div class="footer-blueprint__orb-slot">
			<FooterOrb class="footer-blueprint__orb-live" />
			<span class="footer-blueprint__label footer-blueprint__label--orb">FRIDAY</span>
		</div>
		<div class="footer-blueprint__stack footer-blueprint__stack--right">
			{#if hasSupplementaryList}
				<div
					class="footer-blueprint__reference-list"
					in:scale={{ duration: 180, start: 0.9 }}
					out:scale={{ duration: 140, start: 1 }}
				>
					<div class="footer-blueprint__reference-panel">
						{#each Object.entries(supplementaryList.entries) as [key, value], index (`${index}-${key}`)}
							<div class="footer-blueprint__reference-item">
								<span class="footer-blueprint__reference-key">{key}</span>
								<span class="footer-blueprint__reference-value">{value}</span>
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
		transform: translateY(-3rem);
		z-index: 1;
	}

	.footer-blueprint__stack--right {
		position: absolute;
		left: calc(100% + 0.4rem);
		top: 50%;
		transform: translateY(calc(-58% - 0.9rem));
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

	:global(.footer-blueprint__tool-chip) {
		position: relative;
		z-index: 1;
	}

	.footer-blueprint__reference-list {
		--footer-reference-width: 17.5rem;
		position: relative;
		display: inline-flex;
		min-width: var(--footer-reference-width);
		isolation: isolate;
		transform-origin: left center;
	}

	.footer-blueprint__reference-panel {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.58rem;
		width: var(--footer-reference-width);
		padding: 1rem 1rem 0.96rem;
		border-radius: 1.1rem;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 15%, transparent);
		background:
			radial-gradient(circle at 22% 10%, color-mix(in srgb, white 6%, transparent), transparent 24%),
			linear-gradient(
				180deg,
				color-mix(in srgb, white 4%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 1.9%, transparent) 38%,
				color-mix(in srgb, var(--color-boundary-text) 0.75%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 15%, transparent),
			0 12px 26px color-mix(in srgb, var(--color-boundary-background) 13%, transparent);
		backdrop-filter: blur(18px) saturate(108%);
		-webkit-backdrop-filter: blur(18px) saturate(108%);
		isolation: isolate;
	}

	.footer-blueprint__reference-panel::before {
		content: '';
		position: absolute;
		inset: 1px;
		border-radius: inherit;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, white 9%, transparent),
				color-mix(in srgb, white 2%, transparent) 18%,
				transparent 34%,
				transparent 100%
			),
			radial-gradient(
				115% 76% at 16% 0%,
				color-mix(in srgb, white 5%, transparent),
				transparent 20%
			);
		pointer-events: none;
	}

	.footer-blueprint__reference-item {
		position: relative;
		z-index: 1;
		width: 100%;
		display: block;
		font-size: 0.66rem;
		line-height: 1.45;
		white-space: normal;
	}

	.footer-blueprint__reference-key {
		display: inline;
		font-weight: 700;
		color: var(--color-boundary-tertiary);
	}

	.footer-blueprint__reference-value {
		display: inline;
		margin-left: 0.8ch;
		color: color-mix(in srgb, var(--color-boundary-text) 88%, transparent);
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
