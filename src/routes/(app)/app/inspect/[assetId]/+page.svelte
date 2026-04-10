<script lang="ts">
	import RequestGate from '$lib/components/ui/request-gate.svelte';
	import InspectionViewport from '$lib/components/threlte/inspection-viewport.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const assetUrl = $derived(`/api/vehicle-assets/${data.assetId}/download`);
</script>

<svelte:head>
	<title>mobisim</title>
</svelte:head>

<div
	class="relative flex min-h-0 flex-1 overflow-visible px-0 pt-2 pb-0 sm:pt-3 sm:pb-0 lg:pt-4 lg:pb-0"
>
	<div class="flex min-h-0 flex-1 overflow-visible">
		{#key data.assetId}
			<InspectionViewport assetId={data.assetId} {assetUrl} class="min-h-0 flex-1" />
		{/key}
	</div>
	<RequestGate />
</div>
