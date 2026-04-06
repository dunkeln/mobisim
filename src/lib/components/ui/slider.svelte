<script lang="ts">
	type MarkLevel = 'major' | 'minor';

	type SliderMark = {
		key: string;
		x: number;
		level: MarkLevel;
		opacity: number;
		selected: boolean;
	};

	type Props = {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		showValue?: boolean;
		label?: string;
		id?: string;
		class?: string;
	};

	const MARK_SPACING_PX = 5;
	const MAJOR_VALUE_STEP = 0.1;

	let {
		value = $bindable(1),
		min = 0.25,
		max = 2.5,
		step = 0.01,
		showValue = true,
		label,
		id = 'slider',
		class: className = ''
	}: Props = $props();

	let railWidth = $state(0);

	const clampedValue = $derived(Math.min(max, Math.max(min, value)));
	const totalSteps = $derived(Math.max(1, Math.round((max - min) / step)));
	const stepPosition = $derived((clampedValue - min) / step);
	const leadingStep = $derived(Math.floor(stepPosition));
	const selectedStep = $derived(Math.round(stepPosition));
	const fractionalOffset = $derived(stepPosition - leadingStep);
	const halfVisibleSteps = $derived(Math.max(12, Math.ceil(railWidth / (MARK_SPACING_PX * 2)) + 3));
	const marksTopClass = $derived(showValue ? 'top-[calc(50%+0.5rem)]' : 'top-1/2');

	const marks = $derived.by<SliderMark[]>(() => {
		const centerX = railWidth / 2;
		const nextMarks: SliderMark[] = [];
		const majorStepCount = Math.max(1, Math.round(MAJOR_VALUE_STEP / step));

		for (let offset = -halfVisibleSteps; offset <= halfVisibleSteps; offset += 1) {
			const markIndex = leadingStep + offset;

			if (markIndex < 0 || markIndex > totalSteps) continue;

			const x = centerX + (offset - fractionalOffset) * MARK_SPACING_PX;
			const distanceRatio = centerX === 0 ? 0 : Math.min(1, Math.abs(x - centerX) / centerX);
			const opacity = 0.18 + (1 - distanceRatio) * 0.62;
			const level: MarkLevel = markIndex % majorStepCount === 0 ? 'major' : 'minor';

			nextMarks.push({
				key: `${markIndex}-${offset}`,
				x,
				level,
				opacity,
				selected: markIndex === selectedStep
			});
		}

		return nextMarks;
	});
</script>

<div class={['grid gap-2', className]}>
	{#if label}
		<div class="flex items-center gap-3 sm:min-w-24">
			<label
				class="text-[0.68rem] font-medium tracking-[0.18em] text-shell-subtle uppercase"
				for={id}
			>
				{label}
			</label>
		</div>
	{/if}

	<div class="relative h-7 w-full overflow-hidden" bind:clientWidth={railWidth}>
		{#if showValue}
			<span
				class="pointer-events-none absolute top-0 left-1/2 z-20 -translate-x-1/2 text-[0.68rem] font-medium tracking-[0.12em] text-boundary-secondary tabular-nums"
			>
				{clampedValue.toFixed(2)}
			</span>
		{/if}
		<div
			class="pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--color-boundary-background)_88%,black),transparent)]"
		></div>
		<div
			class="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-[linear-gradient(270deg,color-mix(in_oklab,var(--color-boundary-background)_88%,black),transparent)]"
		></div>
		{#each marks as mark (mark.key)}
			<div
				class={[
					'pointer-events-none absolute w-[1.5px] -translate-x-1/2 -translate-y-1/2 bg-boundary-text',
					marksTopClass,
					mark.level === 'major' && 'h-4',
					mark.level === 'minor' && 'h-2'
				]}
				style:left={`${mark.x}px`}
				style:background-color={mark.selected
					? 'var(--color-boundary-secondary)'
					: 'var(--color-boundary-text)'}
				style:opacity={mark.selected ? 0.92 : mark.opacity}
			></div>
		{/each}

		<input
			{id}
			bind:value
			{min}
			{max}
			{step}
			type="range"
			aria-label={label ?? 'slider'}
			class="absolute inset-0 z-30 h-full w-full cursor-ew-resize appearance-none opacity-0"
		/>
	</div>
</div>
