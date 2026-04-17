<script lang="ts">
	import { tick } from 'svelte';
	import Spotlight from 'lucide-svelte/icons/spotlight';
	import Slider from '$lib/components/ui/slider.svelte';

	type Props = {
		value?: number;
		class?: string;
	};

	const MIN_LIGHT_INTENSITY = 0.1;
	const MAX_LIGHT_INTENSITY = 2.5;
	const LIGHT_INTENSITY_STEP = 0.05;

	let { value = $bindable(1), class: className = '' }: Props = $props();
	let isActive = $state(false);
	let sliderContainer = $state<HTMLDivElement | undefined>(undefined);

	function clampValue(nextValue: number): number {
		const stepped =
			MIN_LIGHT_INTENSITY +
			Math.round((nextValue - MIN_LIGHT_INTENSITY) / LIGHT_INTENSITY_STEP) * LIGHT_INTENSITY_STEP;

		return Math.min(MAX_LIGHT_INTENSITY, Math.max(MIN_LIGHT_INTENSITY, stepped));
	}

	function updateFromPointer(clientX: number): void {
		if (!sliderContainer) return;

		const bounds = sliderContainer.getBoundingClientRect();
		if (bounds.width <= 0) return;

		const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
		value = clampValue(MIN_LIGHT_INTENSITY + ratio * (MAX_LIGHT_INTENSITY - MIN_LIGHT_INTENSITY));
	}

	async function activate(event: PointerEvent): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		isActive = true;
		await tick();
		updateFromPointer(event.clientX);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!isActive) return;
		updateFromPointer(event.clientX);
	}

	function deactivate(): void {
		isActive = false;
	}
</script>

<svelte:window
	onpointermove={handlePointerMove}
	onpointerup={deactivate}
	onpointercancel={deactivate}
/>

<section class={['canvas-control', className]}>
	<button
		type="button"
		class="lighting-control__button"
		aria-expanded={isActive}
		aria-label="Adjust lighting"
		onpointerdown={activate}
	>
		{#if isActive}
			<span class="lighting-control__value">
				{value.toFixed(2)}
			</span>
		{:else}
			<Spotlight class="lighting-control__icon" size={14} />
		{/if}
	</button>

	{#if isActive}
		<div
			class="lighting-control__popover pointer-events-auto absolute top-[calc(100%+0.45rem)] left-1/2 z-40 w-[10.5rem] -translate-x-1/2"
			bind:this={sliderContainer}
		>
			<Slider
				bind:value
				showValue={false}
				id="lighting-control"
				class="lighting-control__slider"
				min={MIN_LIGHT_INTENSITY}
				max={MAX_LIGHT_INTENSITY}
				step={LIGHT_INTENSITY_STEP}
			/>
		</div>
	{/if}
</section>

<style>
	.lighting-control__button {
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
			background 180ms ease,
			border-color 180ms ease,
			box-shadow 180ms ease,
			color 180ms ease;
	}

	.lighting-control__button:hover {
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

	.lighting-control__icon {
		flex-shrink: 0;
		color: inherit;
		opacity: 0.92;
	}

	.lighting-control__value {
		font-size: 0.58rem;
		font-weight: 500;
		font-family: var(--font-mono, monospace);
		letter-spacing: 0.06em;
		tabular-nums: initial;
		color: var(--boundary-secondary);
	}

	.lighting-control__popover {
		position: absolute;
		padding: 0;
		isolation: isolate;
	}

	:global(.lighting-control__slider) {
		position: relative;
		z-index: 1;
	}
</style>
