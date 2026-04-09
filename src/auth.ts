import { env } from '$env/dynamic/private';
import { SvelteKitAuth } from '@auth/sveltekit';
import GitHub from '@auth/sveltekit/providers/github';
import Google from '@auth/sveltekit/providers/google';

function resolveAuthSecret(): string {
	return env.AUTH_SECRET ?? env.BETTER_AUTH_SECRET ?? '';
}

function resolveGitHubClientId(): string {
	return env.AUTH_GITHUB_ID ?? env.GITHUB_CLIENT_ID ?? '';
}

function resolveGitHubClientSecret(): string {
	return env.AUTH_GITHUB_SECRET ?? env.GITHUB_CLIENT_SECRET ?? '';
}

function resolveGoogleClientId(): string {
	return env.AUTH_GOOGLE_ID ?? env.GOOGLE_CLIENT_ID ?? '';
}

function resolveGoogleClientSecret(): string {
	return env.AUTH_GOOGLE_SECRET ?? env.GOOGLE_CLIENT_SECRET ?? '';
}

function hasGitHubProviderConfig(): boolean {
	return Boolean(resolveGitHubClientId() && resolveGitHubClientSecret());
}

function hasGoogleProviderConfig(): boolean {
	return Boolean(resolveGoogleClientId() && resolveGoogleClientSecret());
}

export const { handle, signIn, signOut } = SvelteKitAuth({
	trustHost:
		env.AUTH_TRUST_HOST === 'true' ||
		env.AUTH_TRUST_HOST === '1' ||
		env.NODE_ENV !== 'production',
	secret: resolveAuthSecret(),
	pages: {
		signIn: '/signin',
		error: '/signin'
	},
	providers: [
		...(hasGitHubProviderConfig()
			? [
					GitHub({
						clientId: resolveGitHubClientId(),
						clientSecret: resolveGitHubClientSecret()
					})
				]
			: []),
		...(hasGoogleProviderConfig()
			? [
					Google({
						clientId: resolveGoogleClientId(),
						clientSecret: resolveGoogleClientSecret()
					})
				]
			: [])
	]
});
