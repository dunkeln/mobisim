export function resolveAuthenticatedUserId(session: unknown): string | null {
	if (!session || typeof session !== 'object') {
		return null;
	}

	const user =
		'user' in session && session.user && typeof session.user === 'object'
			? (session.user as Record<string, unknown>)
			: null;

	if (!user) {
		return null;
	}

	const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
	if (email) {
		return `email:${email}`;
	}

	const id =
		typeof user.id === 'string'
			? user.id.trim()
			: typeof user.sub === 'string'
				? user.sub.trim()
				: '';
	if (id) {
		return `id:${id}`;
	}

	const name = typeof user.name === 'string' ? user.name.trim().toLowerCase() : '';
	return name ? `name:${name}` : null;
}
