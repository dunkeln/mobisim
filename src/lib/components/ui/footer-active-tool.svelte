<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { footerActiveTool } from '$lib/stores/footer-active-tool';

	type Props = {
		class?: string;
	};

	let { class: className = '' }: Props = $props();
	let root: HTMLDivElement | null = $state(null);
	let expanded = $state(false);
	const activeTool = $derived($footerActiveTool);
	const canExpand = $derived(activeTool.toolLabels.length > 1);

	$effect(() => {
		if (!activeTool.active || activeTool.toolLabels.length === 0) {
			expanded = false;
		}
	});

	function toggleExpanded(): void {
		if (!canExpand) {
			return;
		}

		expanded = !expanded;
	}

	function collapse(): void {
		expanded = false;
	}

	function handleDocumentPointerDown(event: PointerEvent): void {
		if (!expanded || !root) {
			return;
		}

		const target = event.target;
		if (target instanceof Node && root.contains(target)) {
			return;
		}

		collapse();
	}

	const visibleHistory = $derived(
		expanded ? activeTool.toolLabels : activeTool.toolLabels.slice(-1)
	);
</script>

<svelte:document onpointerdown={handleDocumentPointerDown} />

{#if activeTool.active && activeTool.label}
	<div bind:this={root} class="tool-root {className}" aria-live="polite">
		<div class="tool-history" class:tool-history--expanded={expanded}>
			<div
				class="tool-history__scroll"
				in:fade={{ duration: 120 }}
				out:fade={{ duration: 100 }}
			>
				{#each visibleHistory as toolLabel, index (`${toolLabel}-${index}-${expanded ? 'expanded' : 'collapsed'}`)}
					<button
						type="button"
						class="tool-pill"
						class:tool-pill--history={expanded}
						class:tool-pill--ghost={!expanded && index === 0}
						in:fly={{ y: 12, duration: 180 }}
						out:fly={{ y: 10, duration: 140 }}
						onclick={collapse}
					>
						{toolLabel}
					</button>
				{/each}
			</div>
		</div>

		<button
			type="button"
			class="tool-shell"
			class:tool-shell--expandable={canExpand}
			aria-expanded={canExpand ? expanded : undefined}
			aria-label={canExpand ? `Show tool stack for ${activeTool.label}` : activeTool.label}
			onclick={toggleExpanded}
		>
			<div class="tool-label">{activeTool.label}</div>
		</button>
	</div>
{/if}

<style>
	.tool-root {
		position: relative;
		z-index: 1;
		display: inline-flex;
		flex-direction: column;
		align-items: flex-end;
		width: 8.9rem;
		pointer-events: auto;
	}

	.tool-history {
		position: absolute;
		right: 0;
		bottom: 0.9rem;
		width: 8.9rem;
		max-height: 2.2rem;
		pointer-events: auto;
		overflow: visible;
	}

	.tool-history--expanded {
		bottom: calc(100% - 0.55rem);
		max-height: min(10rem, 34vh);
	}

	.tool-history__scroll {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.28rem;
		max-height: inherit;
		overflow-y: hidden;
		padding: 0 0 0.2rem;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--color-boundary-text) 20%, transparent) transparent;
	}

	.tool-history--expanded .tool-history__scroll {
		overflow-y: auto;
		padding: 0.2rem 0 0.8rem;
	}

	.tool-shell {
		position: relative;
		z-index: 1;
		display: inline-flex;
		width: 8.9rem;
		max-width: 8.9rem;
		align-items: center;
		justify-content: center;
		padding: 0.58rem 0.92rem 0.54rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 12%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 4%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2.5%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.75%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 6%, transparent),
			0 10px 24px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		backdrop-filter: blur(16px) saturate(106%);
		-webkit-backdrop-filter: blur(16px) saturate(106%);
		isolation: isolate;
		cursor: default;
	}

	.tool-shell--expandable {
		cursor: pointer;
	}

	.tool-shell::before,
	.tool-pill::before {
		content: '';
		position: absolute;
		inset: 1px;
		border-radius: inherit;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 6%, transparent);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, white 3%, transparent),
				transparent 24%,
				transparent 100%
			),
			radial-gradient(
				110% 70% at 18% 0%,
				color-mix(in srgb, white 3%, transparent),
				transparent 26%
			);
		pointer-events: none;
	}

	.tool-label,
	.tool-pill {
		position: relative;
		z-index: 1;
		font-family: var(--font-mono);
		font-size: 0.66rem;
		letter-spacing: 0.12em;
		line-height: 1;
	}

	.tool-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: color-mix(in srgb, var(--color-boundary-text) 88%, transparent);
	}

	.tool-pill {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 8.9rem;
		min-height: 2rem;
		padding: 0.54rem 0.88rem 0.5rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-boundary-text) 10%, transparent);
		background:
			radial-gradient(circle at 20% 8%, color-mix(in srgb, white 4%, transparent), transparent 28%),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-boundary-text) 2.2%, transparent),
				color-mix(in srgb, var(--color-boundary-text) 0.7%, transparent)
			);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 5%, transparent),
			0 10px 24px color-mix(in srgb, var(--color-boundary-background) 12%, transparent);
		color: color-mix(in srgb, var(--color-boundary-text) 76%, transparent);
		white-space: nowrap;
		cursor: pointer;
	}

	.tool-pill--ghost {
		opacity: 0.38;
		transform: translate(-0.35rem, -0.15rem);
	}

	.tool-pill--history {
		opacity: 0.92;
	}
</style>
