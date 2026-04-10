<script lang="ts">
	import { Highlighter } from 'lucide-svelte';
	import { toast } from '$lib/components/ui/sonner';
	import { chatRequestState } from '$lib/stores/chat-request-state';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
	import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
	import type {
		VehicleSemanticGroup,
		VehicleSemanticOverlay,
		VehicleSemanticOverlaySnapshot,
		VehicleSemanticPartUnit
	} from '$lib/server/connectors/vehicle-semantic-overlay/types';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	type SemanticGroupView = {
		id: string;
		label: string;
		category: string;
		nodes: Array<{
			id: string;
			label: string;
			highlightTargets: HighlightTargetRef[];
		}>;
		highlightTargets: HighlightTargetRef[];
	};

	type HighlightTargetRef = {
		targetId: string;
		targetType: 'node';
	};

	type HighlightScopeDescriptor = {
		targets: HighlightTargetRef[];
		scope: 'group' | 'node';
		groupId: string;
	};

	let { assetId, class: className = '' }: Props = $props();

	const NODE_HIGHLIGHT_FACTOR: [number, number, number, number] = [0.502, 0.808, 0.843, 1];
	let expandedGroupIds = $state<string[]>([]);
	let activeHighlightKey = $state<string | null>(null);
	let missingPromptedAssetIds = $state<VehicleAssetId[]>([]);
	const runtimeAsset = $derived.by(
		() =>
			$semanticRuntimeState.byAsset[assetId] ?? {
				overlay: null,
				overlayStatus: 'unknown',
				ingressBindings: []
			}
	);
	const overlay = $derived(runtimeAsset.overlay);
	const overlayStatus = $derived(runtimeAsset.overlayStatus);

	function partMatchesGroup(part: VehicleSemanticPartUnit, group: VehicleSemanticGroup): boolean {
		if (group.nodeIds.some((nodeId) => part.nodeIds.includes(nodeId))) {
			return true;
		}

		return false;
	}

	function buildGroupViews(currentOverlay: VehicleSemanticOverlay | null): SemanticGroupView[] {
		if (!currentOverlay) {
			return [];
		}

		return currentOverlay.acceptedGroups
			.map((group: VehicleSemanticGroup) => {
				const matchedParts = currentOverlay.acceptedParts.filter((part: VehicleSemanticPartUnit) =>
					partMatchesGroup(part, group)
				);
				const semanticNodes = [
					...group.nodeIds.map((nodeId: string) => ({
						id: nodeId,
						label:
							matchedParts.find((part: VehicleSemanticPartUnit) => part.nodeIds.includes(nodeId))
								?.humanLabel ?? nodeId,
						highlightTargets: [{ targetId: nodeId, targetType: 'node' as const }]
					})),
					...matchedParts
						.flatMap((part: VehicleSemanticPartUnit) =>
							part.nodeIds.map((nodeId: string) => ({
								id: nodeId,
								label: part.humanLabel,
								highlightTargets: [{ targetId: nodeId, targetType: 'node' as const }]
							}))
						)
				];
				const groupHighlightTargets = [
					...group.nodeIds.map((targetId: string) => ({ targetId, targetType: 'node' as const })),
					...matchedParts.flatMap((part: VehicleSemanticPartUnit) =>
						part.nodeIds.map((targetId: string) => ({ targetId, targetType: 'node' as const }))
					)
				];

				return {
					id: group.id,
					label: group.humanLabel,
					category: group.category,
					nodes: Array.from(new Map(semanticNodes.map((node) => [node.id, node])).values()),
					highlightTargets: Array.from(
						new Map(
							groupHighlightTargets.map((target) => [
								`${target.targetType}:${target.targetId}`,
								target
							])
						).values()
					)
				};
			})
			.filter((group: SemanticGroupView) => group.highlightTargets.length > 0)
			.sort((left: SemanticGroupView, right: SemanticGroupView) =>
				left.label.localeCompare(right.label)
			);
	}

	const semanticGroups = $derived(buildGroupViews(overlay));
	const visible = $derived(semanticGroups.length > 0);
	const activeHighlightTargetKeys = $derived(
		$vehiclePatchState.assetId === assetId
			? new Set(
					$vehiclePatchState.presentation.highlightOperations.map(
						(operation) => `${operation.targetType}:${operation.targetId}`
					)
			  )
			: new Set<string>()
	);
	const highlightDescriptorsByKey = $derived.by(() => {
		const descriptors = new Map<string, HighlightScopeDescriptor>();

		for (const group of semanticGroups) {
			descriptors.set(getGroupHighlightKey(group.id), {
				targets: group.highlightTargets,
				scope: 'group',
				groupId: group.id
			});

			for (const node of group.nodes) {
				descriptors.set(getNodeHighlightKey(group.id, node.id), {
					targets: node.highlightTargets,
					scope: 'node',
					groupId: group.id
				});
			}
		}

		return descriptors;
	});

	function getGroupHighlightKey(groupId: string): string {
		return `group:${groupId}`;
	}

	function getNodeHighlightKey(groupId: string, nodeId: string): string {
		return `node:${groupId}:${nodeId}`;
	}

	function toggleGroup(groupId: string): void {
		expandedGroupIds = expandedGroupIds.includes(groupId)
			? expandedGroupIds.filter((id) => id !== groupId)
			: [...expandedGroupIds, groupId];
	}

	function isExpanded(groupId: string): boolean {
		return expandedGroupIds.includes(groupId);
	}

	function getTargetKey(target: HighlightTargetRef): string {
		return `${target.targetType}:${target.targetId}`;
	}

	function isHighlighted(targets: HighlightTargetRef[]): boolean {
		if (targets.length === 0) {
			return false;
		}

		return targets.every((target) => activeHighlightTargetKeys.has(getTargetKey(target)));
	}

	function matchesExactActiveHighlight(targets: HighlightTargetRef[]): boolean {
		if (targets.length === 0 || activeHighlightTargetKeys.size === 0) {
			return false;
		}

		const uniqueTargetKeys = Array.from(new Set(targets.map((target) => getTargetKey(target))));
		if (uniqueTargetKeys.length !== activeHighlightTargetKeys.size) {
			return false;
		}

		return uniqueTargetKeys.every((targetKey) => activeHighlightTargetKeys.has(targetKey));
	}

	function isDirectlyHighlighted(highlightKey: string): boolean {
		const descriptor = highlightDescriptorsByKey.get(highlightKey);
		if (!descriptor || activeHighlightKey !== highlightKey) {
			return false;
		}

		return matchesExactActiveHighlight(descriptor.targets);
	}

	function isGroupDirectlyHighlighted(groupId: string): boolean {
		return isDirectlyHighlighted(getGroupHighlightKey(groupId));
	}

	function isNodeDirectlyHighlighted(groupId: string, nodeId: string): boolean {
		return isDirectlyHighlighted(getNodeHighlightKey(groupId, nodeId));
	}

	function isNodeDownstreamHighlighted(groupId: string): boolean {
		return isGroupDirectlyHighlighted(groupId);
	}

	function getHighlightLabel(
		label: string,
		highlightKey: string,
		targets: HighlightTargetRef[],
		downstream = false
	): string {
		if (isDirectlyHighlighted(highlightKey)) {
			return `Clear highlight for ${label}`;
		}

		if (downstream && isHighlighted(targets)) {
			return `Focus highlight on ${label}`;
		}

		return `Highlight ${label}`;
	}

	function toggleHighlight(
		highlightKey: string,
		targets: HighlightTargetRef[],
		label: string
	): void {
		if ($chatRequestState.pending) {
			toast.error('Highlight paused', {
				description: 'Wait for the active chat mutation to finish before changing semantic highlights.'
			});
			return;
		}

		if (targets.length === 0) {
			toast.error('Highlight failed', {
				description: 'No semantic targets were available for that item.'
			});
			return;
		}

		if (isDirectlyHighlighted(highlightKey)) {
			const didRestore = vehiclePatchState.apply(assetId, {
				kind: 'clear_highlight_targets',
				intentLabel: `clear ${label} highlight`,
				targetIds: targets.map((target) => target.targetId)
			});

			if (!didRestore) {
				toast.error('Highlight failed', {
					description: 'No matching highlight was active.'
				});
			}
			activeHighlightKey = null;
			return;
		}

		activeHighlightKey = highlightKey;
		vehiclePatchState.apply(assetId, {
			kind: 'set_highlights',
			intentLabel: `highlight ${label}`,
			operations: buildSemanticPanelHighlightOperations(targets, label)
		});
	}

	$effect(() => {
		assetId;
		activeHighlightKey = null;
	});

	$effect(() => {
		const descriptors = highlightDescriptorsByKey;
		const activeTargetCount = activeHighlightTargetKeys.size;
		const currentHighlightKey = activeHighlightKey;

		if (activeTargetCount === 0) {
			if (currentHighlightKey !== null) {
				activeHighlightKey = null;
			}
			return;
		}

		if (currentHighlightKey && isDirectlyHighlighted(currentHighlightKey)) {
			return;
		}

		const inferredHighlightKey =
			Array.from(descriptors.entries()).find(([, descriptor]) =>
				matchesExactActiveHighlight(descriptor.targets)
			)?.[0] ?? null;

		if (inferredHighlightKey !== currentHighlightKey) {
			activeHighlightKey = inferredHighlightKey;
		}
	});

	function buildSemanticPanelHighlightOperations(
		targets: HighlightTargetRef[],
		label: string
	): VehicleInspectionPatchOperation[] {
		return Array.from(
			new Map(targets.map((target) => [getTargetKey(target), target])).values()
		).map((target): VehicleInspectionPatchOperation => ({
			targetType: 'node',
			targetId: target.targetId,
			targetName: label,
			op: 'set_overlay_highlight',
			value: [...NODE_HIGHLIGHT_FACTOR]
		}));
	}

	$effect(() => {
		assetId;
		let cancelled = false;
		let nextPoll: ReturnType<typeof setTimeout> | undefined;

		const loadOverlay = async (): Promise<void> => {
			try {
				const response = await fetch(`/api/vehicle-assets/${assetId}/semantic-overlay`);
				if (!response.ok && response.status !== 404) {
					throw new Error(`Semantic overlay request failed: ${response.status}`);
				}

				const payload = (await response.json()) as VehicleSemanticOverlaySnapshot;
				if (cancelled) {
					return;
				}

				semanticRuntimeState.applyAssetState(assetId, {
					overlaySnapshot: payload
				});
				expandedGroupIds = expandedGroupIds.filter((groupId) =>
					(payload.overlay?.acceptedGroups ?? []).some((group) => group.id === groupId)
				);

				if (
					payload.overlayStatus === 'missing' &&
					!missingPromptedAssetIds.includes(assetId)
				) {
					missingPromptedAssetIds = [...missingPromptedAssetIds, assetId];
					toast.success('Create semantic grouping?', {
						description:
							'This asset does not have semantic groups yet. Use the inspector prompt to generate them when you are ready.'
					});
				}
			} catch {
				if (cancelled) {
					return;
				}

				expandedGroupIds = [];
			} finally {
				if (cancelled) {
					return;
				}

				nextPoll = setTimeout(() => {
					void loadOverlay();
				}, 3000);
			}
		};

		expandedGroupIds = [];
		void loadOverlay();

		return () => {
			cancelled = true;
			if (nextPoll) {
				clearTimeout(nextPoll);
			}
		};
	});
