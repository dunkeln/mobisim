<script lang="ts">
	type Props = {
		method: string;
		path: string;
		closeToast?: () => void;
	};

	let { method, path }: Props = $props();
</script>

<div class="rest-request-toast">
	<p class="rest-request-toast__title">
		<span class="rest-request-toast__method">{method}</span>
		<span>request API</span>
	</p>
	<p class="rest-request-toast__path">{path}</p>
</div>

<style>
	.rest-request-toast {
		display: grid;
		gap: 0.18rem;
	}

	.rest-request-toast__title {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.25;
		color: var(--boundary-text);
	}

	.rest-request-toast__method {
		color: var(--boundary-warning);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.rest-request-toast__path {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: color-mix(in oklab, var(--boundary-text) 72%, transparent);
		word-break: break-all;
	}
</style>
