<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '$lib/components/ui/sonner';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import { resolveVehicleAssetId } from '$lib/vehicles/catalog';

	const assetId = $derived.by(() => resolveVehicleAssetId(page.url.searchParams.get('asset')));
	const patchState = $derived($vehiclePatchState);
	const historyEntries = $derived.by(() => {
		if (!assetId || patchState.assetId !== assetId || patchState.past.length === 0) {
			return [];
		}

		return patchState.past.slice(-6).map((entry, offset, entries) => ({
			index: patchState.past.length - entries.length + offset,
			label: entry.intentLabel?.trim() || 'vehicle change'
		}));
	});

	function undoEntry(historyIndex: number, label: string): void {
		const revertedLabel = vehiclePatchState.undoEntry(assetId, historyIndex);
		if (!revertedLabel) {
			toast.error('Unable to undo change', {
				description: 'That history entry is no longer available.'
			});
			return;
		}

		toast.success('Change reverted', {
			description: `Undid ${label}.`
		});
	}
</script>

{#if historyEntries.length > 0}
	<div class="history-shell">
		<div class="history-scroll">
			{#each historyEntries as entry (entry.index)}
				<button
					type="button"
					class="history-chip"
					onclick={() => undoEntry(entry.index, entry.label)}
					aria-label={`Undo ${entry.label}`}
					title={`Undo ${entry.label}`}
				>
					<span class="history-chip-text">{entry.label}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.history-shell {
		position: relative;
		z-index: 1;
		display: inline-flex;
		max-width: min(34rem, calc(100vw - 11rem));
		align-items: center;
		padding: 0.5rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 12%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 4%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2.5%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.75%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 6%, transparent),
			0 10px 24px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		backdrop-filter: blur(16px) saturate(106%);
		-webkit-backdrop-filter: blur(16px) saturate(106%);
		isolation: isolate;
	}

	.history-shell::before {
		content: '';
		position: absolute;
		inset: 1px;
		border-radius: inherit;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 6%, transparent);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, white 4%, transparent),
				transparent 18%,
				transparent 100%
			),
			radial-gradient(
				110% 70% at 18% 0%,
				color-mix(in srgb, white 3%, transparent),
				transparent 24%
			);
		pointer-events: none;
	}

	.history-scroll {
		position: relative;
		z-index: 1;
		display: flex;
		max-width: 100%;
		gap: 0.45rem;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.history-scroll::-webkit-scrollbar {
		display: none;
	}

	.history-chip {
		display: inline-flex;
		min-width: 0;
		max-width: 11rem;
		align-items: center;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 10%, transparent);
		background: color-mix(in srgb, var(--color-boundary-background) 18%, transparent);
		color: color-mix(in srgb, var(--color-boundary-text) 82%, transparent);
		font-size: 0.68rem;
		line-height: 1;
		transition:
			border-color 140ms ease,
			background 140ms ease,
			color 140ms ease,
			transform 140ms ease;
	}

	.history-chip:hover,
	.history-chip:focus-visible {
		border-color: color-mix(in srgb, var(--color-boundary-secondary) 34%, transparent);
		background: color-mix(in srgb, var(--color-boundary-secondary) 10%, transparent);
		color: color-mix(in srgb, var(--color-boundary-text) 96%, transparent);
		transform: translateY(-1px);
	}

	.history-chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
