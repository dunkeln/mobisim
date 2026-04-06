<script lang="ts">
	import type { CameraConfig } from '$lib/components/inspector/types';
	import Axis3D from 'lucide-svelte/icons/axis-3d';

	type Props = {
		config?: CameraConfig | null;
		moving?: boolean;
		class?: string;
	};

	let { config = null, moving = false, class: className = '' }: Props = $props();
</script>

<section
	class={[
		'flex min-h-9 w-auto items-center rounded-4xl border border-[color:color-mix(in_oklab,var(--color-boundary-text)_10%,transparent)] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_54%,transparent)] px-3.5 py-1.5 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_9%,transparent),0_10px_24px_color-mix(in_oklab,var(--color-boundary-background)_24%,black)] backdrop-blur-xl',
		className
	]}
>
	{#if config}
		<div class="flex flex-wrap items-center gap-2 text-[0.68rem]">
			<Axis3D class="h-4 w-4 shrink-0 text-boundary-text/58" />
			<span class={moving ? 'text-boundary-secondary' : 'text-boundary-text/72'}>
				{config.azimuthDegrees.toFixed(1)}&deg &middot; {config.elevationDegrees.toFixed(1)}&deg
				&middot; {config.distance.toFixed(2)} units
			</span>
		</div>
	{:else}
		<p class="text-xs text-shell-subtle">Waiting for viewport camera sync.</p>
	{/if}
</section>
