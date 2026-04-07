<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { scale } from 'svelte/transition';
	import { VEHICLE_CATALOG_LIST, type VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		class?: string;
	};

	let { class: className = '' }: Props = $props();
	let open = $state(false);

	const selectedId = $derived.by(() => {
		const currentAsset = page.url.searchParams.get('asset');
		return (
			VEHICLE_CATALOG_LIST.find((vehicle) => vehicle.id === currentAsset)?.id ??
			VEHICLE_CATALOG_LIST[0]?.id ??
			''
		);
	});
	const selectedVehicle = $derived(
		VEHICLE_CATALOG_LIST.find((vehicle) => vehicle.id === selectedId) ?? VEHICLE_CATALOG_LIST[0]
	);

	async function selectVehicle(vehicleId: VehicleAssetId): Promise<void> {
		const nextUrl = new URL(page.url);
		nextUrl.searchParams.set('asset', vehicleId);
		open = false;
		const nextRoute = `${nextUrl.pathname}${nextUrl.search}` as `/?${string}`;

		await goto(resolve(nextRoute), {
			keepFocus: true,
			noScroll: true,
			invalidateAll: true
		});
	}
</script>

<div class={['relative', className]}>
	<button
		type="button"
		class="inline-flex h-9 max-w-[22rem] items-center gap-2 rounded-[0.7rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_10%,transparent)] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_54%,transparent)] px-3.5 text-sm text-boundary-text/82 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_9%,transparent),0_10px_24px_color-mix(in_oklab,var(--color-boundary-background)_24%,black)] backdrop-blur-xl"
		aria-expanded={open}
		aria-haspopup="menu"
		onclick={() => (open = !open)}
	>
		<span class="truncate">{selectedVehicle?.displayName ?? 'Vehicle catalog'}</span>
		<span
			class={['text-[0.68rem] text-shell-subtle transition-transform', open && 'rotate-180']}
			aria-hidden="true"
		>
			▾
		</span>
	</button>

	{#if open}
		<div
			class="absolute top-[calc(100%+0.5rem)] left-0 z-30 min-w-64 origin-top-left overflow-hidden rounded-[0.7rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_10%,transparent)] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_90%,black)] p-1 shadow-[0_24px_60px_color-mix(in_oklab,var(--color-boundary-background)_34%,black)] backdrop-blur-xl"
			transition:scale={{ duration: 220, start: 0.96, opacity: 0.86 }}
		>
			{#each VEHICLE_CATALOG_LIST as vehicle (vehicle.id)}
				<button
					type="button"
					class={[
						'relative flex w-full items-center overflow-hidden rounded-[0.65rem] px-3 py-2 text-left text-sm transition-[color,transform] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]',
						vehicle.id === selectedVehicle?.id
							? 'text-boundary-text'
							: 'text-boundary-text/72 hover:-translate-y-px hover:text-boundary-text'
					]}
					onclick={() => selectVehicle(vehicle.id)}
				>
					{#if vehicle.id === selectedVehicle?.id}
						<div
							class="pointer-events-none absolute inset-0 rounded-[0.65rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_10%,transparent)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-boundary-text)_10%,transparent),color-mix(in_oklab,var(--color-boundary-text)_5%,transparent))] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_10%,transparent),0_10px_24px_color-mix(in_oklab,var(--color-boundary-background)_22%,black)]"
							transition:scale={{ duration: 240, start: 0.94, opacity: 0.72 }}
						></div>
					{/if}
					<span class="relative z-10">{vehicle.displayName}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
