<script lang="ts">
	import { Copy, Plug, Plus, Trash2 } from 'lucide-svelte';
	import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
	import { requestGate } from '$lib/stores/request-gate';
	import type { SemanticIngressBinding } from '$lib/server/connectors/semantic-ingress/types';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';
	import { toast } from '$lib/components/ui/sonner';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	let { assetId, class: className = '' }: Props = $props();
	const runtimeAsset = $derived.by(
		() =>
			$semanticRuntimeState.byAsset[assetId] ?? {
				overlay: null,
				overlayStatus: 'unknown',
				ingressBindings: [],
				selectedGroupId: null
			}
	);
	const bindings = $derived.by(
		() => runtimeAsset.ingressBindings ?? ([] as SemanticIngressBinding[])
	);
	const selectedGroupId = $derived(runtimeAsset.selectedGroupId);
	const selectedGroup = $derived.by(
		() => runtimeAsset.overlay?.acceptedGroups.find((group) => group.id === selectedGroupId) ?? null
	);
	const selectedGroupLabel = $derived(selectedGroup?.humanLabel ?? selectedGroupId ?? '');
	let mutationPending = $state(false);

	function displayTargetLabel(binding: SemanticIngressBinding): string {
		return binding.targetLabel?.trim() || binding.targetId;
	}

	function shortenEndpoint(value: string): string {
		const semanticIngressIndex = value.indexOf('/semantic-ingress/');
		if (semanticIngressIndex === -1) {
			return value;
		}

		return `...${value.slice(semanticIngressIndex)}`;
	}

	function listEndpoints(binding: SemanticIngressBinding): Array<{ kind: string; value: string }> {
		return [
			binding.restPath ? { kind: 'api', value: binding.restPath } : null,
			binding.ssePath ? { kind: 'feed', value: binding.ssePath } : null,
			binding.streamPath ? { kind: 'live', value: binding.streamPath } : null
		].filter((entry): entry is { kind: string; value: string } => entry !== null);
	}

	async function copyEndpoint(value: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			toast.success('Endpoint copied', {
				description: value
			});
		} catch {
			toast.error('Copy failed', {
				description: 'Clipboard access is unavailable in this browser session.'
			});
		}
	}

	async function requestApproval(requestVariable: string): Promise<boolean> {
		try {
			return await requestGate.requestApproval({ requestVariable });
		} finally {
			requestGate.reset();
		}
	}

	async function refreshBindings(): Promise<void> {
		if (!selectedGroupId) {
			semanticRuntimeState.applyAssetState(assetId, {
				ingressBindings: []
			});
			return;
		}

		const search = new URLSearchParams({
			targetType: 'semantic_group',
			targetId: selectedGroupId
		});
		const response = await fetch(`/api/vehicle-assets/${assetId}/semantic-ingress?${search.toString()}`);
		if (!response.ok) {
			throw new Error(`Semantic ingress request failed: ${response.status}`);
		}

		const payload = (await response.json()) as { bindings?: SemanticIngressBinding[] };
		semanticRuntimeState.applyAssetState(assetId, {
			ingressBindings: Array.isArray(payload.bindings) ? payload.bindings : []
		});
	}

	async function createIngress(transport: 'rest_sse' | 'stream'): Promise<void> {
		if (!selectedGroupId || !selectedGroupLabel || mutationPending) {
			return;
		}

		const existingBinding = bindings.find((binding) => binding.transport === transport);
		const approved = await requestApproval(
			existingBinding
				? `Replace ${transport === 'rest_sse' ? 'live' : 'stream'} ingress for ${selectedGroupLabel}?`
				: `Create ${transport === 'rest_sse' ? 'live' : 'stream'} ingress for ${selectedGroupLabel}?`
		);
		if (!approved) {
			toast.error('Ingress not changed', {
				description: 'Approval declined. No semantic ingress changes were applied.'
			});
			return;
		}

		mutationPending = true;
		try {
			const response = await fetch(`/api/vehicle-assets/${assetId}/semantic-ingress`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					targetType: 'semantic_group',
					targetId: selectedGroupId,
					targetLabel: selectedGroupLabel,
					transport
				})
			});
			const payload = (await response.json().catch(() => null)) as { error?: string } | null;
			if (!response.ok) {
				throw new Error(payload?.error || 'Unable to create semantic ingress.');
			}

			await refreshBindings();
			toast.success(existingBinding ? 'Ingress replaced' : 'Ingress created', {
				description: `${selectedGroupLabel} ${transport === 'rest_sse' ? 'live' : 'stream'} route is ready.`
			});
		} catch (error) {
			toast.error('Ingress failed', {
				description: error instanceof Error ? error.message : 'Unable to create semantic ingress.'
			});
		} finally {
			mutationPending = false;
		}
	}

	async function deleteIngress(binding: SemanticIngressBinding): Promise<void> {
		if (mutationPending) {
			return;
		}

		const approved = await requestApproval(
			`Delete ${binding.transport === 'rest_sse' ? 'live' : 'stream'} ingress for ${displayTargetLabel(binding)}?`
		);
		if (!approved) {
			toast.error('Ingress not deleted', {
				description: 'Approval declined. No semantic ingress changes were applied.'
			});
			return;
		}

		mutationPending = true;
		try {
			const response = await fetch(
				`/api/vehicle-assets/${assetId}/semantic-ingress/${binding.ingressId}`,
				{
					method: 'DELETE'
				}
			);
			const payload = (await response.json().catch(() => null)) as { error?: string } | null;
			if (!response.ok) {
				throw new Error(payload?.error || 'Unable to delete semantic ingress.');
			}

			await refreshBindings();
			toast.success('Ingress deleted', {
				description: `${displayTargetLabel(binding)} ${binding.transport === 'rest_sse' ? 'live' : 'stream'} route was removed.`
			});
		} catch (error) {
			toast.error('Ingress failed', {
				description: error instanceof Error ? error.message : 'Unable to delete semantic ingress.'
			});
		} finally {
			mutationPending = false;
		}
	}

	$effect(() => {
		assetId;
		selectedGroupId;
		let cancelled = false;
		let nextPoll: ReturnType<typeof setTimeout> | undefined;

		const loadBindings = async (): Promise<void> => {
			if (!selectedGroupId) {
				semanticRuntimeState.applyAssetState(assetId, {
					ingressBindings: []
				});
				return;
			}

			try {
				const search = new URLSearchParams({
					targetType: 'semantic_group',
					targetId: selectedGroupId
				});
				const response = await fetch(`/api/vehicle-assets/${assetId}/semantic-ingress?${search.toString()}`);
				if (!response.ok) {
					throw new Error(`Semantic ingress request failed: ${response.status}`);
				}

				const payload = (await response.json()) as { bindings?: SemanticIngressBinding[] };
				if (cancelled) {
					return;
				}

				semanticRuntimeState.applyAssetState(assetId, {
					ingressBindings: Array.isArray(payload.bindings) ? payload.bindings : []
				});
			} catch {
				if (cancelled) {
					return;
				}

				semanticRuntimeState.applyAssetState(assetId, {
					ingressBindings: []
				});
			} finally {
				if (cancelled) {
					return;
				}

				nextPoll = setTimeout(() => {
					void loadBindings();
				}, 3000);
			}
		};

		void loadBindings();

		return () => {
			cancelled = true;
			if (nextPoll) {
				clearTimeout(nextPoll);
			}
		};
	});
