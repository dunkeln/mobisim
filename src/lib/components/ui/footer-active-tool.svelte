<script lang="ts">
	import { fly } from 'svelte/transition';
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
</script>

<svelte:document onpointerdown={handleDocumentPointerDown} />

{#if activeTool.active && activeTool.label}
	<div bind:this={root} class="tool-root {className}" aria-live="polite">
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

		{#if expanded}
			<div class="tool-stack-sheet" in:fly={{ y: 12, duration: 180 }} out:fly={{ y: 10, duration: 140 }}>
				<div class="tool-stack-scroll">
					{#each activeTool.toolLabels as toolLabel, index (`${activeTool.toolNames[index] ?? toolLabel}-${index}`)}
						<button type="button" class="tool-pill" onclick={collapse}>
							{toolLabel}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.tool-root {
		position: relative;
		z-index: 1;
		display: inline-flex;
		flex-direction: column;
		align-items: flex-end;
		min-width: 0;
		pointer-events: auto;
	}

	.tool-shell {
		position: relative;
		z-index: 1;
		display: inline-flex;
		min-width: 0;
		max-width: min(14rem, calc(100vw - 12rem));
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
	.tool-stack-sheet::before,
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

	.tool-stack-sheet {
		position: absolute;
		right: calc(100% + 0.7rem);
		bottom: 50%;
		width: min(11rem, calc(100vw - 10rem));
		max-height: min(9.5rem, 34vh);
		padding: 0.42rem;
		border-radius: 1rem;
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
		backdrop-filter: blur(16px) saturate(106%);
		-webkit-backdrop-filter: blur(16px) saturate(106%);
		overflow: hidden;
		transform-origin: right bottom;
	}

	.tool-stack-scroll {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.42rem;
		max-height: calc(min(9.5rem, 34vh) - 0.84rem);
		overflow-y: auto;
		padding-right: 0.1rem;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--color-boundary-text) 20%, transparent) transparent;
	}

	.tool-pill {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
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
</style>
