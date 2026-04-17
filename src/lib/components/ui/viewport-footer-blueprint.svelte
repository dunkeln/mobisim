<script lang="ts">
	import { fly, scale } from 'svelte/transition';
	import FooterActiveTool from '$lib/components/ui/footer-active-tool.svelte';
	import FooterOrb from '$lib/components/ui/footer-orb.svelte';
	import { footerSupplementaryList } from '$lib/stores/footer-supplementary-list';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	let { assetId, class: className = '' }: Props = $props();
	const supplementaryList = $derived(
		$footerSupplementaryList[assetId] ?? {
			active: false,
			entries: {}
		}
	);
	const hasSupplementaryList = $derived(
		supplementaryList.active && Object.keys(supplementaryList.entries).length > 0
	);
</script>

<div class={`footer-blueprint ${className}`}>
	{#if hasSupplementaryList}
		<div
			class="footer-blueprint__reference-list footer-blueprint__reference-list--left"
			in:scale={{ duration: 180, start: 0.9 }}
			out:scale={{ duration: 140, start: 1 }}
		>
			<div class="footer-blueprint__reference-panel">
				{#each Object.entries(supplementaryList.entries) as [key, value], index (`${index}-${key}`)}
					<div
						class="footer-blueprint__reference-item"
						in:fly={{ y: 10, duration: 220, delay: index * 55 }}
					>
						<span class="footer-blueprint__reference-key">{key}</span>
						<span class="footer-blueprint__reference-value">{value}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
	<div class="footer-blueprint__cluster footer-blueprint__cluster--center">
		<div class="footer-blueprint__orb-slot">
			<FooterOrb class="footer-blueprint__orb-live" />
			<span class="footer-blueprint__label footer-blueprint__label--orb">FRIDAY</span>
		</div>
	</div>
	<div class="footer-blueprint__trace">
		<FooterActiveTool />
	</div>
</div>

<style>
	.footer-blueprint {
		position: absolute;
		left: 1.25rem;
		right: 1.25rem;
		bottom: 1.85rem;
		min-height: 5.5rem;
		pointer-events: none;
	}

	.footer-blueprint__cluster {
		position: relative;
		display: flex;
		align-items: end;
		min-width: 0;
	}

	.footer-blueprint__cluster--center {
		position: absolute;
		left: 50%;
		bottom: 0;
		transform: translateX(-50%);
		width: auto;
		height: 4.6rem;
		gap: 0.6rem;
		justify-content: center;
		align-items: center;
		pointer-events: auto;
	}

	.footer-blueprint__reference-list--left {
		position: absolute;
		left: 0;
		bottom: 0;
		z-index: 1;
		pointer-events: auto;
	}

	.footer-blueprint__orb-slot {
		position: relative;
		display: inline-flex;
		width: 4.6rem;
		height: 4.6rem;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		pointer-events: auto;
		z-index: 2;
	}

	.footer-blueprint__trace {
		position: absolute;
		right: 0;
		bottom: 0;
		display: inline-flex;
		justify-content: flex-end;
		pointer-events: none;
		z-index: 1;
	}

	.footer-blueprint__orb-live {
		transform: scale(0.82);
	}

	.footer-blueprint__label--orb {
		position: absolute;
		left: 50%;
		top: calc(100% - 0.2rem);
		transform: translateX(-50%);
		pointer-events: none;
	}

	.footer-blueprint__reference-list {
		--footer-reference-width: 18rem;
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
		gap: 0.58rem;
		width: var(--footer-reference-width);
		padding: 0;
		isolation: isolate;
	}

	.footer-blueprint__reference-item {
		position: relative;
		z-index: 1;
		width: 100%;
		display: block;
		margin: 0;
		padding: 0.58rem 0.7rem;
		border: 1px solid color-mix(in oklab, var(--color-boundary-text) 12%, transparent);
		border-radius: 1rem;
		background:
			linear-gradient(
				180deg,
				color-mix(in oklab, white 14%, transparent),
				color-mix(in oklab, white 5%, transparent) 38%,
				color-mix(in oklab, var(--color-boundary-background) 8%, transparent) 72%,
				color-mix(in oklab, var(--color-boundary-background) 16%, transparent)
			),
			radial-gradient(
				circle at 16% 0%,
				color-mix(in oklab, white 18%, transparent),
				transparent 32%
			),
			radial-gradient(
				circle at 84% 18%,
				color-mix(in oklab, var(--color-boundary-primary) 16%, transparent),
				transparent 30%
			);
		box-shadow:
			inset 0 1px 0 color-mix(in oklab, white 20%, transparent),
			inset 0 -1px 0 color-mix(in oklab, white 4%, transparent),
			0 16px 32px color-mix(in oklab, var(--color-boundary-background) 24%, black);
		backdrop-filter: blur(26px) saturate(148%);
		-webkit-backdrop-filter: blur(26px) saturate(148%);
		font-size: 0.66rem;
		line-height: 1.45;
		white-space: normal;
		overflow: hidden;
	}

	.footer-blueprint__reference-item::before {
		content: '';
		position: absolute;
		inset: 1px;
		border-radius: inherit;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, white 11%, transparent),
				color-mix(in srgb, white 3%, transparent) 18%,
				transparent 36%,
				transparent 100%
			),
			radial-gradient(
				96% 72% at 16% 0%,
				color-mix(in srgb, white 7%, transparent),
				transparent 22%
			);
		pointer-events: none;
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
		white-space: nowrap;
	}

	@media (max-width: 960px) {
		.footer-blueprint {
			left: 0.9rem;
			right: 0.9rem;
			min-height: 4.8rem;
		}
	}
</style>
