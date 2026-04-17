<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { scale } from 'svelte/transition';
	import { buildInspectionRoute, resolveInspectionAssetId } from '$lib/routes/inspection';
	import { VEHICLE_CATALOG_LIST, type VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		class?: string;
	};

	let { class: className = '' }: Props = $props();
	let open = $state(false);

	const selectedId = $derived(resolveInspectionAssetId(page.url));
	const selectedVehicle = $derived(
		VEHICLE_CATALOG_LIST.find((vehicle) => vehicle.id === selectedId) ?? VEHICLE_CATALOG_LIST[0]
	);

	async function selectVehicle(vehicleId: VehicleAssetId): Promise<void> {
		open = false;

		await goto(buildInspectionRoute(vehicleId, page.url.searchParams), {
			keepFocus: true,
			noScroll: true,
			invalidateAll: true
		});
	}
</script>

<div
	class={['canvas-control relative min-h-7', className]}
	style="--canvas-control-radius: 0.7rem;"
>
	<button
		type="button"
		class="canvas-control__button inline-flex h-7 min-w-[2.05rem] max-w-[17rem] items-center gap-1.25 px-2.75 text-[0.68rem] text-boundary-text/78"
		aria-expanded={open}
		aria-haspopup="menu"
		onclick={() => (open = !open)}
	>
		<span class="relative z-10 truncate">{selectedVehicle?.displayName ?? 'Vehicle catalog'}</span>
		<span
			class={[
				'relative z-10 text-[0.5rem] text-shell-subtle transition-transform',
				open && 'rotate-180'
			]}
			aria-hidden="true"
		>
			▾
		</span>
	</button>

	{#if open}
		<div
			class="canvas-glass-panel absolute top-[calc(100%+0.5rem)] left-0 z-30 min-w-56 origin-top-left overflow-hidden rounded-[1.1rem] p-1"
			transition:scale={{ duration: 220, start: 0.96, opacity: 0.86 }}
		>
			{#each VEHICLE_CATALOG_LIST as vehicle (vehicle.id)}
				<button
					type="button"
					class={[
						'relative flex w-full items-center overflow-hidden rounded-[0.9rem] px-3 py-2 text-left text-[0.8rem] transition-[background-color,color,transform] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]',
						vehicle.id === selectedVehicle?.id
							? 'bg-white/8 text-boundary-text'
							: 'text-boundary-text/68 hover:bg-white/3 hover:text-boundary-text'
					]}
					onclick={() => selectVehicle(vehicle.id)}
				>
					<span class="relative z-10">{vehicle.displayName}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
