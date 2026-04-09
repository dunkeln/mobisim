<script lang="ts">
	import GitHubAuthGate from '$lib/components/auth/github-auth-gate.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="relative h-full overflow-hidden">
	<GitHubAuthGate
		authConfigured={data.authConfigured}
		githubConfigured={data.githubAuthConfigured}
		googleConfigured={data.googleAuthConfigured}
	/>
</div>
