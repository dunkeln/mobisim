<script lang="ts">
	import { Highlighter } from 'lucide-svelte';
	import { toast } from '$lib/components/ui/sonner';
	import { chatRequestState } from '$lib/stores/chat-request-state';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import { semanticRuntimeState } from '$lib/stores/semantic-runtime';
	import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
	import type {
		VehicleSemanticOverlay,
		VehicleSemanticPartUnit
	} from '$lib/server/connectors/vehicle-semantic-overlay/types';
	import {
		buildVehicleSemanticOverlayRuntimeIndex,
		type VehicleSemanticOverlayRuntimeIndex
	} from '$lib/semantic-overlay/runtime';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';
	import {
		buildHighlightTargetsForGroup,
		buildHighlightTargetsForPart,
		type HighlightTargetRef
	} from './semantic-highlight-targets';

	type Props = {
		assetId: VehicleAssetId;
		class?: string;
	};

	type SemanticGroupView = {
		id: string;
		label: string;
		category: string;
		parts: SemanticPartView[];
		uncoveredNodes: SemanticNodeView[];
		highlightTargets: HighlightTargetRef[];
	};

	type SemanticPartView = {
		id: string;
		label: string;
		nodes: SemanticNodeView[];
		highlightTargets: HighlightTargetRef[];
	};

	type SemanticNodeView = {
		id: string;
		label: string;
		highlightTargets: HighlightTargetRef[];
	};

	let { assetId, class: className = '' }: Props = $props();

	const NODE_HIGHLIGHT_FACTOR: [number, number, number, number] = [0.502, 0.808, 0.843, 1];
	let expandedGroupIds = $state<string[]>([]);
	const runtimeAsset = $derived.by(
		() =>
			$semanticRuntimeState.byAsset[assetId] ?? {
				overlay: null,
				overlayStatus: 'unknown',
				selectedGroupId: null
			}
	);
	const overlay = $derived(runtimeAsset.overlay);
	const selectedGroupId = $derived(runtimeAsset.selectedGroupId);

	function buildNodeView(
		nodeId: string,
		label: string
	): SemanticNodeView {
		return {
			id: nodeId,
			label,
			highlightTargets: [{ targetId: nodeId, targetType: 'node' as const }]
		};
	}

	function buildGroupViews(
		currentOverlay: VehicleSemanticOverlay | null,
		runtimeIndex: VehicleSemanticOverlayRuntimeIndex
	): SemanticGroupView[] {
		if (!currentOverlay) {
			return [];
		}

		return currentOverlay.acceptedGroups
			.map((group) => {
				const matchedParts = runtimeIndex.partsByGroupId.get(group.id) ?? [];
				const parts = matchedParts.map((part: VehicleSemanticPartUnit) => ({
					id: part.id,
					label: part.humanLabel,
					nodes: part.nodeIds.map((nodeId: string) => buildNodeView(nodeId, nodeId)),
					highlightTargets: buildHighlightTargetsForPart(part)
				}));
				const uncoveredNodes = (runtimeIndex.uncoveredNodeIdsByGroupId.get(group.id) ?? []).map(
					(nodeId: string) => buildNodeView(nodeId, nodeId)
				);
				return {
					id: group.id,
					label: group.humanLabel,
					category: group.category,
					parts,
					uncoveredNodes,
					highlightTargets: buildHighlightTargetsForGroup(group, runtimeIndex)
				};
			})
			.filter((group: SemanticGroupView) => group.highlightTargets.length > 0)
			.sort((left: SemanticGroupView, right: SemanticGroupView) =>
				left.label.localeCompare(right.label)
			);
	}

	const semanticRuntimeIndex = $derived(buildVehicleSemanticOverlayRuntimeIndex(overlay));
	const semanticGroups = $derived(buildGroupViews(overlay, semanticRuntimeIndex));
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

	function applySidebarSelection(
		groupId: string,
		targets: HighlightTargetRef[],
		label: string
	): void {
		if (isHighlighted(targets) && selectedGroupId === groupId) {
			const didRestore = vehiclePatchState.apply(assetId, {
				kind: 'clear_highlights',
				intentLabel: `clear ${label} selection`
			});

			if (!didRestore) {
				toast.error('Selection failed', {
					description: 'No matching semantic highlight was active.'
				});
				return;
			}

			semanticRuntimeState.applyAssetState(assetId, {
				selectedGroupId: null
			});
			return;
		}

		semanticRuntimeState.applyAssetState(assetId, {
			selectedGroupId: groupId
		});
		vehiclePatchState.apply(assetId, {
			kind: 'set_highlights',
			intentLabel: `select ${label}`,
			operations: buildSemanticPanelHighlightOperations(targets, label)
		});
	}

	function toggleGroup(group: SemanticGroupView): void {
		applySidebarSelection(
			group.id,
			group.highlightTargets,
			group.label
		);
		expandedGroupIds = expandedGroupIds.includes(group.id)
			? expandedGroupIds.filter((id) => id !== group.id)
			: [...expandedGroupIds, group.id];
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

	function isDirectlyHighlighted(targets: HighlightTargetRef[]): boolean {
		if (targets.length === 0 || activeHighlightTargetKeys.size === 0) {
			return false;
		}

		const uniqueTargetKeys = Array.from(new Set(targets.map((target) => getTargetKey(target))));
		if (uniqueTargetKeys.length !== activeHighlightTargetKeys.size) {
			return false;
		}

		return uniqueTargetKeys.every((targetKey) => activeHighlightTargetKeys.has(targetKey));
	}

	function isGroupDirectlyHighlighted(groupId: string): boolean {
		const group = semanticGroups.find((entry) => entry.id === groupId);
		return group ? isDirectlyHighlighted(group.highlightTargets) : false;
	}

	function isNodeDirectlyHighlighted(groupId: string, nodeId: string): boolean {
		const group = semanticGroups.find((entry) => entry.id === groupId);
		const part = group?.parts.find((entry) => entry.id === nodeId);
		if (part) {
			return isDirectlyHighlighted(part.highlightTargets);
		}

		const node = group?.uncoveredNodes.find((entry) => entry.id === nodeId);
		return node ? isDirectlyHighlighted(node.highlightTargets) : false;
	}

	function isNodeDownstreamHighlighted(groupId: string): boolean {
		return isGroupDirectlyHighlighted(groupId);
	}

	function getHighlightLabel(
		label: string,
		targets: HighlightTargetRef[],
		downstream = false
	): string {
		if (isDirectlyHighlighted(targets)) {
			return `Clear highlight for ${label}`;
		}

		if (downstream && isHighlighted(targets)) {
			return `Focus highlight on ${label}`;
		}

		return `Highlight ${label}`;
	}

	function toggleHighlight(
		targets: HighlightTargetRef[],
		label: string,
		groupId: string
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

		applySidebarSelection(groupId, targets, label);
	}

	function buildSemanticPanelHighlightOperations(
		targets: HighlightTargetRef[],
		label: string
	): VehicleInspectionPatchOperation[] {
		return Array.from(
			new Map(targets.map((target) => [getTargetKey(target), target])).values()
		).map((target): VehicleInspectionPatchOperation => ({
			targetType: target.targetType,
			targetId: target.targetId,
			targetName: label,
			op: 'set_overlay_highlight',
			value: [...NODE_HIGHLIGHT_FACTOR]
		}));
	}

	$effect(() => {
		assetId;
		expandedGroupIds = [];
	});
</script>

{#if visible}
	<aside class={['sidebar canvas-glass-panel', className]} aria-label="Semantic groups">
		<div class="group-stack">
			{#each semanticGroups as group, groupIndex (group.id)}
				<section class="group-row" style={`--waterfall-delay:${groupIndex * 50}ms`}>
					<div class="group-header">
						<button
							type="button"
							class="group-trigger"
							aria-expanded={isExpanded(group.id)}
							aria-pressed={selectedGroupId === group.id}
							onclick={() => toggleGroup(group)}
						>
							<span class="group-label">{group.label}</span>
						</button>
						<div class="group-actions">
								{#if !isExpanded(group.id)}
									{@const groupIsHighlighted = isGroupDirectlyHighlighted(group.id)}
								<button
										type="button"
										class="highlight-button"
										class:is-active={groupIsHighlighted}
										aria-label={getHighlightLabel(group.label, group.highlightTargets)}
										aria-pressed={groupIsHighlighted}
										title={getHighlightLabel(group.label, group.highlightTargets)}
										disabled={$chatRequestState.pending}
										onclick={(event) => {
											event.stopPropagation();
											toggleHighlight(
												group.highlightTargets,
												group.label,
												group.id
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
								{#each group.parts as part, partIndex (`${group.id}-${part.id}`)}
									{@const partIsDirectlyHighlighted = isNodeDirectlyHighlighted(group.id, part.id)}
									{@const partIsDownstreamHighlighted = !partIsDirectlyHighlighted && isNodeDownstreamHighlighted(group.id) && isHighlighted(part.highlightTargets)}
									<div
										class="node-line node-row"
										style={`--waterfall-delay:${groupIndex * 50 + partIndex * 36}ms`}
									>
										<div class="node-copy">
											<span class={['target-kind-indicator', 'target-kind-node']} aria-hidden="true"></span>
											<span class="node-label">{part.label}</span>
										</div>
									<button
										type="button"
											class="highlight-button"
											class:is-active={partIsDirectlyHighlighted}
											class:is-downstream={partIsDownstreamHighlighted}
											aria-label={getHighlightLabel(part.label, part.highlightTargets, partIsDownstreamHighlighted)}
											aria-pressed={partIsDirectlyHighlighted}
											title={getHighlightLabel(part.label, part.highlightTargets, partIsDownstreamHighlighted)}
											disabled={$chatRequestState.pending}
											onclick={() =>
												toggleHighlight(
													part.highlightTargets,
													part.label,
													group.id
												)}
										>
										<Highlighter class="h-3.5 w-3.5" />
									</button>
								</div>
							{/each}
								{#each group.uncoveredNodes as node, nodeIndex (`${group.id}-${node.id}`)}
									{@const nodeIsDirectlyHighlighted = isNodeDirectlyHighlighted(group.id, node.id)}
									{@const nodeIsDownstreamHighlighted = !nodeIsDirectlyHighlighted && isNodeDownstreamHighlighted(group.id) && isHighlighted(node.highlightTargets)}
									<div
										class="node-line node-row"
										style={`--waterfall-delay:${groupIndex * 50 + (group.parts.length + nodeIndex) * 36}ms`}
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
											aria-label={getHighlightLabel(node.label, node.highlightTargets, nodeIsDownstreamHighlighted)}
											aria-pressed={nodeIsDirectlyHighlighted}
											title={getHighlightLabel(node.label, node.highlightTargets, nodeIsDownstreamHighlighted)}
											disabled={$chatRequestState.pending}
											onclick={() =>
												toggleHighlight(
													node.highlightTargets,
													node.label,
													group.id
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
		width: 16rem;
		max-height: 55vh;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0.95rem 0.95rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.12rem;
		border-radius: 1.55rem;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklab, var(--boundary-primary) 18%, transparent) transparent;
		isolation: isolate;
	}

	.sidebar::before {
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
		z-index: 0;
	}

	.group-stack {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 0.04rem;
	}

	.group-row,
	.node-line {
		opacity: 0;
		transform: translateY(0.3rem);
		animation: waterfall-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) forwards;
		animation-delay: var(--waterfall-delay, 0ms);
	}

	.group-row {
		border: 0;
		border-radius: 0.9rem;
		padding: 0.08rem 0.1rem;
		background: transparent;
		transition: background 140ms ease;
	}

	.group-row:has(.group-trigger:hover) {
		background: color-mix(in oklab, white 1.5%, transparent);
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
		font-size: 0.84rem;
		line-height: 1.35;
		color: color-mix(in oklab, var(--boundary-text) 88%, transparent);
		letter-spacing: -0.01em;
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
		padding: 0.16rem 0.22rem;
	}

	.node-stack {
		margin-top: 0.14rem;
		padding-left: 0.08rem;
		display: flex;
		flex-direction: column;
		gap: 0.02rem;
	}

	.node-line {
		margin: 0;
	}

	.node-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.16rem 0.2rem 0.16rem 0.46rem;
		border-radius: 0.8rem;
		transition: background 140ms ease;
	}

	.node-row:hover {
		background: color-mix(in oklab, white 1.25%, transparent);
	}

	.node-copy {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex: 1 1 auto;
	}

	.node-label {
		font-size: 0.74rem;
		line-height: 1.4;
		color: color-mix(in oklab, var(--boundary-text) 58%, transparent);
		letter-spacing: 0.005em;
	}

	.target-kind-indicator {
		display: inline-flex;
		width: 0.3rem;
		height: 0.3rem;
		border-radius: 9999px;
		flex-shrink: 0;
		opacity: 0.55;
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
		color: color-mix(in oklab, var(--boundary-text) 38%, transparent);
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
