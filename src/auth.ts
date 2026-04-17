import { env } from '$env/dynamic/private';
import { SvelteKitAuth } from '@auth/sveltekit';
import GitHub from '@auth/sveltekit/providers/github';
import Google from '@auth/sveltekit/providers/google';
import CredentialsProvider from '@auth/sveltekit/providers/credentials';

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

function createMockProvider() {
	return CredentialsProvider({
		name: 'Mock Dev',
		credentials: {
			email: { label: 'Email', type: 'text' }
		},
		async authorize() {
			// Auto-authenticate as a dev user when DEV_AUTH=mock
			return {
				id: 'dev-user-id',
				email: 'dev@localhost',
				name: 'Dev User',
				image: null
			};
		}
	});
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
		// Mock dev provider — auto-authenticates when DEV_AUTH=mock
		...(env.DEV_AUTH === 'mock' ? [createMockProvider()] : []),
		// Real OAuth providers (only if credentials are configured)
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
