<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { VEHICLE_CATALOG_LIST, type VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		class?: string;
	};

	let { class: className = '' }: Props = $props();
	let open = $state(false);
	const selectedId = $derived.by(() => {
		const currentAsset = page.url.searchParams.get('asset');
		return VEHICLE_CATALOG_LIST.find((vehicle) => vehicle.id === currentAsset)?.id
			?? VEHICLE_CATALOG_LIST[0]?.id
			?? '';
	});
	const selectedVehicle = $derived(
		VEHICLE_CATALOG_LIST.find((vehicle) => vehicle.id === selectedId) ?? VEHICLE_CATALOG_LIST[0]
	);

	async function selectVehicle(vehicleId: VehicleAssetId): Promise<void> {
		const nextUrl = new URL(page.url);
		nextUrl.searchParams.set('asset', vehicleId);
		open = false;
		await goto(nextUrl, {
			keepFocus: true,
			noScroll: true,
			invalidateAll: true
		});
	}
</script>

<div class={`relative ${className}`}>
	<button
		type="button"
		class="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/25 px-3 text-xs font-medium text-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-white/16 hover:bg-black/32"
		aria-expanded={open}
		aria-haspopup="menu"
		onclick={() => (open = !open)}
	>
		<span class="truncate">{selectedVehicle?.displayName ?? 'Vehicle catalog'}</span>
		<span class={`text-[0.65rem] text-white/42 transition ${open ? 'rotate-180' : ''}`}>▾</span>
	</button>

	{#if open}
		<div
			class="absolute top-[calc(100%+0.5rem)] right-0 z-20 min-w-56 overflow-hidden rounded-xl border border-white/10 bg-[#161616]/96 p-1 shadow-[0_24px_60px_rgba(0,0,0,0.46)] backdrop-blur-xl"
		>
			{#each VEHICLE_CATALOG_LIST as vehicle (vehicle.id)}
				<button
					type="button"
					class={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
						vehicle.id === selectedVehicle?.id
							? 'bg-white/[0.08] text-white'
							: 'text-white/70 hover:bg-white/[0.05] hover:text-white'
					}`}
					onclick={() => selectVehicle(vehicle.id)}
				>
					{vehicle.displayName}
				</button>
			{/each}
		</div>
	{/if}
</div>
