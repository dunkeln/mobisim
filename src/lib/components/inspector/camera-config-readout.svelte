<script lang="ts">
	import type { CameraConfig } from '$lib/components/inspector/types';

	type Props = {
		config?: CameraConfig | null;
		class?: string;
	};

	let { config = null, class: className = '' }: Props = $props();

	function formatTuple(tuple: CameraConfig['position']): string {
		return tuple.map((value) => value.toFixed(2)).join(', ');
	}
</script>

<section
	class={[
		'w-[min(18rem,100%)] rounded-[1.5rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_10%,transparent)]',
		'bg-[color:color-mix(in_oklab,var(--color-boundary-background)_78%,black)] px-4 py-4',
		'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_4%,transparent),0_14px_28px_color-mix(in_oklab,var(--color-boundary-background)_28%,black)]',
		'backdrop-blur',
		className
	]}
>
	<div class="grid gap-3">
		<div class="flex items-center justify-between gap-3">
			<p class="text-[0.68rem] font-medium tracking-[0.18em] text-shell-subtle uppercase">
				Camera
			</p>
			{#if config}
				<span class="text-xs text-boundary-text/72">{config.distance.toFixed(2)}m</span>
			{/if}
		</div>

		{#if config}
			<div class="grid gap-2 text-xs text-boundary-text/72">
				<div class="grid gap-1">
					<p class="tracking-[0.16em] text-shell-subtle uppercase">Position</p>
					<p>{formatTuple(config.position)}</p>
				</div>
				<div class="grid gap-1">
					<p class="tracking-[0.16em] text-shell-subtle uppercase">Target</p>
					<p>{formatTuple(config.target)}</p>
				</div>
				<div class="grid gap-1">
					<p class="tracking-[0.16em] text-shell-subtle uppercase">FOV</p>
					<p>{config.fov.toFixed(1)} deg</p>
				</div>
			</div>
		{:else}
			<p class="text-xs text-shell-subtle">Waiting for viewport camera sync.</p>
		{/if}
	</div>
</section>
