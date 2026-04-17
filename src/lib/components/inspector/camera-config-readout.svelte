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

<div class={['flex h-7 items-center gap-1.5 px-3', className]}>
	{#if config}
		<Axis3D class="h-[14px] w-[14px] shrink-0 text-boundary-text/36" />
		<span class={['font-mono text-[0.58rem] tabular-nums tracking-[0.04em]', moving ? 'text-boundary-secondary' : 'text-boundary-text/48']}>
			{config.azimuthDegrees.toFixed(1)}&deg;&thinsp;&middot;&thinsp;{config.elevationDegrees.toFixed(1)}&deg;&thinsp;&middot;&thinsp;{config.distance.toFixed(2)}
		</span>
	{:else}
		<span class="font-mono text-[0.58rem] text-boundary-text/28">—</span>
	{/if}
</div>
