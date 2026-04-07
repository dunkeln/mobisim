<script lang="ts">
	import { page } from '$app/state';
	import InspectionViewport from '$lib/components/threlte/inspection-viewport.svelte';
	import { resolveVehicleAssetId } from '$lib/vehicles/catalog';

	const assetId = $derived.by(() => resolveVehicleAssetId(page.url.searchParams.get('asset')));
	const assetUrl = $derived(`/api/vehicle-assets/${assetId}/download`);
</script>

<svelte:head>
	<title>mobisim</title>
</svelte:head>

<div
	class="relative flex min-h-0 flex-1 overflow-visible px-0 pt-2 pb-1 sm:pt-3 sm:pb-1.5 lg:pt-4 lg:pb-2"
>
	<div class="flex min-h-0 flex-1 overflow-visible">
		{#key assetId}
			<InspectionViewport {assetId} {assetUrl} class="min-h-0 flex-1" />
		{/key}
	</div>
</div>
