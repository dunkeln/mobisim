<script lang="ts">
	import Slider from '$lib/components/ui/slider.svelte';

	type Props = {
		value?: number;
		class?: string;
	};

	let { value = $bindable(1), class: className = '' }: Props = $props();
</script>

<section
	class={[
		'w-[min(18rem,100%)] rounded-[1.5rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_10%,transparent)]',
		'bg-[color:color-mix(in_oklab,var(--color-boundary-background)_78%,black)] px-4 py-4',
		'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_4%,transparent),0_14px_28px_color-mix(in_oklab,var(--color-boundary-background)_28%,black)]',
		'backdrop-blur',
		className
	]}
>
	<Slider bind:value label="Lighting" id="lighting-control" />
</section>
