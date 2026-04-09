<script lang="ts">
	import { signOut } from '@auth/sveltekit/client';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	let accountMenuOpen = $state(false);
	let accountMenuButton = $state<HTMLButtonElement | null>(null);
	let accountMenuPanel = $state<HTMLDivElement | null>(null);
	const avatarLabel = $derived(data.session?.user?.name ?? data.session?.user?.email ?? 'signed in');
	const avatarInitials = $derived.by(() => {
		const label = avatarLabel.trim();
		if (!label) {
			return 'U';
		}

		const segments = label
			.split(/[\s@._-]+/)
			.map((segment) => segment.trim())
			.filter(Boolean);
		if (segments.length === 0) {
			return label.slice(0, 1).toUpperCase();
		}

		return segments
			.slice(0, 2)
			.map((segment) => segment[0]?.toUpperCase() ?? '')
			.join('');
	});

	$effect(() => {
		if (!accountMenuOpen) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (accountMenuButton?.contains(target) || accountMenuPanel?.contains(target)) {
				return;
			}

			accountMenuOpen = false;
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				accountMenuOpen = false;
			}
		};

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleEscape);

		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleEscape);
		};
	});
</script>

<section class="grid h-full grid-rows-[auto_1fr] overflow-hidden px-4 py-4 sm:px-10 sm:py-5">
	<header class="flex min-h-3 items-center justify-between gap-0">
		<div class="space-y-0">
			<p class="text-[0.68rem] tracking-[0.28em] text-shell-subtle lowercase">mobisim</p>
		</div>
		<div class="relative">
			<button
				bind:this={accountMenuButton}
				type="button"
				class="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.04] text-[0.7rem] font-medium text-white/78 transition hover:bg-white/[0.08] hover:text-white"
				title={avatarLabel}
				aria-label={avatarLabel}
				aria-haspopup="menu"
				aria-expanded={accountMenuOpen}
				onclick={() => {
					accountMenuOpen = !accountMenuOpen;
				}}
			>
				{#if data.session?.user?.image}
					<img
						src={data.session.user.image}
						alt={avatarLabel}
						class="h-full w-full object-cover"
					/>
				{:else}
					<span>{avatarInitials}</span>
				{/if}
			</button>

			{#if accountMenuOpen}
				<div
					bind:this={accountMenuPanel}
					class="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#111]/95 p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.45)] backdrop-blur-md"
					role="menu"
				>
					<div class="rounded-lg px-3 py-2.5">
						<p class="truncate text-sm font-medium text-white">{avatarLabel}</p>
						<p class="truncate text-xs text-white/45">
							{data.session?.user?.email ?? 'authenticated session'}
						</p>
					</div>
					<button
						type="button"
						class="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-white/78 transition hover:bg-white/[0.06] hover:text-white"
						role="menuitem"
						onclick={() => void signOut({ redirectTo: '/signin' })}
					>
						Log out
					</button>
				</div>
			{/if}
		</div>
	</header>

	<div class="relative flex min-h-0 py-0">
		<div class="flex min-h-0 flex-1">
			{@render children()}
		</div>
	</div>
	<!-- Footer temporarily disabled while the in-canvas footer blueprint is active. -->
</section>
