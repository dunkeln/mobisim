<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children }: { children: import('svelte').Snippet } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="h-dvh overflow-hidden bg-boundary-background text-boundary-text">
	<main class="h-full overflow-hidden">
		<section
			class="grid h-full grid-rows-[auto_1fr_auto] overflow-hidden px-6 py-6 sm:px-10 sm:py-8"
		>
			<header class="flex min-h-10 items-center justify-between gap-4">
				<div class="space-y-1">
					<p class="text-[0.68rem] tracking-[0.28em] text-shell-subtle uppercase">mobisim</p>
					<p class="text-sm text-shell-subtle sm:text-base">
						Single-scene inspection shell with no extra control surfaces.
					</p>
				</div>
				<div class="rounded-full border border-shell-border px-3 py-1 text-[0.68rem] tracking-[0.18em] text-shell-subtle uppercase">
					Viewer Baseline
				</div>
			</header>

			<div class="flex min-h-0 py-6">
				{@render children()}
			</div>

			<footer class="flex min-h-8 items-end justify-between gap-4 pt-4 text-xs text-shell-subtle">
				<p>Current slice: orbit inspection viewport only.</p>
				<p class="tracking-[0.18em] uppercase">Chrome-first</p>
			</footer>
		</section>
	</main>
</div>
