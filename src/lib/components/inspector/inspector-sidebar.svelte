<script lang="ts">
	/**
	 * InspectorSidebar — contextual part info panel.
	 *
	 * Reads vehiclePatchState reactively. Slides in from the right when
	 * any presentation layer has active operations. Collapses to nothing
	 * when the state is clean.
	 *
	 * No props required — fully store-driven.
	 */

	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';

	// ── Derived state ────────────────────────────────────────────

	const state = $derived($vehiclePatchState);

	type NamedTarget = { id: string; name: string | null | undefined };

	function gatherTargets(ops: VehicleInspectionPatchOperation[]): NamedTarget[] {
		const seen = new Set<string>();
		const out: NamedTarget[] = [];
		for (const op of ops) {
			if (!seen.has(op.targetId)) {
				seen.add(op.targetId);
				out.push({ id: op.targetId, name: op.targetName });
			}
		}
		return out;
	}

	const hiddenTargets = $derived(
		gatherTargets(
			state.presentation.nodeVisibilityOperations.filter(
				(op) => op.op === 'set_visibility' && op.value === false
			)
		)
	);

	const materialTargets = $derived(
		gatherTargets(state.presentation.materialOperations)
	);

	const highlightTargets = $derived(
		gatherTargets(state.presentation.highlightOperations)
	);

	const totalNodes = $derived(
		new Set([
			...hiddenTargets.map((t) => t.id),
			...materialTargets.map((t) => t.id),
			...highlightTargets.map((t) => t.id)
		]).size
	);

	const hasContent = $derived(
		totalNodes > 0 || !!state.intentLabel
	);

	function displayName(target: NamedTarget): string {
		if (target.name && target.name.trim().length > 0) return target.name;
		return target.id;
	}

	// Trim long names
	function truncate(s: string, max = 22): string {
		return s.length > max ? s.slice(0, max - 1) + '…' : s;
	}
</script>

<!--
  Position: fixed, right side, vertically centered.
  Slides in from the right when hasContent is true.
  Width: 224px. Backdrop-blur panel, hairline left border.
-->
<aside class="sidebar" class:visible={hasContent} aria-label="Part inspector">
	<!-- ── Header ─────────────────────────────────────────────── -->
	<div class="sidebar-header">
		<span class="sidebar-title">INSPECTOR</span>
		{#if totalNodes > 0}
			<span class="node-badge">{totalNodes}</span>
		{/if}
	</div>

	{#if state.intentLabel}
		<div class="intent-row">
			<span class="intent-text">{state.intentLabel}</span>
		</div>
	{/if}

	<!-- ── Sections ───────────────────────────────────────────── -->
	{#if hiddenTargets.length > 0}
		<section class="section">
			<p class="section-label">HIDDEN</p>
			<ul class="node-list">
				{#each hiddenTargets as target (target.id)}
					<li class="node-row">
						<span class="node-dot hidden-dot"></span>
						<span class="node-name">{truncate(displayName(target))}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if materialTargets.length > 0}
		<section class="section">
			<p class="section-label">MATERIAL</p>
			<ul class="node-list">
				{#each materialTargets as target (target.id)}
					<li class="node-row">
						<span class="node-dot material-dot"></span>
						<span class="node-name">{truncate(displayName(target))}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if highlightTargets.length > 0}
		<section class="section">
			<p class="section-label">HIGHLIGHT</p>
			<ul class="node-list">
				{#each highlightTargets as target (target.id)}
					<li class="node-row active">
						<span class="node-dot highlight-dot"></span>
						<span class="node-name">{truncate(displayName(target))}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- ── Footer: undo hint ──────────────────────────────────── -->
	{#if state.canUndo}
		<div class="sidebar-footer">
			<span class="undo-hint">say "undo" to revert</span>
		</div>
	{/if}
</aside>

<style>
	/* ─── Sidebar shell ──────────────────────────────────────── */
	.sidebar {
		position: fixed;
		top: 50%;
		right: 0;
		transform: translateY(-50%) translateX(100%);
		width: 200px;
		max-height: 70vh;
		overflow-y: auto;
		overflow-x: hidden;

		background: color-mix(in oklab, var(--boundary-background) 78%, transparent);
		border-left: 1px solid
			color-mix(in oklab, var(--boundary-primary) 18%, transparent);
		border-top: 1px solid
			color-mix(in oklab, var(--boundary-text) 7%, transparent);
		border-bottom: 1px solid
			color-mix(in oklab, var(--boundary-text) 7%, transparent);
		border-radius: 2px 0 0 2px;
		backdrop-filter: blur(18px);

		padding: 14px 14px 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;

		/* Transition */
		transition:
			transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.24s ease;
		opacity: 0;
		pointer-events: none;

		/* Scrollbar: minimal */
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklab, var(--boundary-primary) 20%, transparent) transparent;
	}

	.sidebar.visible {
		transform: translateY(-50%) translateX(0);
		opacity: 1;
		pointer-events: auto;
	}

	/* ─── Header ─────────────────────────────────────────────── */
	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.sidebar-title {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.2em;
		color: var(--boundary-text);
		opacity: 0.3;
	}

	.node-badge {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.06em;
		color: color-mix(in oklab, var(--boundary-primary) 85%, var(--boundary-text));
		opacity: 0.7;
		background: color-mix(in oklab, var(--boundary-primary) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--boundary-primary) 22%, transparent);
		border-radius: 3px;
		padding: 1px 5px;
	}

	/* ─── Intent row ─────────────────────────────────────────── */
	.intent-row {
		border-left: 1px solid
			color-mix(in oklab, var(--boundary-primary) 35%, transparent);
		padding-left: 8px;
	}

	.intent-text {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		color: var(--boundary-text);
		opacity: 0.72;
		line-height: 1.4;
		display: block;
	}

	/* ─── Sections ───────────────────────────────────────────── */
	.section {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.section-label {
		font-family: var(--font-mono);
		font-size: 0.54rem;
		letter-spacing: 0.18em;
		color: var(--boundary-text);
		opacity: 0.25;
		margin: 0;
	}

	/* ─── Node list ──────────────────────────────────────────── */
	.node-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.node-row {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 3px 6px;
		border-radius: 3px;
		transition: background 0.15s ease;
	}

	.node-row.active {
		background: color-mix(in oklab, var(--boundary-primary) 7%, transparent);
	}

	.node-name {
		font-family: var(--font-mono);
		font-size: 0.64rem;
		color: var(--boundary-text);
		opacity: 0.55;
		letter-spacing: 0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.node-row.active .node-name {
		opacity: 0.8;
	}

	/* ─── Node dots ──────────────────────────────────────────── */
	.node-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.hidden-dot {
		background: color-mix(in oklab, var(--boundary-text) 30%, transparent);
		border: 1px solid color-mix(in oklab, var(--boundary-text) 30%, transparent);
		background: transparent;
	}

	.material-dot {
		background: color-mix(in oklab, var(--boundary-secondary) 70%, transparent);
	}

	.highlight-dot {
		background: color-mix(in oklab, var(--boundary-primary) 85%, white);
		box-shadow: 0 0 4px color-mix(in oklab, var(--boundary-primary) 60%, transparent);
	}

	/* ─── Footer ─────────────────────────────────────────────── */
	.sidebar-footer {
		border-top: 1px solid color-mix(in oklab, var(--boundary-text) 8%, transparent);
		padding-top: 8px;
	}

	.undo-hint {
		font-family: var(--font-mono);
		font-size: 0.54rem;
		letter-spacing: 0.1em;
		color: var(--boundary-text);
		opacity: 0.2;
	}
</style>
