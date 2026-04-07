<script lang="ts">
	import { Toaster } from 'svelte-sonner';

	type Props = {
		class?: string;
	};

	let { class: className = '' }: Props = $props();
</script>

<Toaster
	theme="dark"
	position="top-center"
	visibleToasts={4}
	closeButton={false}
	richColors={false}
	offset="24px"
	mobileOffset="16px"
	toastOptions={{
		unstyled: true,
		class:
			'group pointer-events-auto flex w-full items-start gap-3 rounded-[1.35rem] border border-shell-border bg-shell-elevated/96 px-4 py-3 text-sm text-boundary-text shadow-[0_18px_40px_color-mix(in_oklab,var(--color-boundary-background)_56%,black)] backdrop-blur-xl',
		descriptionClass: 'mt-1 text-sm leading-6 text-boundary-text/70',
		actionButtonStyle:
			'background: color-mix(in oklab, var(--color-boundary-text) 92%, white); color: var(--color-boundary-background); border-radius: 9999px; border: 0; padding: 0.35rem 0.7rem; font-size: 0.75rem;',
		cancelButtonStyle:
			'background: transparent; color: color-mix(in oklab, var(--color-boundary-text) 70%, transparent); border-radius: 9999px; border: 1px solid color-mix(in oklab, var(--color-boundary-text) 12%, transparent); padding: 0.35rem 0.7rem; font-size: 0.75rem;'
	}}
	class={className}
/>
