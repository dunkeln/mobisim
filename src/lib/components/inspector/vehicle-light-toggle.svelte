<script lang="ts">
	import Flashlight from 'lucide-svelte/icons/flashlight';
	import FlashlightOff from 'lucide-svelte/icons/flashlight-off';
	import { toast } from '$lib/components/ui/sonner';
	import RestRequestToast from '$lib/components/ui/rest-request-toast.svelte';
	import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
	import type { VehicleSemanticOverlay } from '$lib/server/connectors/vehicle-semantic-overlay/types';
	import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

	type LightingSemanticCategory = 'front_lighting' | 'rear_lighting';

	const HEADLIGHT_ON_EMISSIVE: readonly [number, number, number] = [1, 0.95, 0.82];
	const TAILLIGHT_ON_EMISSIVE: readonly [number, number, number] = [1, 0.14, 0.1];

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
		categories?: LightingSemanticCategory[];
	};

	type IntentResponse = {
		operations?: VehicleInspectionPatchOperation[];
		summary?: string;
	};

	type LightingToggleConfig = {
		label: string;
		category: LightingSemanticCategory;
		onRequest: string;
		offRequest: string;
		enableValue: readonly [number, number, number];
	};

	const LIGHTING_TOGGLE_CONFIG: LightingToggleConfig[] = [
		{
			label: 'Headlights',
			category: 'front_lighting',
			onRequest: 'turn on the front lights',
			offRequest: 'turn off the front lights',
			enableValue: HEADLIGHT_ON_EMISSIVE
		},
		{
			label: 'Rear Lights',
			category: 'rear_lighting',
			onRequest: 'turn on the rear lights',
			offRequest: 'turn off the rear lights',
			enableValue: TAILLIGHT_ON_EMISSIVE
		}
	];

	let {
		assetId,
		class: className = '',
		categories = ['front_lighting', 'rear_lighting']
	}: Props = $props();
	let pendingCategory = $state<LightingSemanticCategory | null>(null);
	let learnedMaterialIdsByCategory = $state<Partial<Record<LightingSemanticCategory, string[]>>>({});

	const visibleConfigs = $derived(
		LIGHTING_TOGGLE_CONFIG.filter((config) => categories.includes(config.category))
	);

	function arraysMatch(
		left: readonly [number, number, number],
		right: readonly [number, number, number]
	): boolean {
		return left.every((value, index) => Math.abs(value - right[index]!) < 0.0001);
	}

	function resolveLightingMaterialIds(
		overlay: VehicleSemanticOverlay | null | undefined,
		category: LightingSemanticCategory,
		learnedMaterialIds: string[]
	): string[] {
		const overlayMaterialIds = !overlay
			? []
			: (() => {
					const group = overlay.acceptedGroups.find((entry) => entry.category === category);
					if (!group) {
						return [];
					}

					return Array.from(
						new Set([
							...group.materialIds,
							...overlay.acceptedParts
								.filter(
									(part) =>
										part.category === 'light' &&
										part.region === (category === 'front_lighting' ? 'front' : 'rear')
								)
								.flatMap((part) => part.materialIds)
						])
					).sort((left, right) => left.localeCompare(right));
				})();

		return Array.from(new Set([...overlayMaterialIds, ...learnedMaterialIds])).sort((left, right) =>
			left.localeCompare(right)
		);
	}

	function isLightingEnabled(
		operations: VehicleInspectionPatchOperation[],
		materialIds: string[],
		enableValue: readonly [number, number, number]
	): boolean {
		return operations.some(
			(operation) =>
				operation.targetType === 'material' &&
				operation.op === 'set_emissive_factor' &&
				Array.isArray(operation.value) &&
				operation.value.length === 3 &&
				(materialIds.length === 0 || materialIds.includes(operation.targetId)) &&
				arraysMatch(operation.value as [number, number, number], enableValue)
		);
	}

	async function toggleLighting(config: LightingToggleConfig, enabled: boolean): Promise<void> {
		if (pendingCategory !== null) {
			return;
		}

		pendingCategory = config.category;
		const requestPath = `/api/vehicle-assets/${assetId}/intent?source=lighting-toggle&target=${config.category}`;
		toast.custom(RestRequestToast, {
			componentProps: {
				method: 'POST',
				path: requestPath
			},
			duration: 1400
		});

		try {
			const response = await fetch(requestPath, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					request: enabled ? config.offRequest : config.onRequest
				})
			});

			if (!response.ok) {
				const reason = await response.text().catch(() => '');
				throw new Error(
					reason.trim().length > 0 ? reason : `Lighting request failed with HTTP ${response.status}`
				);
			}

			const payload = (await response.json()) as IntentResponse;
			const operations = Array.isArray(payload.operations) ? payload.operations : [];
			if (operations.length === 0) {
				throw new Error(payload.summary?.trim() || 'No lighting operations were returned.');
			}

			const returnedMaterialIds = operations
				.filter(
					(operation) =>
						operation.targetType === 'material' && operation.op === 'set_emissive_factor'
				)
				.map((operation) => operation.targetId);
			if (returnedMaterialIds.length > 0) {
				learnedMaterialIdsByCategory = {
					...learnedMaterialIdsByCategory,
					[config.category]: Array.from(new Set(returnedMaterialIds)).sort((left, right) =>
						left.localeCompare(right)
					)
				};
			}

			vehiclePatchState.apply(assetId, {
				kind: 'operations',
				intentLabel:
					payload.summary?.trim() ||
					`${enabled ? 'disable' : 'enable'} ${config.label.toLowerCase()}`,
				operations
			});
		} catch (error) {
			toast.error('Lighting toggle failed', {
				description:
					error instanceof Error ? error.message : 'The light state could not be updated.'
			});
		} finally {
			if (pendingCategory === config.category) {
				pendingCategory = null;
			}
		}
	}
