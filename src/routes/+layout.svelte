<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children }: { children: import('svelte').Snippet } = $props();
	const faviconVersion = '2026-04-09-elliptic-ring-1';
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={`${favicon}?v=${faviconVersion}`} />
</svelte:head>

<div class="h-dvh overflow-hidden bg-boundary-background text-boundary-text">
	<main class="h-full overflow-hidden">
		{@render children()}
	</main>
</div>
