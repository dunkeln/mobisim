<script lang="ts">
	type Props = {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		label?: string;
		id?: string;
		class?: string;
	};

	let {
		value = $bindable(1),
		min = 0.25,
		max = 2.5,
		step = 0.01,
		label,
		id = 'slider',
		class: className = ''
	}: Props = $props();
</script>

<div class={['grid gap-3', className]}>
	{#if label}
		<div class="flex items-center justify-between gap-3">
			<label class="text-[0.68rem] font-medium tracking-[0.18em] text-shell-subtle uppercase" for={id}>
				{label}
			</label>
			<span class="text-xs text-boundary-text/72">{value.toFixed(2)}</span>
		</div>
	{/if}

	<input
		{id}
		bind:value
		{min}
		{max}
		{step}
		type="range"
		class="h-2 w-full cursor-pointer appearance-none rounded-full bg-[color:color-mix(in_oklab,var(--color-boundary-text)_10%,transparent)] accent-[color:var(--color-boundary-primary)]"
	/>
</div>
