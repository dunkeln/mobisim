<script lang="ts">
	import { useThrelte } from '@threlte/core';

	type Props = {
		token: string;
	};

	let { token }: Props = $props();

	const { invalidate } = useThrelte();

	$effect(() => {
		token;
		invalidate();
	});
</script>