</script>

	{#if selectedGroupId}
	<aside
		class={[
			'w-[18rem] max-w-[72vw] rounded-[0.95rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_8%,transparent)] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_64%,transparent)] px-3 py-3 text-boundary-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_5%,transparent),0_10px_24px_color-mix(in_oklab,var(--color-boundary-background)_18%,black)] backdrop-blur-xl',
			className
		]}
		aria-label="Semantic ingress endpoints"
	>
		<div class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="font-mono text-[0.54rem] tracking-[0.14em] text-boundary-text/34">semantic ingress</p>
					<p class="truncate text-[0.76rem] text-boundary-text/84">{selectedGroupLabel}</p>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="inline-flex h-7 items-center gap-1 rounded-full border border-[color:color-mix(in_oklab,var(--color-boundary-text)_12%,transparent)] px-2.5 text-[0.58rem] font-mono tracking-[0.12em] text-boundary-text/72 transition hover:bg-boundary-text/[0.05] hover:text-boundary-text"
						disabled={mutationPending}
						onclick={() => void createIngress('rest_sse')}
					>
						<Plus class="h-3 w-3" />
						live
					</button>
					<button
						type="button"
						class="inline-flex h-7 items-center gap-1 rounded-full border border-[color:color-mix(in_oklab,var(--color-boundary-text)_12%,transparent)] px-2.5 text-[0.58rem] font-mono tracking-[0.12em] text-boundary-text/72 transition hover:bg-boundary-text/[0.05] hover:text-boundary-text"
						disabled={mutationPending}
						onclick={() => void createIngress('stream')}
					>
						<Plus class="h-3 w-3" />
						stream
					</button>
				</div>
			</div>
			{#if bindings.length === 0}
				<p class="rounded-[0.8rem] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_12%,transparent)] px-2.5 py-2 text-[0.68rem] leading-5 text-boundary-text/58">
					No ingress exists for this semantic group yet.
				</p>
			{/if}
			{#each bindings as binding (binding.ingressId)}
				<section class="rounded-[0.8rem] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_12%,transparent)] px-2.5 py-2.5">
					<div class="flex items-center justify-between gap-3">
						<div class="flex min-w-0 items-center gap-2">
							<Plug class="h-3.5 w-3.5 shrink-0 text-boundary-text/56" aria-hidden="true" />
							<p class="truncate text-[0.78rem] text-boundary-text/88">
								{displayTargetLabel(binding)}
							</p>
						</div>
						<div class="flex items-center gap-2">
							<span class="font-mono text-[0.56rem] tracking-[0.16em] text-boundary-text/46">
								{binding.transport === 'rest_sse' ? 'live' : 'stream'}
							</span>
							<button
								type="button"
								class="inline-flex h-6 w-6 items-center justify-center rounded-full text-boundary-text/48 transition hover:bg-boundary-text/[0.05] hover:text-boundary-text/88"
								aria-label={`Delete ${binding.transport === 'rest_sse' ? 'live' : 'stream'} ingress`}
								disabled={mutationPending}
								onclick={() => void deleteIngress(binding)}
							>
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
					<p class="mt-1 font-mono text-[0.54rem] tracking-[0.08em] text-boundary-text/34">
						{binding.targetId}
					</p>

					<div class="mt-2 flex flex-col gap-1.5">
						{#each listEndpoints(binding) as endpoint (`${binding.ingressId}-${endpoint.kind}`)}
							<div class="flex items-start gap-2 rounded-[0.7rem] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_14%,transparent)] px-2.5 py-2">
								<div class="min-w-0 flex-1">
									<p class="font-mono text-[0.5rem] tracking-[0.14em] text-boundary-text/30">
										{endpoint.kind}
									</p>
									<code class="mt-1 block break-words font-mono text-[0.63rem] leading-5 text-boundary-text/68">
										{shortenEndpoint(endpoint.value)}
									</code>
								</div>
								<button
									type="button"
									class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-boundary-text/48 transition hover:bg-boundary-text/[0.05] hover:text-boundary-text/88"
									aria-label={`Copy ${endpoint.kind} endpoint`}
									onclick={() => void copyEndpoint(endpoint.value)}
								>
									<Copy class="h-3.5 w-3.5" />
								</button>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	</aside>
{/if}
