<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import FooterChatbox from '$lib/components/chat/footer-chatbox.svelte';
	import Sonner from '$lib/components/ui/sonner.svelte';

	let { children }: { children: import('svelte').Snippet } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="h-dvh overflow-hidden bg-boundary-background text-boundary-text">
	<main class="h-full overflow-hidden">
		<section
			class="grid h-full grid-rows-[auto_1fr_auto] overflow-hidden px-4 py-4 sm:px-10 sm:py-5"
		>
			<header class="flex min-h-3 items-center justify-between gap-0">
				<div class="space-y-0">
					<p class="text-[0.68rem] tracking-[0.28em] text-shell-subtle lowercase">mobisim</p>
				</div>
			</header>

			<div class="flex min-h-0 py-0">
				{@render children()}
			</div>

			<footer class="flex min-h-8 items-end justify-center gap-4 pt-2 text-xs text-shell-subtle">
				<FooterChatbox />
			</footer>
		</section>
	</main>
	<Sonner />
</div>