</script>

{#if visible}
	<aside class={['sidebar', className]} aria-label="Semantic groups">
		<div class="group-stack">
			{#each semanticGroups as group, groupIndex (group.id)}
				<section class="group-row" style={`--waterfall-delay:${groupIndex * 50}ms`}>
					<div class="group-header">
						<button
							type="button"
							class="group-trigger"
							aria-expanded={isExpanded(group.id)}
							onclick={() => toggleGroup(group.id)}
						>
							<span class="group-label">{group.label}</span>
						</button>
						<div class="group-actions">
							<span class="group-meta">{group.nodes.length}</span>
								{#if !isExpanded(group.id)}
									{@const groupHighlightKey = getGroupHighlightKey(group.id)}
									{@const groupIsHighlighted = isGroupDirectlyHighlighted(group.id)}
								<button
										type="button"
										class="highlight-button"
										class:is-active={groupIsHighlighted}
										aria-label={getHighlightLabel(group.label, groupHighlightKey, group.highlightTargets)}
										aria-pressed={groupIsHighlighted}
										title={getHighlightLabel(group.label, groupHighlightKey, group.highlightTargets)}
										disabled={$chatRequestState.pending}
										onclick={(event) => {
											event.stopPropagation();
											toggleHighlight(
												groupHighlightKey,
												group.highlightTargets,
												group.label
											);
										}}
									>
									<Highlighter class="h-3.5 w-3.5" />
								</button>
							{/if}
						</div>
					</div>
					{#if isExpanded(group.id)}
						<div class="node-stack">
								{#each group.nodes as node, nodeIndex (`${group.id}-${node.id}`)}
									{@const nodeHighlightKey = getNodeHighlightKey(group.id, node.id)}
									{@const nodeIsDirectlyHighlighted = isNodeDirectlyHighlighted(group.id, node.id)}
									{@const nodeIsDownstreamHighlighted = !nodeIsDirectlyHighlighted && isNodeDownstreamHighlighted(group.id) && isHighlighted(node.highlightTargets)}
									<div
										class="node-line node-row"
										style={`--waterfall-delay:${groupIndex * 50 + nodeIndex * 36}ms`}
									>
										<div class="node-copy">
											<span class={['target-kind-indicator', 'target-kind-node']} aria-hidden="true"></span>
											<span class="node-label">{node.label}</span>
										</div>
									<button
										type="button"
											class="highlight-button"
											class:is-active={nodeIsDirectlyHighlighted}
											class:is-downstream={nodeIsDownstreamHighlighted}
											aria-label={getHighlightLabel(node.label, nodeHighlightKey, node.highlightTargets, nodeIsDownstreamHighlighted)}
											aria-pressed={nodeIsDirectlyHighlighted}
											title={getHighlightLabel(node.label, nodeHighlightKey, node.highlightTargets, nodeIsDownstreamHighlighted)}
											disabled={$chatRequestState.pending}
											onclick={() =>
												toggleHighlight(
													nodeHighlightKey,
													node.highlightTargets,
													node.label
												)}
										>
										<Highlighter class="h-3.5 w-3.5" />
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		</div>
	</aside>
{/if}

<style>
	.sidebar {
		width: 14rem;
		max-height: 55vh;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: transparent;
		border: 0;
		box-shadow: none;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklab, var(--boundary-primary) 18%, transparent) transparent;
	}

	.group-stack {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.group-row,
	.node-line {
		opacity: 0;
		transform: translateY(0.3rem);
		animation: waterfall-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) forwards;
		animation-delay: var(--waterfall-delay, 0ms);
	}

	.group-trigger {
		display: block;
		width: 100%;
		padding: 0;
		background: transparent;
		border: 0;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.group-trigger:disabled,
	.node-trigger:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.group-label {
		font-size: 0.8rem;
		line-height: 1.3;
		color: var(--boundary-text);
	}

	.group-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
	}

	.group-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.group-meta {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.14em;
		color: color-mix(in oklab, var(--boundary-secondary) 72%, var(--boundary-text));
	}

	.node-stack {
		margin-top: 0.45rem;
		padding-left: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.32rem;
	}

	.node-line {
		margin: 0;
	}

	.node-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.node-copy {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex: 1 1 auto;
	}

	.node-label {
		font-size: 0.72rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--boundary-text) 72%, transparent);
	}

	.target-kind-indicator {
		display: inline-flex;
		width: 1rem;
		height: 1rem;
		border-radius: 0.375rem;
		flex-shrink: 0;
	}

	.target-kind-node {
		background: var(--boundary-tertiary);
	}

	.target-kind-material {
		background: var(--boundary-warning);
	}

	.highlight-button {
		padding: 0;
		border: 0;
		background: transparent;
		color: color-mix(in oklab, var(--boundary-text) 72%, transparent);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			color 140ms ease,
			opacity 140ms ease;
	}

	.highlight-button:hover:not(:disabled) {
		color: var(--boundary-text);
	}

	.highlight-button.highlight-node {
		color: color-mix(in oklab, var(--boundary-tertiary) 70%, var(--boundary-text));
	}

	.highlight-button.highlight-material {
		color: color-mix(in oklab, var(--boundary-warning) 70%, var(--boundary-text));
	}

	.highlight-button.highlight-node.highlight-material {
		color: color-mix(in oklab, var(--boundary-text) 82%, transparent);
	}

	.highlight-button.is-active {
		color: var(--boundary-warning);
	}

	.highlight-button.is-downstream {
		color: color-mix(in oklab, var(--boundary-warning) 62%, var(--boundary-text));
	}

	.highlight-button.highlight-node.is-active {
		color: var(--boundary-tertiary);
	}

	.highlight-button.highlight-node.is-downstream {
		color: color-mix(in oklab, var(--boundary-tertiary) 62%, var(--boundary-text));
	}

	.highlight-button.highlight-material.is-active {
		color: var(--boundary-warning);
	}

	.highlight-button.highlight-material.is-downstream {
		color: color-mix(in oklab, var(--boundary-warning) 62%, var(--boundary-text));
	}

	.highlight-button.highlight-node.highlight-material.is-active {
		color: var(--boundary-text);
	}

	.highlight-button.highlight-node.highlight-material.is-downstream {
		color: color-mix(in oklab, var(--boundary-text) 82%, transparent);
		opacity: 0.82;
	}

	.highlight-button:disabled {
		opacity: 0.55;
		cursor: progress;
	}

	@keyframes waterfall-in {
		from {
			opacity: 0;
			transform: translateY(0.3rem);
		}

		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
