import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

function hasGitHubAuthConfig(): boolean {
	const hasClientId = Boolean(env.AUTH_GITHUB_ID ?? env.GITHUB_CLIENT_ID);
	const hasClientSecret = Boolean(env.AUTH_GITHUB_SECRET ?? env.GITHUB_CLIENT_SECRET);
	const hasAuthSecret = Boolean(env.AUTH_SECRET ?? env.BETTER_AUTH_SECRET);
	return hasClientId && hasClientSecret && hasAuthSecret;
}

function hasGoogleAuthConfig(): boolean {
	const hasClientId = Boolean(env.AUTH_GOOGLE_ID ?? env.GOOGLE_CLIENT_ID);
	const hasClientSecret = Boolean(env.AUTH_GOOGLE_SECRET ?? env.GOOGLE_CLIENT_SECRET);
	const hasAuthSecret = Boolean(env.AUTH_SECRET ?? env.BETTER_AUTH_SECRET);
	return hasClientId && hasClientSecret && hasAuthSecret;
}

export const load: LayoutServerLoad = async (event) => {
	const session = await event.locals.auth();

	return {
		session,
		authConfigured: hasGitHubAuthConfig() || hasGoogleAuthConfig(),
		githubAuthConfigured: hasGitHubAuthConfig(),
		googleAuthConfigured: hasGoogleAuthConfig()
	};
};
