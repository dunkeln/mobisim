<script lang="ts">
	import RequestGate from '$lib/components/ui/request-gate.svelte';
	import InspectionViewport from '$lib/components/threlte/inspection-viewport.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const assetUrl = $derived(data.assetUrl);
	const assetOrigin = $derived.by(() => new URL(assetUrl).origin);
</script>

<svelte:head>
	<title>mobisim</title>
	<link rel="preconnect" href={assetOrigin} crossorigin="anonymous" />
	<link rel="dns-prefetch" href={assetOrigin} />
	<link rel="preload" href={assetUrl} as="fetch" type="model/gltf-binary" crossorigin="anonymous" />
</svelte:head>

<div
	class="relative flex min-h-0 flex-1 overflow-visible px-0 pt-0.5 pb-0 sm:pt-1 sm:pb-0 lg:pt-1.5 lg:pb-0"
>
	<div class="flex min-h-0 flex-1 overflow-visible">
		{#key data.assetId}
			<InspectionViewport assetId={data.assetId} {assetUrl} class="min-h-0 flex-1" />
		{/key}
	</div>
	<RequestGate />
</div>
