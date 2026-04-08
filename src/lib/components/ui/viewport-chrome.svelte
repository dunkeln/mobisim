<script lang="ts">
	/**
	 * ViewportChrome — Jarvis-style HUD overlay for the 3D viewport.
	 *
	 * Drop inside any position:relative container that holds the canvas.
	 * pointer-events: none throughout — does not intercept mouse/touch.
	 *
	 * Props:
	 *   assetLabel    — vehicle name shown in status strip
	 *   intentLabel   — active command label (e.g. "hide body panels")
	 *   moving        — true while camera is orbiting
	 *   nodeCount     — number of nodes in active selection/operation
	 *   loaded        — true once the scene has finished loading (triggers scan)
	 */

	type Props = {
		assetLabel?: string | null;
		intentLabel?: string | null;
		moving?: boolean;
		nodeCount?: number | null;
		loaded?: boolean;
		class?: string;
	};

	let {
		assetLabel = null,
		intentLabel = null,
		moving = false,
		nodeCount = null,
		loaded = false,
		class: className = ''
	}: Props = $props();

	// After the scene loads, play the scan line once then stop.
	let scanPlayed = $state(false);
	$effect(() => {
		if (loaded && !scanPlayed) {
			scanPlayed = true;
		}
	});
</script>

<!--
  Overlay sits absolutely over the canvas. All children have pointer-events:none.
  Structure:
    • 4 corner brackets (SVG, each ~14×14px at 12% opacity)
    • top status bar (asset label + mode)
    • bottom status strip (intent label + node count + orbit indicator)
    • scan line (one-shot on load, then hidden)
-->
<div class="chrome {className}" aria-hidden="true">

	<!-- ── Corner brackets ─────────────────────────────────── -->
	<svg class="corner tl" viewBox="0 0 14 14" fill="none">
		<path d="M14 1H1V14" stroke="currentColor" stroke-width="1"/>
	</svg>
	<svg class="corner tr" viewBox="0 0 14 14" fill="none">
		<path d="M0 1H13V14" stroke="currentColor" stroke-width="1"/>
	</svg>
	<svg class="corner bl" viewBox="0 0 14 14" fill="none">
		<path d="M14 13H1V0" stroke="currentColor" stroke-width="1"/>
	</svg>
	<svg class="corner br" viewBox="0 0 14 14" fill="none">
		<path d="M0 13H13V0" stroke="currentColor" stroke-width="1"/>
	</svg>

	<!-- ── Top bar: asset identity ─────────────────────────── -->
	<div class="top-bar">
		{#if assetLabel}
			<span class="asset-label">{assetLabel.toUpperCase()}</span>
		{/if}
		<span class="mode-label" class:active={!!intentLabel}>
			{intentLabel ? 'ACTIVE INTENT' : 'INSPECTION MODE'}
		</span>
	</div>

	<!-- ── Bottom strip: intent + node count + orbit ────────── -->
	<div class="bottom-strip">
		{#if intentLabel}
			<span class="intent-label">{intentLabel.toUpperCase()}</span>
		{/if}
		{#if nodeCount != null && nodeCount > 0}
			{#if intentLabel}<span class="sep">·</span>{/if}
			<span class="node-count">{nodeCount} NODE{nodeCount !== 1 ? 'S' : ''}</span>
		{/if}
		{#if moving}
			{#if intentLabel || (nodeCount != null && nodeCount > 0)}<span class="sep">·</span>{/if}
			<span class="orbit-label">ORBITING</span>
		{/if}
	</div>

	<!-- ── Scan line: one-shot on load ──────────────────────── -->
	{#if scanPlayed}
		<div class="scan-line"></div>
	{/if}

</div>

<style>
	/* ─── Outer container ────────────────────────────────────── */
	.chrome {
		position: absolute;
		inset: 0;
		pointer-events: none;
		/* Isolation so z-index stacking is local */
		isolation: isolate;
	}

	/* ─── Corner brackets ────────────────────────────────────── */
	.corner {
		position: absolute;
		width: 14px;
		height: 14px;
		color: var(--boundary-text);
		opacity: 0.13;
	}

	.corner.tl { top: 10px; left: 10px; }
	.corner.tr { top: 10px; right: 10px; }
	.corner.bl { bottom: 10px; left: 10px; }
	.corner.br { bottom: 10px; right: 10px; }

	/* ─── Top bar ────────────────────────────────────────────── */
	.top-bar {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.22em;
		color: var(--boundary-text);
		white-space: nowrap;
	}

	.asset-label {
		opacity: 0.55;
	}

	.mode-label {
		opacity: 0.22;
		transition: opacity 0.3s ease, color 0.3s ease;
	}

	.mode-label.active {
		opacity: 0.55;
		color: color-mix(in oklab, var(--boundary-primary) 80%, var(--boundary-text));
	}

	/* ─── Bottom strip ───────────────────────────────────────── */
	.bottom-strip {
		position: absolute;
		bottom: 10px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.18em;
		color: var(--boundary-text);
		white-space: nowrap;
	}

	.intent-label {
		opacity: 0.6;
		color: color-mix(in oklab, var(--boundary-primary) 75%, var(--boundary-text));
	}

	.node-count {
		opacity: 0.35;
	}

	.orbit-label {
		opacity: 0.28;
		animation: blink-orbit 1.1s ease-in-out infinite;
	}

	@keyframes blink-orbit {
		0%, 100% { opacity: 0.28; }
		50%       { opacity: 0.14; }
	}

	.sep {
		opacity: 0.2;
	}

	/* ─── Scan line ──────────────────────────────────────────── */
	.scan-line {
		position: absolute;
		inset-inline: 0;
		height: 1px;
		background: linear-gradient(
			90deg,
			transparent 0%,
			color-mix(in oklab, var(--boundary-primary) 60%, var(--boundary-text)) 30%,
			color-mix(in oklab, var(--boundary-primary) 80%, white) 50%,
			color-mix(in oklab, var(--boundary-primary) 60%, var(--boundary-text)) 70%,
			transparent 100%
		);
		opacity: 0;
		/* Plays once: sweeps top-to-bottom over 900ms, fades out */
		animation: scan-sweep 0.9s cubic-bezier(0.4, 0, 0.8, 1) forwards;
		pointer-events: none;
	}

	@keyframes scan-sweep {
		0%   { top: 0%;   opacity: 0; }
		8%   { opacity: 0.55; }
		85%  { opacity: 0.42; }
		100% { top: 100%; opacity: 0; }
	}
</style>
