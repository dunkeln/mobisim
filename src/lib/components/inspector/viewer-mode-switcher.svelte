<script lang="ts">
	import { get } from 'svelte/store';
	import RestRequestToast from '$lib/components/ui/rest-request-toast.svelte';
	import { toast } from '$lib/components/ui/sonner';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	type ViewerMode = 'pre_render' | 'xray' | 'uv_debug' | 'wireframe';
	type ViewerIntentResponse = {
		operations?: VehicleInspectionPatchOperation[];
		summary?: string;
	};

	const VIEWER_MODE_CONFIG: Record<
		ViewerMode,
		{
			label: string;
			targetId: VehicleInspectionPatchOperation['targetId'];
		}
	> = {
		pre_render: {
			label: 'Original',
			targetId: 'postprocess'
		},
		xray: {
			label: 'X-ray',
			targetId: 'xray'
		},
		uv_debug: {
			label: 'UV debug',
			targetId: 'uv_debug'
		},
		wireframe: {
			label: 'Wireframe',
			targetId: 'wireframe'
		}
	} as const;

	const VIEWER_MODES: ViewerMode[] = ['pre_render', 'xray', 'uv_debug', 'wireframe'];

	let { assetId, class: className = '' }: Props = $props();
	let pendingMode = $state<ViewerMode | null>(null);

	const activeViewerMode = $derived.by(() => {
		const patchState = $vehiclePatchState;
		if (patchState.assetId !== assetId) {
			return 'pre_render' as const;
		}

		const enabledViewerTargets = new Set(
			patchState.presentation.viewerOperations
				.filter((operation) => operation.op === 'set_enabled' && operation.value === true)
				.map((operation) => operation.targetId)
		);

		if (enabledViewerTargets.has('wireframe')) {
			return 'wireframe' as const;
		}

		if (enabledViewerTargets.has('xray')) {
			return 'xray' as const;
		}

		if (enabledViewerTargets.has('uv_debug')) {
			return 'uv_debug' as const;
		}

		return 'pre_render' as const;
	});

	function buildViewerModeRequest(mode: ViewerMode): string {
		if (mode === 'pre_render') {
			return 'disable wireframe xray uv debug postprocess';
		}

		return `enable ${VIEWER_MODE_CONFIG[mode].label.toLowerCase()}`;
	}

	async function selectViewerMode(mode: ViewerMode): Promise<void> {
		const patchState = get(vehiclePatchState);
		if (patchState.assetId !== assetId && patchState.assetId !== null) {
			return;
		}

		const intentLabel = `set ${VIEWER_MODE_CONFIG[mode].label.toLowerCase()} mode`;
		const requestPath = `/api/vehicle-assets/${assetId}/intent?source=viewer-mode-switcher&target=${VIEWER_MODE_CONFIG[mode].targetId}`;
		pendingMode = mode;
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
					request: buildViewerModeRequest(mode)
				})
			});

			if (!response.ok) {
				throw new Error(`Viewer mode request failed with HTTP ${response.status}`);
			}

			const payload = (await response.json()) as ViewerIntentResponse;
			const operations = Array.isArray(payload.operations) ? payload.operations : [];
			if (operations.length === 0) {
				throw new Error('Viewer mode response did not return any patch operations.');
			}

			const nextPatchState = get(vehiclePatchState);
			if (nextPatchState.assetId !== assetId && nextPatchState.assetId !== null) {
				return;
			}

			vehiclePatchState.apply(assetId, {
				kind: 'operations',
				intentLabel: payload.summary?.trim() || intentLabel,
				operations
			});
		} catch {
			// Fail closed. The switch should reflect only confirmed shared state.
		} finally {
			if (pendingMode === mode) {
				pendingMode = null;
			}
		}
	}
</script>

<div class={['viewer-mode-switcher pointer-events-auto relative z-30', className]}>
	{#each VIEWER_MODES as mode (mode)}
		{@const isActive = activeViewerMode === mode}
		<button
			type="button"
			class={[
				'viewer-mode-switcher__button pointer-events-auto',
				isActive && 'viewer-mode-switcher__button--active',
				pendingMode === mode && 'viewer-mode-switcher__button--pending'
			]}
			aria-pressed={isActive}
			aria-busy={pendingMode === mode}
			disabled={pendingMode !== null}
			title={VIEWER_MODE_CONFIG[mode].label}
			onclick={() => {
				void selectViewerMode(mode);
			}}
		>
			<span class="viewer-mode-switcher__label">{VIEWER_MODE_CONFIG[mode].label}</span>
		</button>
	{/each}
</div>

<style>
	.viewer-mode-switcher {
		display: inline-flex;
		align-items: center;
		gap: 0.08rem;
		padding: 0;
		background: transparent;
		border: 0;
	}

	.viewer-mode-switcher__button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 1.9rem;
		padding: 0 0.64rem;
		border-radius: 9999px;
		border: 0;
		background: transparent;
		color: color-mix(in oklab, var(--boundary-text) 34%, transparent);
		user-select: none;
		touch-action: manipulation;
		cursor: pointer;
		transition:
			color 140ms ease,
			background-color 140ms ease;
	}

	.viewer-mode-switcher__button:hover:not(:disabled) {
		color: color-mix(in oklab, var(--boundary-text) 68%, transparent);
		background: color-mix(in oklab, white 5%, transparent);
	}

	.viewer-mode-switcher__button:disabled {
		cursor: wait;
	}

	.viewer-mode-switcher__button--active {
		color: var(--boundary-text);
		background: color-mix(in oklab, white 6%, transparent);
	}

	.viewer-mode-switcher__button--pending {
		color: color-mix(in oklab, var(--boundary-tertiary) 72%, transparent);
	}

	.viewer-mode-switcher__label {
		font-size: 0.68rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}
</style>
