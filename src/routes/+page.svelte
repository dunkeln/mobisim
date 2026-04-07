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
	class="relative flex min-h-0 flex-1 overflow-visible px-5 py-5 sm:px-7 sm:py-7 lg:px-9 lg:py-9"
>
	<div class="flex min-h-0 flex-1 overflow-visible">
		{#key assetId}
			<InspectionViewport {assetId} {assetUrl} class="min-h-0 flex-1" />
		{/key}
	</div>
</div>
