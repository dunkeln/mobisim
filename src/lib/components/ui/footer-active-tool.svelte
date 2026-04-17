<script lang="ts">
	import { footerActiveTool } from '$lib/stores/footer-active-tool';

	type Props = {
		class?: string;
	};

	let { class: className = '' }: Props = $props();
	const activeTool = $derived($footerActiveTool);
	const resolvedLabel = $derived(activeTool.label);
	const isActive = $derived(activeTool.active && activeTool.toolName !== null && activeTool.label.length > 0);
</script>

{#if isActive && resolvedLabel}
	<div class="tool-root {className}" aria-live="polite">
		<div class="tool-shell" aria-label={resolvedLabel}>
			<div class="tool-label">{resolvedLabel}</div>
		</div>
	</div>
{/if}

<style>
	.tool-root {
		z-index: 1;
		display: inline-flex;
		align-items: flex-end;
		width: auto;
		max-width: min(26rem, calc(100vw - 8rem));
		pointer-events: none;
	}

	.tool-shell {
		display: inline-flex;
		align-items: flex-end;
		width: auto;
		max-width: inherit;
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
	}

	.tool-label {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.02em;
		line-height: 1;
		-webkit-font-smoothing: antialiased;
		text-rendering: geometricPrecision;
		color: white;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: min(24rem, calc(100vw - 10rem));
		text-shadow: 0 1px 8px color-mix(in srgb, black 62%, transparent);
	}
</style>
