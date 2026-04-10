<script lang="ts">
	import type {
		SemanticIngressBinding,
		SemanticIngressNumericSample,
		SemanticIngressSnapshot
	} from '$lib/server/connectors/semantic-ingress/types';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';
	import { semanticRuntimeState } from '$lib/stores/semantic-runtime';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	let { assetId, class: className = '' }: Props = $props();

	let samplesByIngress = $state<Record<string, SemanticIngressNumericSample[]>>({});
	const runtimeAsset = $derived.by(
		() =>
			$semanticRuntimeState.byAsset[assetId] ?? {
				overlay: null,
				overlayStatus: 'unknown',
				ingressBindings: [],
				selectedGroupId: null
			}
	);
	const bindings = $derived.by(() => runtimeAsset.ingressBindings ?? []);
	const selectedGroupId = $derived(runtimeAsset.selectedGroupId);

	const MAX_POINTS = 60;
	const CHART_WIDTH = 248;
	const CHART_HEIGHT = 72;

	function displayTargetLabel(binding: SemanticIngressBinding): string {
		return binding.targetLabel?.trim() || binding.targetId;
	}

	function trimSamples(samples: SemanticIngressNumericSample[]): SemanticIngressNumericSample[] {
		return samples
			.slice()
			.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
			.slice(-MAX_POINTS);
	}

	function getPrimaryBinding(): SemanticIngressBinding | null {
		return (
			bindings
				.slice()
				.sort((left, right) =>
					left.transport === right.transport ? left.ingressId.localeCompare(right.ingressId) : left.transport === 'rest_sse' ? -1 : 1
				)[0] ?? null
		);
	}

	function getSamples(binding: SemanticIngressBinding | null): SemanticIngressNumericSample[] {
		if (!binding) {
			return [];
		}

		return samplesByIngress[binding.ingressId] ?? [];
	}

	function getLatestSample(binding: SemanticIngressBinding | null): SemanticIngressNumericSample | null {
		const samples = getSamples(binding);
		return samples[samples.length - 1] ?? null;
	}

	function buildSparklinePath(samples: SemanticIngressNumericSample[]): string {
		if (samples.length === 0) {
			return '';
		}

		if (samples.length === 1) {
			const y = CHART_HEIGHT / 2;
			return `M 0 ${y} L ${CHART_WIDTH} ${y}`;
		}

		const values = samples.map((sample) => sample.value);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const range = max - min || 1;

		return samples
			.map((sample, index) => {
				const x = (index / (samples.length - 1)) * CHART_WIDTH;
				const normalized = (sample.value - min) / range;
				const y = CHART_HEIGHT - normalized * CHART_HEIGHT;
				return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
			})
			.join(' ');
	}

	function formatSampleValue(sample: SemanticIngressNumericSample | null): string {
		if (!sample) {
			return 'awaiting data';
		}

		const value = Number.isInteger(sample.value) ? `${sample.value}` : sample.value.toFixed(2);
		return sample.unit ? `${value} ${sample.unit}` : value;
	}

	$effect(() => {
		assetId;
		selectedGroupId;
		bindings;
		let cancelled = false;
		const eventSources = new Map<string, EventSource>();

		const closeEventSources = () => {
			for (const eventSource of eventSources.values()) {
				eventSource.close();
			}
			eventSources.clear();
		};

		const connectBindingStream = (binding: SemanticIngressBinding): void => {
			const eventPath = binding.ssePath ?? binding.streamPath;
			if (!eventPath || eventSources.has(binding.ingressId)) {
				return;
			}

			const eventSource = new EventSource(eventPath);
			eventSource.addEventListener('semantic-ingress-snapshot', (event) => {
				if (cancelled) {
					return;
				}

				try {
					const payload = JSON.parse((event as MessageEvent<string>).data) as SemanticIngressSnapshot;
					samplesByIngress = {
						...samplesByIngress,
						[binding.ingressId]: trimSamples(payload.samples ?? [])
					};
				} catch {
					// Ignore malformed event payloads and keep the stream alive.
				}
			});
			eventSource.addEventListener('semantic-ingress-sample', (event) => {
				if (cancelled) {
					return;
				}

				try {
					const payload = JSON.parse(
						(event as MessageEvent<string>).data
					) as SemanticIngressNumericSample;
					samplesByIngress = {
						...samplesByIngress,
						[binding.ingressId]: trimSamples([
							...(samplesByIngress[binding.ingressId] ?? []),
							payload
						])
					};
				} catch {
					// Ignore malformed event payloads and keep the stream alive.
				}
			});
			eventSource.onerror = () => {
				eventSource.close();
				eventSources.delete(binding.ingressId);
			};
			eventSources.set(binding.ingressId, eventSource);
		};

		for (const binding of bindings) {
			connectBindingStream(binding);
		}

		for (const [ingressId, eventSource] of eventSources.entries()) {
			if (bindings.some((binding) => binding.ingressId === ingressId)) {
				continue;
			}

			eventSource.close();
			eventSources.delete(ingressId);
		}

		return () => {
			cancelled = true;
			closeEventSources();
		};
	});
</script>

{#if getPrimaryBinding()}
	{@const binding = getPrimaryBinding()}
	{#if binding}
		<aside
			class={[
				'w-[18rem] max-w-[72vw] rounded-[0.95rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_8%,transparent)] bg-[color:color-mix(in_oklab,var(--color-boundary-background)_64%,transparent)] px-3 py-3 text-boundary-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_5%,transparent),0_10px_24px_color-mix(in_oklab,var(--color-boundary-background)_18%,black)] backdrop-blur-xl',
				className
			]}
			aria-label="Semantic ingress live window"
		>
			<div class="flex items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="font-mono text-[0.54rem] tracking-[0.14em] text-boundary-text/34">
						live window
					</p>
					<p class="truncate text-[0.76rem] text-boundary-text/84">{displayTargetLabel(binding)}</p>
				</div>
				<p class="font-mono text-[0.62rem] text-boundary-text/72">
					{formatSampleValue(getLatestSample(binding))}
				</p>
			</div>
			<svg
				viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
				class="mt-2 h-[4.5rem] w-full overflow-visible"
				aria-label={`${displayTargetLabel(binding)} telemetry window`}
			>
				<path
					d={`M 0 ${CHART_HEIGHT - 1} L ${CHART_WIDTH} ${CHART_HEIGHT - 1}`}
					stroke="color-mix(in oklab, var(--color-boundary-text) 14%, transparent)"
					stroke-width="1"
					fill="none"
				/>
				{#if getSamples(binding).length > 0}
					<path
						d={buildSparklinePath(getSamples(binding))}
						stroke="var(--color-boundary-secondary)"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						fill="none"
					/>
				{/if}
			</svg>
		</aside>
	{/if}
{/if}
