<script lang="ts">
	import { Highlighter } from 'lucide-svelte';
	import { toast } from '$lib/components/ui/sonner';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
	import type {
		VehicleSemanticGroup,
		VehicleSemanticOverlay,
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
			highlightTargetIds: string[];
		}>;
		highlightTargetIds: string[];
	};

	type HighlightScopeDescriptor = {
		targetIds: string[];
		scope: 'group' | 'node';
		groupId: string;
	};

	let { assetId, class: className = '' }: Props = $props();

	const SEMANTIC_PANEL_HIGHLIGHT_FACTOR: [number, number, number, number] = [0.751, 0.341, 0.269, 1];

	let overlay = $state<VehicleSemanticOverlay | null>(null);
	let expandedGroupIds = $state<string[]>([]);
	let activeHighlightKey = $state<string | null>(null);

	function partMatchesGroup(part: VehicleSemanticPartUnit, group: VehicleSemanticGroup): boolean {
		if (group.nodeIds.some((nodeId) => part.nodeIds.includes(nodeId))) {
			return true;
		}

		if (group.materialIds.some((materialId) => part.materialIds.includes(materialId))) {
			return true;
		}

		return false;
	}

	function buildGroupViews(currentOverlay: VehicleSemanticOverlay | null): SemanticGroupView[] {
		if (!currentOverlay) {
			return [];
		}

		return currentOverlay.acceptedGroups
			.map((group) => {
				const matchedParts = currentOverlay.acceptedParts.filter((part) => partMatchesGroup(part, group));
				const semanticNodes = matchedParts.length > 0
					? matchedParts.map((part) => ({
							id: part.id,
							label: part.humanLabel,
							highlightTargetIds: [...part.materialIds]
					  }))
					: group.nodeIds.map((nodeId) => ({
							id: nodeId,
							label: nodeId,
							highlightTargetIds: [...group.materialIds]
					  }));

				return {
					id: group.id,
					label: group.humanLabel,
					category: group.category,
					nodes: semanticNodes,
					highlightTargetIds:
						group.materialIds.length > 0
							? [...group.materialIds]
							: Array.from(new Set(semanticNodes.flatMap((node) => node.highlightTargetIds)))
				};
			})
			.filter((group) => group.nodes.length > 0)
			.sort((left, right) => left.label.localeCompare(right.label));
	}

	const semanticGroups = $derived(buildGroupViews(overlay));
	const visible = $derived(semanticGroups.length > 0);
	const activeHighlightTargetIds = $derived(
		$vehiclePatchState.assetId === assetId
			? new Set(
					$vehiclePatchState.presentation.highlightOperations.map((operation) => operation.targetId)
			  )
			: new Set<string>()
	);
	const highlightDescriptorsByKey = $derived.by(() => {
		const descriptors = new Map<string, HighlightScopeDescriptor>();

		for (const group of semanticGroups) {
			descriptors.set(getGroupHighlightKey(group.id), {
				targetIds: Array.from(new Set(group.highlightTargetIds)),
				scope: 'group',
				groupId: group.id
			});

			for (const node of group.nodes) {
				descriptors.set(getNodeHighlightKey(group.id, node.id), {
					targetIds: Array.from(new Set(node.highlightTargetIds)),
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

	function isHighlighted(targetIds: string[]): boolean {
		if (targetIds.length === 0) {
			return false;
		}

		return targetIds.every((targetId) => activeHighlightTargetIds.has(targetId));
	}

	function matchesExactActiveHighlight(targetIds: string[]): boolean {
		if (targetIds.length === 0 || activeHighlightTargetIds.size === 0) {
			return false;
		}

		const uniqueTargetIds = Array.from(new Set(targetIds));
		if (uniqueTargetIds.length !== activeHighlightTargetIds.size) {
			return false;
		}

		return uniqueTargetIds.every((targetId) => activeHighlightTargetIds.has(targetId));
	}

	function isDirectlyHighlighted(highlightKey: string): boolean {
		const descriptor = highlightDescriptorsByKey.get(highlightKey);
		if (!descriptor || activeHighlightKey !== highlightKey) {
			return false;
		}

		return matchesExactActiveHighlight(descriptor.targetIds);
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
		targetIds: string[],
		downstream = false
	): string {
		if (isDirectlyHighlighted(highlightKey)) {
			return `Clear highlight for ${label}`;
		}

		if (downstream && isHighlighted(targetIds)) {
			return `Focus highlight on ${label}`;
		}

		return `Highlight ${label}`;
	}

	function toggleHighlight(
		highlightKey: string,
		targetIds: string[],
		label: string
	): void {
		if (targetIds.length === 0) {
			toast.error('Highlight failed', {
				description: 'No semantic material targets were available for that item.'
			});
			return;
		}

		if (isDirectlyHighlighted(highlightKey)) {
			const didRestore = vehiclePatchState.clearHighlightTargets(
				assetId,
				targetIds,
				`clear ${label} highlight`
			);

			if (!didRestore) {
				toast.error('Highlight failed', {
					description: 'No matching highlight was active.'
				});
			}
			activeHighlightKey = null;
			return;
		}

		activeHighlightKey = highlightKey;
		vehiclePatchState.setHighlights(
			assetId,
			buildSemanticPanelHighlightOperations(targetIds, label),
			`highlight ${label}`
		);
	}

	$effect(() => {
		assetId;
		activeHighlightKey = null;
	});

	$effect(() => {
		const descriptors = highlightDescriptorsByKey;
		const activeTargetCount = activeHighlightTargetIds.size;
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
				matchesExactActiveHighlight(descriptor.targetIds)
			)?.[0] ?? null;

		if (inferredHighlightKey !== currentHighlightKey) {
			activeHighlightKey = inferredHighlightKey;
		}
	});

	function buildSemanticPanelHighlightOperations(
		targetIds: string[],
		label: string
	): VehicleInspectionPatchOperation[] {
		const materialNameById = new Map(
			(overlay?.acceptedMaterials ?? []).map((material) => [material.targetId, material.targetName])
		);

		return Array.from(new Set(targetIds)).map((targetId) => ({
			targetType: 'material' as const,
			targetId,
			targetName: materialNameById.get(targetId) ?? label,
			op: 'set_overlay_highlight' as const,
			value: [...SEMANTIC_PANEL_HIGHLIGHT_FACTOR]
		}));
	}

	$effect(() => {
		assetId;
		let cancelled = false;
		let nextPoll: ReturnType<typeof setTimeout> | undefined;

		const loadOverlay = async (): Promise<void> => {
			try {
				const response = await fetch(`/api/vehicle-assets/${assetId}/semantic-overlay`);
				if (!response.ok) {
					if (response.status === 404) {
						overlay = null;
						return;
					}

					throw new Error(`Semantic overlay request failed: ${response.status}`);
				}

				const payload = (await response.json()) as VehicleSemanticOverlay;
				if (cancelled) {
					return;
				}

				overlay = payload;
				expandedGroupIds = expandedGroupIds.filter((groupId) =>
					payload.acceptedGroups.some((group) => group.id === groupId)
				);
			} catch {
				if (cancelled) {
					return;
				}

				overlay = null;
				expandedGroupIds = [];
			} finally {
				if (cancelled) {
					return;
				}

				nextPoll = setTimeout(() => {
					void loadOverlay();
				}, 5000);
			}
		};

		overlay = null;
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
									aria-label={getHighlightLabel(group.label, groupHighlightKey, group.highlightTargetIds)}
									aria-pressed={groupIsHighlighted}
									title={getHighlightLabel(group.label, groupHighlightKey, group.highlightTargetIds)}
									onclick={(event) => {
										event.stopPropagation();
										toggleHighlight(
											groupHighlightKey,
											group.highlightTargetIds,
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
								{@const nodeIsDownstreamHighlighted = !nodeIsDirectlyHighlighted && isNodeDownstreamHighlighted(group.id) && isHighlighted(node.highlightTargetIds)}
								<div
									class="node-line node-row"
									style={`--waterfall-delay:${groupIndex * 50 + nodeIndex * 36}ms`}
								>
									<span class="node-label">{node.label}</span>
									<button
										type="button"
										class="highlight-button"
										class:is-active={nodeIsDirectlyHighlighted}
										class:is-downstream={nodeIsDownstreamHighlighted}
										aria-label={getHighlightLabel(node.label, nodeHighlightKey, node.highlightTargetIds, nodeIsDownstreamHighlighted)}
										aria-pressed={nodeIsDirectlyHighlighted}
										title={getHighlightLabel(node.label, nodeHighlightKey, node.highlightTargetIds, nodeIsDownstreamHighlighted)}
										onclick={() =>
											toggleHighlight(
												nodeHighlightKey,
												node.highlightTargetIds,
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

	.node-label {
		font-size: 0.72rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--boundary-text) 72%, transparent);
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

	.highlight-button.is-active {
		color: var(--boundary-warning);
	}

	.highlight-button.is-downstream {
		color: color-mix(in oklab, var(--boundary-warning) 62%, var(--boundary-text));
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
