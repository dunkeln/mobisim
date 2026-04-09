<script lang="ts">
	import { Copy, Plug } from 'lucide-svelte';
	import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
	import type { SemanticIngressBinding } from '$lib/server/connectors/semantic-ingress/types';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';
	import { toast } from '$lib/components/ui/sonner';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	let { assetId, class: className = '' }: Props = $props();
	const bindings = $derived.by(
		() => $semanticRuntimeState.byAsset[assetId]?.ingressBindings ?? ([] as SemanticIngressBinding[])
	);

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

	$effect(() => {
		assetId;
		let cancelled = false;
		let nextPoll: ReturnType<typeof setTimeout> | undefined;

		const loadBindings = async (): Promise<void> => {
			try {
				const response = await fetch(`/api/vehicle-assets/${assetId}/semantic-ingress`);
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

{#if bindings.length > 0}
	<aside
		class={[
			'w-[18rem] max-w-[72vw] rounded-[0.95rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_8%,transparent)] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_64%,transparent)] px-3 py-3 text-boundary-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_5%,transparent),0_10px_24px_color-mix(in_oklab,var(--color-boundary-background)_18%,black)] backdrop-blur-xl',
			className
		]}
		aria-label="Semantic ingress endpoints"
	>
		<div class="flex flex-col gap-3">
			{#each bindings as binding (binding.ingressId)}
				<section class="rounded-[0.8rem] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_12%,transparent)] px-2.5 py-2.5">
					<div class="flex items-center justify-between gap-3">
						<div class="flex min-w-0 items-center gap-2">
							<Plug class="h-3.5 w-3.5 shrink-0 text-boundary-text/56" aria-hidden="true" />
							<p class="truncate text-[0.78rem] text-boundary-text/88">
								{displayTargetLabel(binding)}
							</p>
						</div>
						<span class="font-mono text-[0.56rem] tracking-[0.16em] text-boundary-text/46">
							{binding.transport === 'rest_sse' ? 'live' : 'stream'}
						</span>
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
