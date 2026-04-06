<script lang="ts">
	import InspectionViewport from '$lib/components/threlte/inspection-viewport.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>mobisim</title>
</svelte:head>

<div
	class="relative flex min-h-0 flex-1 overflow-visible px-5 py-5 sm:px-7 sm:py-7 lg:px-9 lg:py-9"
>
	<div class="flex min-h-0 flex-1 overflow-visible">
		<InspectionViewport
			assetId={data.vehicleAsset.id}
			assetUrl={data.vehicleAsset.downloadUrl}
			class="min-h-0 flex-1"
		/>
	</div>
</div>
