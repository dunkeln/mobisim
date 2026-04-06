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

<section class={['relative flex min-w-[2.75rem] items-center justify-center', className]}>
	<button
		type="button"
		class="flex h-9 min-w-[2.75rem] items-center justify-center rounded-4xl border border-[color:color-mix(in_oklab,var(--color-boundary-text)_10%,transparent)] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_54%,transparent)] px-3.5 text-boundary-text/78 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_9%,transparent),0_10px_24px_color-mix(in_oklab,var(--color-boundary-background)_24%,black)] backdrop-blur-xl"
		aria-expanded={isActive}
		aria-label="Adjust lighting"
		onpointerdown={activate}
	>
		{#if isActive}
			<span
				class="text-[0.68rem] font-medium tracking-[0.12em] text-boundary-secondary tabular-nums"
			>
				{value.toFixed(2)}
			</span>
		{:else}
			<Spotlight class="h-4 w-4" />
		{/if}
	</button>

	{#if isActive}
		<div
			class="pointer-events-auto absolute top-[calc(100%+0.5rem)] left-1/2 z-40 w-[11rem] -translate-x-1/2 rounded-full border border-[color:color-mix(in_oklab,var(--color-boundary-text)_12%,transparent)] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_56%,transparent)] px-2.5 py-1 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_10%,transparent),0_10px_24px_color-mix(in_oklab,var(--color-boundary-background)_30%,black)] backdrop-blur-xl"
			bind:this={sliderContainer}
		>
			<Slider
				bind:value
				showValue={false}
				id="lighting-control"
				min={MIN_LIGHT_INTENSITY}
				max={MAX_LIGHT_INTENSITY}
				step={LIGHT_INTENSITY_STEP}
			/>
		</div>
	{/if}
</section>
