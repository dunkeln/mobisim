<script lang="ts">
	import { signOut } from '@auth/sveltekit/client';
	import { Carousel, CarouselContent, CarouselItem } from '$lib/components/ui/carousel/index.js';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context.js';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	const repositoryUrl = 'https://github.com/dunkeln/mobisim';
	let accountMenuOpen = $state(false);
	let accountMenuButton = $state<HTMLButtonElement | null>(null);
	let accountMenuPanel = $state<HTMLDivElement | null>(null);
	let faqOpen = $state(false);
	let faqPanel = $state<HTMLDivElement | null>(null);
	let faqCarouselApi = $state<CarouselAPI | undefined>(undefined);
	let faqSlideIndex = $state(0);
	const avatarLabel = $derived(
		data.session?.user?.name ?? data.session?.user?.email ?? 'signed in'
	);
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
	const faqSlides = [
		'overview',
		'friday',
		'selection',
		'semantic-groups',
		'presentation',
		'isolation',
		'viewer-modes'
	] as const;

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

	$effect(() => {
		const handleOpenFaq = () => {
			faqOpen = true;
		};

		window.addEventListener('mobisim:open-faq', handleOpenFaq);

		return () => {
			window.removeEventListener('mobisim:open-faq', handleOpenFaq);
		};
	});

	$effect(() => {
		if (!faqOpen) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (faqPanel?.contains(target)) {
				return;
			}

			faqOpen = false;
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				faqOpen = false;
				return;
			}

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				faqCarouselApi?.scrollPrev();
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				faqCarouselApi?.scrollNext();
			}
		};

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleEscape);

		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleEscape);
		};
	});

	$effect(() => {
		if (!faqCarouselApi) {
			return;
		}

		const syncSelectedSlide = () => {
			faqSlideIndex = faqCarouselApi?.selectedScrollSnap() ?? 0;
		};

		syncSelectedSlide();
		faqCarouselApi.on('select', syncSelectedSlide);
		faqCarouselApi.on('reInit', syncSelectedSlide);

		return () => {
			faqCarouselApi?.off('select', syncSelectedSlide);
			faqCarouselApi?.off('reInit', syncSelectedSlide);
		};
	});
</script>

<section class="grid h-full grid-rows-[auto_1fr] overflow-hidden px-4 py-4 sm:px-10 sm:py-5">
	<header class="flex min-h-3 items-center justify-between gap-0">
		<div class="flex min-w-0 flex-nowrap items-center gap-4">
			<a
				href={repositoryUrl}
				target="_blank"
				rel="noreferrer"
				class="inline-flex shrink-0 items-center justify-center text-white/58 transition hover:text-white/82"
				aria-label="Open GitHub repository"
				title="Open GitHub repository"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true" class="h-3.5 w-3.5 fill-current">
					<path
						d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.9.58.1.79-.25.79-.56 0-.28-.01-1.2-.02-2.17-3.2.69-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.9 10.9 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.41-2.69 5.39-5.25 5.67.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.11 0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
					/>
				</svg>
			</a>
			<div class="shrink-0 space-y-0">
				<p class="text-[0.72rem] font-semibold tracking-[0.28em] text-white/90 lowercase">
					mobisim
				</p>
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
					<img src={data.session.user.image} alt={avatarLabel} class="h-full w-full object-cover" />
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

