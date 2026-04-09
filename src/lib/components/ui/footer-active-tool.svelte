<script lang="ts">
	import { footerActiveTool } from '$lib/stores/footer-active-tool';

	type Props = {
		class?: string;
	};

	let { class: className = '' }: Props = $props();
	const activeTool = $derived($footerActiveTool);
	const resolvedToolLabels = $derived(activeTool.toolLabels);
	const resolvedLabel = $derived(activeTool.label);
	const isActive = $derived(activeTool.active && activeTool.label.length > 0);
	const historyLimit = 5;
	const historyLabels = $derived.by(() =>
		resolvedToolLabels.slice(Math.max(0, resolvedToolLabels.length - 1 - historyLimit), -1)
	);
</script>

{#if isActive && resolvedLabel}
	<div class="tool-root {className}" aria-live="polite">
		<div class="tool-history">
			<div class="tool-history__scroll">
				{#each historyLabels as toolLabel, index (`${toolLabel}-${index}`)}
					<div class="tool-pill tool-pill--history">
						{toolLabel}
					</div>
				{/each}
			</div>
		</div>

		<div class="tool-shell" aria-label={resolvedLabel}>
			<div class="tool-label">{resolvedLabel}</div>
		</div>
	</div>
{/if}

<style>
	.tool-root {
		position: relative;
		z-index: 1;
		display: inline-flex;
		flex-direction: column;
		align-items: flex-end;
		width: auto;
		max-width: min(26rem, calc(100vw - 8rem));
		pointer-events: none;
	}

	.tool-history {
		position: absolute;
		right: 0;
		bottom: calc(100% + 0.28rem);
		width: max-content;
		max-width: inherit;
		max-height: calc((1.86rem * 5) + (0.28rem * 4));
		overflow: hidden;
	}

	.tool-history__scroll {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.28rem;
		max-height: inherit;
		max-width: inherit;
		overflow: hidden;
		padding: 0;
	}

	.tool-shell {
		position: relative;
		z-index: 1;
		display: inline-flex;
		width: max-content;
		max-width: inherit;
		align-items: center;
		justify-content: flex-end;
		min-height: 1.86rem;
		padding: 0.46rem 0.86rem 0.44rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 13%, transparent);
		background:
			radial-gradient(circle at 22% 10%, color-mix(in srgb, white 5%, transparent), transparent 24%),
			linear-gradient(
				180deg,
				color-mix(in srgb, white 4%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 1.8%, transparent) 38%,
				color-mix(in srgb, var(--color-boundary-text) 0.55%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 14%, transparent),
			0 10px 22px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		backdrop-filter: blur(16px) saturate(108%);
		-webkit-backdrop-filter: blur(16px) saturate(108%);
		isolation: isolate;
	}

	.tool-shell::before,
	.tool-pill::before {
		content: '';
		position: absolute;
		inset: 1px;
		border-radius: inherit;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, white 8%, transparent),
				color-mix(in srgb, white 2%, transparent) 18%,
				transparent 34%,
				transparent 100%
			),
			radial-gradient(
				115% 76% at 16% 0%,
				color-mix(in srgb, white 5%, transparent),
				transparent 20%
			);
		pointer-events: none;
	}

	.tool-label,
	.tool-pill {
		position: relative;
		z-index: 1;
		font-family: var(--font-mono);
		font-size: 0.64rem;
		letter-spacing: 0.02em;
		line-height: 1;
		-webkit-font-smoothing: antialiased;
		text-rendering: geometricPrecision;
	}

	.tool-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: min(24rem, calc(100vw - 10rem));
		color: color-mix(in srgb, var(--color-boundary-text) 94%, transparent);
		text-shadow: 0 0.5px 0 color-mix(in srgb, var(--color-boundary-background) 72%, transparent);
	}

	.tool-pill {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		width: max-content;
		max-width: inherit;
		min-height: 1.86rem;
		padding: 0.46rem 0.84rem 0.44rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 11%, transparent);
		background:
			radial-gradient(circle at 22% 10%, color-mix(in srgb, white 4%, transparent), transparent 24%),
			linear-gradient(
				180deg,
				color-mix(in srgb, white 3%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 1.35%, transparent) 40%,
				color-mix(in srgb, var(--color-boundary-text) 0.35%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 11%, transparent),
			0 10px 22px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		color: color-mix(in srgb, var(--color-boundary-text) 86%, transparent);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-shadow: 0 0.5px 0 color-mix(in srgb, var(--color-boundary-background) 72%, transparent);
	}

	.tool-pill--history {
		border-color: color-mix(in srgb, var(--color-boundary-text) 9%, transparent);
		color: color-mix(in srgb, var(--color-boundary-text) 78%, transparent);
		background:
			radial-gradient(circle at 22% 10%, color-mix(in srgb, white 3%, transparent), transparent 24%),
			linear-gradient(
				180deg,
				color-mix(in srgb, white 2.25%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 1.05%, transparent) 40%,
				color-mix(in srgb, var(--color-boundary-text) 0.25%, transparent)
			);
	}
</style>
