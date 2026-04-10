<script lang="ts">
	import { signOut } from '@auth/sveltekit/client';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	const repositoryUrl = 'https://github.com/dunkeln/mobisim';
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
		<div class="flex items-center gap-2.5">
			<a
				href={repositoryUrl}
				target="_blank"
				rel="noreferrer"
				class="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-shell-subtle transition hover:bg-white/[0.08] hover:text-white"
				aria-label="Open GitHub repository"
				title="Open GitHub repository"
			>
				<svg
					viewBox="0 0 24 24"
					aria-hidden="true"
					class="h-3.5 w-3.5 fill-current"
				>
					<path
						d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.9.58.1.79-.25.79-.56 0-.28-.01-1.2-.02-2.17-3.2.69-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.9 10.9 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.41-2.69 5.39-5.25 5.67.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.11 0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
					/>
				</svg>
			</a>
			<div class="space-y-0">
				<p class="text-[0.68rem] tracking-[0.28em] text-white/82 lowercase">mobisim</p>
			</div>
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
