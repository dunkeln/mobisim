<script lang="ts">
	import { page } from '$app/state';
	import { signIn } from '@auth/sveltekit/client';
	import { goto } from '$app/navigation';
	import { GitBranch, Globe, LockKeyhole, Code } from 'lucide-svelte';
	import FooterOrb from '$lib/components/ui/footer-orb.svelte';

	type Props = {
		authConfigured: boolean;
		githubConfigured: boolean;
		googleConfigured: boolean;
		devConfigured?: boolean;
	};

	let { authConfigured, githubConfigured, googleConfigured, devConfigured = false }: Props = $props();
	let pendingProvider = $state<'github' | 'google' | 'dev' | null>(null);
	const authError = $derived(page.url.searchParams.get('error'));

	function describeAuthError(error: string | null): string | null {
		switch (error) {
			case 'OAuthSignin':
			case 'OAuthCallback':
			case 'Callback':
				return 'OAuth sign-in could not complete. Check that the provider callback URL matches the exact app origin.';
			case 'Configuration':
				return 'Authentication is configured incorrectly. Recheck the GitHub OAuth client and local auth environment.';
			case 'AccessDenied':
				return 'GitHub denied the sign-in request for this app.';
			case 'Verification':
				return 'The sign-in session expired before it could complete. Try again.';
			default:
				return error ? 'Authentication could not be completed for this session.' : null;
		}
	}

	async function handleProviderSignIn(provider: 'github' | 'google' | 'dev'): Promise<void> {
		const providerReady =
			provider === 'github'
				? githubConfigured
				: provider === 'google'
					? googleConfigured
					: provider === 'dev'
						? devConfigured
						: false;

		if (!providerReady || pendingProvider) {
			return;
		}

		pendingProvider = provider;
		try {
			if (provider === 'dev') {
				// Dev auth is handled by the layout — just navigate to /app
				await goto('/app');
			} else {
				await signIn(provider, { redirectTo: '/app' });
			}
		} finally {
			pendingProvider = null;
		}
	}
</script>

<div class="flex min-h-dvh w-full bg-black text-white">
	<section class="flex w-full flex-col lg:w-1/2">
		<div class="flex items-center gap-2 px-6 py-6 text-sm font-medium text-white sm:px-8">
			<div
				class="flex h-6 w-6 items-center justify-center rounded-md border border-white/12 bg-white/6"
			>
				<LockKeyhole class="h-3.5 w-3.5" />
			</div>
			<span>mobisim</span>
		</div>

		<div class="flex flex-1 items-center justify-center px-6 py-10 sm:px-8">
			<div class="w-full max-w-sm space-y-6">
				<div class="space-y-2 text-center">
					<h1 class="text-3xl font-semibold tracking-tight text-white">Login to your account</h1>
					<p class="text-sm text-white/55">Continue with your connected provider</p>
				</div>

				{#if describeAuthError(authError)}
					<div
						class="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100"
					>
						{describeAuthError(authError)}
					</div>
				{/if}

				{#if authConfigured}
					<div class="space-y-3">
						{#if googleConfigured}
							<button
								type="button"
								class="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/12 bg-white px-4 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
								disabled={pendingProvider !== null}
								onclick={() => void handleProviderSignIn('google')}
							>
								<Globe class="h-4 w-4" />
								<span>{pendingProvider === 'google' ? 'Connecting to Google' : 'Login with Google'}</span>
							</button>
						{/if}

						{#if githubConfigured}
							<button
								type="button"
								class="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/12 bg-transparent px-4 text-sm font-medium text-white transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
								disabled={pendingProvider !== null}
								onclick={() => void handleProviderSignIn('github')}
							>
								<GitBranch class="h-4 w-4" />
								<span>{pendingProvider === 'github' ? 'Connecting to GitHub' : 'Login with GitHub'}</span>
							</button>
						{/if}

						{#if devConfigured}
							<button
								type="button"
								class="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-yellow-500/25 bg-yellow-500/10 px-4 text-sm font-medium text-yellow-100 transition hover:bg-yellow-500/[0.15] disabled:cursor-not-allowed disabled:opacity-60"
								disabled={pendingProvider !== null}
								onclick={() => void handleProviderSignIn('dev')}
								title="Dev-only auth bypass (DEV_AUTH=mock)"
							>
								<Code class="h-4 w-4" />
								<span>{pendingProvider === 'dev' ? 'Entering as Dev' : 'Login with Dev'}</span>
							</button>
						{/if}
					</div>
				{:else}
					<div
						class="rounded-lg border border-white/12 bg-white/[0.03] px-4 py-3 text-sm text-white/62"
					>
						OAuth is not configured yet. Add <code>AUTH_SECRET</code> and at least one provider:
						<code>AUTH_GITHUB_ID</code>/<code>AUTH_GITHUB_SECRET</code> or
						<code>AUTH_GOOGLE_ID</code>/<code>AUTH_GOOGLE_SECRET</code>.
					</div>
				{/if}
			</div>
		</div>
	</section>

	<aside class="relative hidden border-l border-white/8 bg-black lg:block lg:w-1/2">
		<div class="absolute inset-0 flex items-center justify-center">
			<div class="pointer-events-none flex items-center justify-center">
				<FooterOrb class="shadow-none" size={280} interactive={false} />
			</div>
		</div>
	</aside>
</div>