</script>

<div class={['vehicle-light-toggle pointer-events-auto relative z-30', className]}>
	{#each visibleConfigs as config (config.category)}
		{@const runtimeAsset = $semanticRuntimeState.byAsset[assetId]}
		{@const materialIds = resolveLightingMaterialIds(
			runtimeAsset?.overlay ?? null,
			config.category,
			learnedMaterialIdsByCategory[config.category] ?? []
		)}
		{@const patchState = $vehiclePatchState.assetId === assetId ? $vehiclePatchState : null}
		{@const enabled = isLightingEnabled(
			patchState?.presentation.materialOperations ?? [],
			materialIds,
			config.enableValue
		)}
		{@const isPending = pendingCategory === config.category}
		<button
			type="button"
			class={[
				'vehicle-light-toggle__button pointer-events-auto',
				config.category === 'front_lighting'
					? 'vehicle-light-toggle__button--front'
					: 'vehicle-light-toggle__button--rear',
				enabled && 'vehicle-light-toggle__button--active',
				isPending && 'vehicle-light-toggle__button--pending'
			]}
			aria-pressed={enabled}
			aria-busy={isPending}
			disabled={isPending}
			title={config.label}
			onclick={() => {
				void toggleLighting(config, enabled);
			}}
		>
			<span class="sr-only">{config.label}</span>
			{#if enabled}
				<Flashlight class="vehicle-light-toggle__icon" size={14} aria-hidden="true" />
			{:else}
				<FlashlightOff class="vehicle-light-toggle__icon" size={14} aria-hidden="true" />
			{/if}
		</button>
	{/each}
</div>

<style>
	.vehicle-light-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.vehicle-light-toggle__button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		min-width: unset;
		padding: 0;
		border-radius: 9999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 12%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 4%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2.5%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.75%, transparent)
			);
		color: color-mix(in oklab, var(--boundary-text) 46%, transparent);
		user-select: none;
		touch-action: manipulation;
		cursor: pointer;
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 6%, transparent),
			0 10px 24px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		backdrop-filter: blur(16px) saturate(106%);
		-webkit-backdrop-filter: blur(16px) saturate(106%);
		transition:
			background 180ms ease,
			border-color 180ms ease,
			box-shadow 180ms ease,
			color 180ms ease;
	}

	.vehicle-light-toggle__button:hover:not(:disabled) {
		color: color-mix(in oklab, var(--boundary-text) 86%, transparent);
		border-color: color-mix(in srgb, var(--color-boundary-text) 16%, transparent);
		background:
			radial-gradient(
				44% 38% at 24% 18%,
				color-mix(in srgb, var(--color-boundary-secondary) 10%, transparent),
				transparent 72%
			),
			radial-gradient(
				34% 32% at 76% 30%,
				color-mix(in srgb, var(--color-boundary-secondary) 7%, transparent),
				transparent 78%
			),
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 5%, transparent), transparent 26%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-secondary) 6%, transparent),
				color-mix(in srgb, var(--color-boundary-secondary) 2%, transparent) 55%,
				color-mix(in srgb, var(--color-boundary-text) 1.25%, transparent)
			);
	}

	.vehicle-light-toggle__button:disabled {
		cursor: default;
		opacity: 0.38;
	}

	.vehicle-light-toggle__button--active {
		border-color: color-mix(in srgb, var(--color-boundary-text) 12%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 4%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-secondary) 3%, transparent),
				color-mix(in srgb, var(--color-boundary-secondary) 1%, transparent) 55%,
				color-mix(in srgb, var(--color-boundary-text) 0.75%, transparent)
			);
		color: var(--boundary-secondary);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 6%, transparent),
			inset 0 0 20px color-mix(in srgb, var(--color-boundary-secondary) 5%, transparent),
			0 10px 24px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
	}

	.vehicle-light-toggle__button--active:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-boundary-text) 16%, transparent);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 7%, transparent),
			inset 0 0 20px color-mix(in srgb, var(--color-boundary-secondary) 5%, transparent),
			0 12px 28px color-mix(in srgb, var(--color-boundary-background) 14%, transparent);
	}

	.vehicle-light-toggle__button--pending {
		border-color: color-mix(in oklab, var(--boundary-tertiary) 52%, rgba(255,255,255,0.3));
		color: color-mix(in oklab, var(--boundary-tertiary) 60%, transparent);
	}

	.vehicle-light-toggle__icon {
		flex-shrink: 0;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