{#if faqOpen}
	<div
		class="fixed inset-0 z-30 bg-[radial-gradient(circle_at_top,rgba(128,206,215,0.12),transparent_32%),linear-gradient(180deg,rgba(6,6,10,0.22),rgba(6,6,10,0.68))] backdrop-blur-[10px]"
	></div>
	<div class="fixed inset-0 z-40 flex items-center justify-center p-4">
		<div
			bind:this={faqPanel}
			class="relative w-[70vw] max-w-[70vw] overflow-visible text-boundary-text outline-none focus:outline-none focus-visible:outline-none"
			role="dialog"
			aria-modal="true"
			aria-label="FAQ"
			tabindex="-1"
		>
			<div class="flex flex-col items-center gap-4">
				<Carousel
					class="w-full"
					setApi={(api) => {
						faqCarouselApi = api;
					}}
					opts={{
						align: 'center',
						containScroll: 'trimSnaps',
						slidesToScroll: 1,
						dragFree: false,
						skipSnaps: false,
						dragThreshold: 24,
						duration: 20
					}}
				>
					<CarouselContent>
						<!-- 01 — Overview -->
						<CarouselItem>
							<div
								class="mx-auto grid h-[80vh] max-h-[80vh] w-full grid-cols-[58%_42%] gap-6 overflow-hidden rounded-[1.9rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.06)_40%,rgba(255,255,255,0.03))] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-[30px] [backdrop-filter:blur(30px)_saturate(150%)] [-webkit-backdrop-filter:blur(30px)_saturate(150%)]"
							>
								<div class="min-h-0 overflow-hidden rounded-2xl">
									<img
										src="/examples/original.png"
										alt="Audi R8 in the Mobisim inspection viewport"
										class="h-full w-full object-cover"
									/>
								</div>
								<div class="flex max-w-[32rem] flex-col justify-start pt-1 pr-5">
									<p class="font-mono text-[0.63rem] tracking-[0.22em] text-white/32 uppercase">
										Overview
									</p>
									<h2
										class="mt-2 text-[2.45rem] leading-[0.94] font-semibold tracking-[-0.05em] text-white/94"
									>
										Mobisim
									</h2>
									<div class="mt-5 space-y-4">
										<p class="text-[1.22rem] leading-[1.7] tracking-[0.006em] text-white/62">
											<span class="block text-white/82"
												>A Chrome-first 3D vehicle inspection workspace.</span
											>
											<span class="block">Built around GLB assets.</span>
											<span class="mt-2 block">Load a vehicle. Orbit it cleanly.</span>
											<span class="block"
												>Use FRIDAY with language that stays grounded in the live model.</span
											>
										</p>
										<p class="text-[1.08rem] leading-[1.72] tracking-[0.005em] text-white/50">
											<span class="block"
												>Realistic materials, controlled lighting, stable reflections.</span
											>
											<span class="block">No plugins. No wrappers. No setup drift.</span>
											<span class="mt-2 block"
												>Open it in Chrome and begin with the asset already in front of you.</span
											>
										</p>
									</div>
								</div>
							</div>
						</CarouselItem>

						<!-- 02 — FRIDAY -->
						<CarouselItem>
							<div
								class="mx-auto grid h-[80vh] max-h-[80vh] w-full grid-cols-[58%_42%] gap-6 overflow-hidden rounded-[1.9rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.06)_40%,rgba(255,255,255,0.03))] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-[30px] [backdrop-filter:blur(30px)_saturate(150%)] [-webkit-backdrop-filter:blur(30px)_saturate(150%)]"
							>
								<div class="min-h-0 overflow-hidden rounded-2xl">
									<img
										src="/examples/model%20highlight.png"
										alt="FRIDAY highlighting the front face of the vehicle"
										class="h-full w-full object-cover"
									/>
								</div>
								<div class="flex max-w-[32rem] flex-col justify-start pt-1 pr-5">
									<p class="font-mono text-[0.63rem] tracking-[0.22em] text-white/32 uppercase">
										Copilot
									</p>
									<h2
										class="mt-2 text-[2.45rem] leading-[0.94] font-semibold tracking-[-0.05em] text-white/94"
									>
										FRIDAY
									</h2>
									<div class="mt-5 space-y-4">
										<p class="text-[1.22rem] leading-[1.7] tracking-[0.006em] text-white/62">
											<span class="block text-white/82">FRIDAY is the inspection copilot.</span>
											<span class="block">Scoped strictly to the active vehicle.</span>
											<span class="mt-2 block"
												>It handles selection-aware edits, semantic grouping, material changes,</span
											>
											<span class="block"
												>and concise summaries grounded in the scene you actually have.</span
											>
										</p>
										<p class="text-[1.08rem] leading-[1.72] tracking-[0.005em] text-white/50">
											<span class="block">Ask what is selected. Resolve a part by region.</span>
											<span class="block">Trace the nodes behind the front lighting assembly.</span>
											<span class="mt-2 block"
												>If the request is ambiguous or out of scope, it fails closed.</span
											>
										</p>
									</div>
								</div>
							</div>
						</CarouselItem>

						<!-- 03 — Selection & Grounding -->
						<CarouselItem>
							<div
								class="mx-auto grid h-[80vh] max-h-[80vh] w-full grid-cols-[58%_42%] gap-6 overflow-hidden rounded-[1.9rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.06)_40%,rgba(255,255,255,0.03))] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-[30px] [backdrop-filter:blur(30px)_saturate(150%)] [-webkit-backdrop-filter:blur(30px)_saturate(150%)]"
							>
								<div class="min-h-0 overflow-hidden rounded-2xl">
									<img
										src="/examples/user%20highlight.png"
										alt="User-selected body shell highlighted in the viewport"
										class="h-full w-full object-cover"
									/>
								</div>
								<div class="flex max-w-[32rem] flex-col justify-start pt-1 pr-5">
									<p class="font-mono text-[0.63rem] tracking-[0.22em] text-white/32 uppercase">
										Interaction
									</p>
									<h2
										class="mt-2 text-[2.3rem] leading-[0.92] font-semibold tracking-[-0.05em] text-white/94"
									>
										<span class="block">Selection</span>
										<span class="block">& Grounding</span>
									</h2>
									<div class="mt-5 space-y-4">
										<p class="text-[1.22rem] leading-[1.7] tracking-[0.006em] text-white/62">
											<span class="block text-white/82"
												>Click any visible surface to ground the next request.</span
											>
											<span class="block">No exact node names required.</span>
											<span class="mt-2 block"
												>FRIDAY treats <span class="font-mono text-white/72">"this"</span>,
												<span class="font-mono text-white/72">"that"</span>,
												<span class="font-mono text-white/72">"it"</span>, and
												<span class="font-mono text-white/72">"them"</span></span
											>
											<span class="block"
												>as direct references to whatever is currently active in scene.</span
											>
										</p>
										<p class="text-[1.08rem] leading-[1.72] tracking-[0.005em] text-white/50">
											<span class="block"
												>Selection is asset-scoped, immediate, and visible in context.</span
											>
											<span class="block"
												>Expand to the parent node. Collapse to a precise part.</span
											>
											<span class="mt-2 block"
												>Promote straight into a semantic group without breaking flow.</span
											>
										</p>
									</div>
								</div>
							</div>
						</CarouselItem>

						<!-- 04 — Semantic Groups -->
						<CarouselItem>
							<div
								class="mx-auto grid h-[80vh] max-h-[80vh] w-full grid-cols-[34%_66%] gap-8 overflow-hidden rounded-[1.9rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.06)_40%,rgba(255,255,255,0.03))] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-[30px] [backdrop-filter:blur(30px)_saturate(150%)] [-webkit-backdrop-filter:blur(30px)_saturate(150%)]"
							>
								<div class="min-h-0 overflow-hidden rounded-2xl border border-white/8 bg-black/20">
									<img
										src="/examples/semantic%20grouping.png"
										alt="Semantic group panel listing body shell, wheels, front lighting, and other groups"
										class="h-full w-full object-cover object-center"
									/>
								</div>
								<div class="flex max-w-[38rem] flex-col justify-between pt-1 pr-5">
									<div>
										<p class="font-mono text-[0.63rem] tracking-[0.22em] text-white/32 uppercase">
											Semantics
										</p>
										<h2
											class="mt-2 text-[2.3rem] leading-[0.92] font-semibold tracking-[-0.05em] text-white/94"
										>
											<span class="block">Semantic</span>
											<span class="block">Groups</span>
										</h2>
										<div class="mt-5 space-y-4">
											<p class="text-[1.22rem] leading-[1.7] tracking-[0.006em] text-white/62">
												<span class="block text-white/82"
													>Semantic groups are derived from the GLB structure.</span
												>
												<span class="block">Generated during the overlay pass.</span>
												<span class="mt-2 block"
													>That vocabulary lets natural language map to stable clusters of nodes</span
												>
												<span class="block">instead of brittle raw mesh names.</span>
											</p>
											<p class="text-[1.08rem] leading-[1.72] tracking-[0.005em] text-white/50">
												<span class="block"
													>Groups persist across sessions and stay editable in place.</span
												>
												<span class="block">Assign or unassign through the current selection.</span>
												<span class="mt-2 block"
													>The overlay updates immediately and remains FRIDAY’s authoritative truth.</span
												>
											</p>
										</div>
									</div>
								</div>
							</div>
						</CarouselItem>

						<!-- 05 — Presentation Controls -->
						<CarouselItem>
							<div
								class="mx-auto grid h-[80vh] max-h-[80vh] w-full grid-cols-[58%_42%] gap-6 overflow-hidden rounded-[1.9rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.06)_40%,rgba(255,255,255,0.03))] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-[30px] [backdrop-filter:blur(30px)_saturate(150%)] [-webkit-backdrop-filter:blur(30px)_saturate(150%)]"
							>
								<div class="flex min-h-0 flex-col gap-3">
									<div class="min-h-0 flex-[5] overflow-hidden rounded-2xl">
										<img
											src="/examples/color%20change.png"
											alt="Paint applied to the vehicle shell"
											class="h-full w-full object-cover"
										/>
									</div>
									<div class="min-h-0 flex-[4] overflow-hidden rounded-2xl">
										<img
											src="/examples/headlights.png"
											alt="Headlights active on the vehicle front"
											class="h-full w-full object-cover"
										/>
									</div>
								</div>
								<div class="flex max-w-[32rem] flex-col justify-start pt-1 pr-5">
									<p class="font-mono text-[0.63rem] tracking-[0.22em] text-white/32 uppercase">
										Controls
									</p>
									<h2
										class="mt-2 text-[2.3rem] leading-[0.92] font-semibold tracking-[-0.05em] text-white/94"
									>
										<span class="block">Presentation</span>
										<span class="block">Controls</span>
									</h2>
									<div class="mt-5 space-y-4">
										<p class="text-[1.22rem] leading-[1.7] tracking-[0.006em] text-white/62">
											<span class="block text-white/82"
												>Paint the shell. Toggle headlights. Tint the glass.</span
											>
											<span class="block">Highlight a region. Isolate a group.</span>
											<span class="mt-2 block"
												>Every change lands through deterministic patch operations</span
											>
											<span class="block"
												>so the viewport state always matches the command history.</span
											>
										</p>
										<p class="text-[1.08rem] leading-[1.72] tracking-[0.005em] text-white/50">
											<span class="block">Nothing is baked into the asset.</span>
											<span class="block">Each edit is reversible or clearable in one pass.</span>
											<span class="mt-2 block"
												>Type it, click it, or speak it through the voice orb.</span
											>
										</p>
									</div>
								</div>
							</div>
						</CarouselItem>

						<!-- 06 — Part Isolation -->
						<CarouselItem>
							<div
								class="mx-auto grid h-[80vh] max-h-[80vh] w-full grid-cols-[58%_42%] gap-6 overflow-hidden rounded-[1.9rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.06)_40%,rgba(255,255,255,0.03))] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-[30px] [backdrop-filter:blur(30px)_saturate(150%)] [-webkit-backdrop-filter:blur(30px)_saturate(150%)]"
							>
								<div class="min-h-0 overflow-hidden rounded-2xl">
									<img
										src="/examples/isolation.png"
										alt="Wheels isolated while the rest of the vehicle is ghosted"
										class="h-full w-full object-cover"
									/>
								</div>
								<div class="flex max-w-[32rem] flex-col justify-start pt-1 pr-5">
									<p class="font-mono text-[0.63rem] tracking-[0.22em] text-white/32 uppercase">
										Focus
									</p>
									<h2
										class="mt-2 text-[2.3rem] leading-[0.92] font-semibold tracking-[-0.05em] text-white/94"
									>
										<span class="block">Part</span>
										<span class="block">Isolation</span>
									</h2>
									<div class="mt-5 space-y-4">
										<p class="text-[1.22rem] leading-[1.7] tracking-[0.006em] text-white/62">
											<span class="block text-white/82"
												>Isolate any semantic group or selected part.</span
											>
											<span class="block">Everything else falls into a ghost state.</span>
											<span class="mt-2 block"
												>The target gets an unobstructed read from any angle</span
											>
											<span class="block">while the body still preserves spatial reference.</span>
										</p>
										<p class="text-[1.08rem] leading-[1.72] tracking-[0.005em] text-white/50">
											<span class="block">Context is dimmed, not erased.</span>
											<span class="block">Ask to restore and the full model returns as it was.</span
											>
											<span class="mt-2 block"
												>Isolation works on overlay groups and custom groups alike.</span
											>
										</p>
									</div>
								</div>
							</div>
						</CarouselItem>

						<!-- 07 — Viewer Modes -->
						<CarouselItem>
							<div
								class="mx-auto flex h-[80vh] max-h-[80vh] w-full flex-col gap-5 overflow-hidden rounded-[1.9rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.06)_40%,rgba(255,255,255,0.03))] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur-[30px] [backdrop-filter:blur(30px)_saturate(150%)] [-webkit-backdrop-filter:blur(30px)_saturate(150%)]"
							>
								<div class="max-w-[38rem] shrink-0 pr-5">
									<p class="font-mono text-[0.63rem] tracking-[0.22em] text-white/32 uppercase">
										Debug
									</p>
									<h2
										class="mt-2 text-[2.2rem] leading-[0.92] font-semibold tracking-[-0.05em] text-white/94"
									>
										<span class="block">Viewer</span>
										<span class="block">Modes</span>
									</h2>
									<div class="mt-4 max-w-[34rem] space-y-4">
										<p class="text-[1.22rem] leading-[1.7] tracking-[0.006em] text-white/62">
											<span class="block text-white/82"
												>Switch into wireframe, UV debug, or X-ray.</span
											>
											<span class="block"
												>Read mesh topology, texture layout, or translucent structure.</span
											>
										</p>
										<p class="text-[1.08rem] leading-[1.72] tracking-[0.005em] text-white/50">
											<span class="block"
												>Each mode toggles cleanly through FRIDAY or a direct command.</span
											>
											<span class="block">The rest of the inspection session stays intact.</span>
										</p>
									</div>
								</div>
								<div class="grid min-h-0 flex-1 grid-cols-3 gap-3">
									<div class="flex flex-col gap-2 overflow-hidden">
										<div class="min-h-0 flex-1 overflow-hidden rounded-2xl">
											<img
												src="/examples/wireframe.png"
												alt="Wireframe viewer mode showing mesh topology"
												class="h-full w-full object-cover"
											/>
										</div>
										<p
											class="shrink-0 text-center font-mono text-[0.62rem] tracking-[0.15em] text-white/30 uppercase"
										>
											Wireframe
										</p>
									</div>
									<div class="flex flex-col gap-2 overflow-hidden">
										<div class="min-h-0 flex-1 overflow-hidden rounded-2xl">
											<img
												src="/examples/uv%20debug.png"
												alt="UV debug viewer mode showing texture unwrap"
												class="h-full w-full object-cover"
											/>
										</div>
										<p
											class="shrink-0 text-center font-mono text-[0.62rem] tracking-[0.15em] text-white/30 uppercase"
										>
											UV Debug
										</p>
									</div>
									<div class="flex flex-col gap-2 overflow-hidden">
										<div class="min-h-0 flex-1 overflow-hidden rounded-2xl">
											<img
												src="/examples/xray.png"
												alt="X-ray viewer mode showing translucent vehicle structure"
												class="h-full w-full object-cover"
											/>
										</div>
										<p
											class="shrink-0 text-center font-mono text-[0.62rem] tracking-[0.15em] text-white/30 uppercase"
										>
											X-Ray
										</p>
									</div>
								</div>
							</div>
						</CarouselItem>
					</CarouselContent>
				</Carousel>
				<div class="flex items-center justify-center gap-2.5" aria-label="FAQ slide position">
					{#each faqSlides as _, dotIndex}
						<div
							class={`rounded-full transition-all duration-200 ${
								dotIndex === faqSlideIndex ? 'h-1.5 w-6 bg-white/74' : 'h-1.5 w-1.5 bg-white/28'
							}`}
						></div>
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}
