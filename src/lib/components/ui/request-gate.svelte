<script lang="ts">
	import Check from 'lucide-svelte/icons/check';
	import X from 'lucide-svelte/icons/x';
	import { requestGate } from '$lib/stores/request-gate';

	type Props = {
		requestVariable?: string;
		class?: string;
	};

	let { requestVariable = 'request variable', class: className = '' }: Props = $props();

	const HOLD_TO_REJECT_MS = 1500;
	const DRAG_APPROVE_THRESHOLD = 0.82;
	const HOLD_CANCEL_MOVEMENT_PX = 14;
	const TRACK_WIDTH_PX = 316;
	const THUMB_SIZE_PX = 68;
	const TRACK_TRAVEL_PX = TRACK_WIDTH_PX - THUMB_SIZE_PX - 12;

	let gate: HTMLDivElement | undefined = $state();
	let pointerId = $state<number | null>(null);
	let pointerStartX = $state(0);
	let dragStartX = $state(0);
	let holdTimer = $state<number | null>(null);
	let holdTriggered = $state(false);

	$effect(() => {
		requestGate.setRequestVariable(requestVariable);
	});

	const gateState = $derived($requestGate);
	const dragPosition = $derived(gateState.dragPosition);
	const isDragging = $derived(gateState.isDragging);
	const isApproved = $derived(gateState.decision === true);
	const isRejected = $derived(gateState.decision === false);
	const isApprovePathActive = $derived(gateState.isApprovePathActive);
	const progress = $derived(TRACK_TRAVEL_PX === 0 ? 0 : dragPosition / TRACK_TRAVEL_PX);
	const sliderStateClasses = $derived.by(() =>
		isApproved
			? 'border-[color:color-mix(in_srgb,var(--color-boundary-tertiary)_18%,var(--color-boundary-text)_10%)] bg-[radial-gradient(circle_at_20%_8%,color-mix(in_srgb,white_4%,transparent),transparent_28%),linear-gradient(180deg,color-mix(in_srgb,var(--color-boundary-secondary)_4.5%,transparent),color-mix(in_srgb,var(--color-boundary-text)_1.25%,transparent))] text-boundary-text shadow-[inset_0_1px_0_color-mix(in_srgb,white_7%,transparent),inset_0_0_20px_color-mix(in_srgb,var(--color-boundary-secondary)_5%,transparent),0_12px_28px_color-mix(in_srgb,var(--color-boundary-background)_14%,transparent)]'
			: isRejected
				? 'border-[color:color-mix(in_srgb,var(--color-boundary-warning)_22%,var(--color-boundary-text)_10%)] bg-[radial-gradient(circle_at_20%_8%,color-mix(in_srgb,white_4%,transparent),transparent_28%),linear-gradient(180deg,color-mix(in_srgb,var(--color-boundary-warning)_3%,transparent),color-mix(in_srgb,var(--color-boundary-text)_0.8%,transparent))] text-boundary-text shadow-[inset_0_1px_0_color-mix(in_srgb,white_6%,transparent),inset_0_0_16px_color-mix(in_srgb,var(--color-boundary-warning)_4%,transparent),0_12px_28px_color-mix(in_srgb,var(--color-boundary-background)_14%,transparent)]'
				: 'border-[color:color-mix(in_srgb,var(--color-boundary-text)_12%,transparent)] bg-[radial-gradient(circle_at_20%_8%,color-mix(in_srgb,white_4%,transparent),transparent_28%),linear-gradient(180deg,color-mix(in_srgb,var(--color-boundary-text)_2.5%,transparent),color-mix(in_srgb,var(--color-boundary-text)_0.75%,transparent))] text-boundary-text shadow-[inset_0_1px_0_color-mix(in_srgb,white_6%,transparent),0_10px_24px_color-mix(in_srgb,var(--color-boundary-background)_12%,transparent)]'
	);

	const thumbStateClasses = $derived.by(() =>
		isApprovePathActive
			? 'border border-[color:color-mix(in_srgb,var(--color-boundary-tertiary)_62%,white_6%)] bg-[radial-gradient(circle_at_28%_22%,color-mix(in_srgb,white_18%,transparent),transparent_30%),linear-gradient(180deg,color-mix(in_srgb,var(--color-boundary-tertiary)_82%,white_8%),color-mix(in_srgb,var(--color-boundary-tertiary)_70%,var(--color-boundary-background)_10%))] text-[color:color-mix(in_oklab,var(--color-boundary-text)_98%,white)] shadow-[inset_0_1px_0_color-mix(in_srgb,white_18%,transparent),0_14px_28px_color-mix(in_srgb,var(--color-boundary-tertiary)_30%,black)]'
			: 'border border-[color:color-mix(in_srgb,var(--color-boundary-warning)_68%,white_4%)] bg-[radial-gradient(circle_at_28%_22%,color-mix(in_srgb,white_14%,transparent),transparent_30%),linear-gradient(180deg,color-mix(in_srgb,var(--color-boundary-warning)_88%,white_4%),color-mix(in_srgb,var(--color-boundary-warning)_76%,var(--color-boundary-background)_10%))] text-[color:color-mix(in_oklab,var(--color-boundary-text)_98%,white)] shadow-[inset_0_1px_0_color-mix(in_srgb,white_16%,transparent),0_14px_28px_color-mix(in_srgb,var(--color-boundary-warning)_34%,black)]'
	);

	function clearHoldTimer(): void {
		if (holdTimer !== null) {
			window.clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function resetPointerState(): void {
		clearHoldTimer();
		requestGate.endInteraction();
		pointerId = null;
		holdTriggered = false;
	}

	function scheduleRejectHold(): void {
		clearHoldTimer();
		holdTimer = window.setTimeout(() => {
			requestGate.resolveRejected();
			holdTriggered = true;
		}, HOLD_TO_REJECT_MS);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (!gate) {
			return;
		}

		if (gateState.decision === true) {
			requestGate.resetInteraction();
		}

		requestGate.beginInteraction();
		pointerId = event.pointerId;
		pointerStartX = event.clientX;
		dragStartX = dragPosition;
		holdTriggered = false;
		gate.setPointerCapture(event.pointerId);

		if (dragPosition <= 0) {
			scheduleRejectHold();
		}
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!isDragging || event.pointerId !== pointerId) {
			return;
		}

		const deltaX = event.clientX - pointerStartX;
		const nextPosition = Math.min(TRACK_TRAVEL_PX, Math.max(0, dragStartX + deltaX));

		if (Math.abs(deltaX) > HOLD_CANCEL_MOVEMENT_PX || nextPosition > 0) {
			clearHoldTimer();
		}

		requestGate.updateDragPosition(nextPosition);
	}

	function handlePointerEnd(event: PointerEvent): void {
		if (!isDragging || event.pointerId !== pointerId) {
			return;
		}

		if (gate?.hasPointerCapture(event.pointerId)) {
			gate.releasePointerCapture(event.pointerId);
		}

		clearHoldTimer();

		if (holdTriggered) {
			resetPointerState();
			return;
		}

		if (progress >= DRAG_APPROVE_THRESHOLD) {
			requestGate.resolveApproved(TRACK_TRAVEL_PX);
		} else {
			requestGate.resetInteraction();
		}

		resetPointerState();
	}
</script>

{#if gateState.visible}
	<div
		class={[
			'absolute inset-0 z-[80] flex items-center justify-center',
			className
		]}
	>
		<div
			class="absolute inset-0 bg-[color:color-mix(in_srgb,var(--color-boundary-background)_18%,transparent)] backdrop-blur-[1px]"
			aria-hidden="true"
		></div>
		<div class="relative z-[1] flex flex-col items-center gap-3">
			<p
				class="text-[0.72rem] font-medium uppercase tracking-[0.32em] text-boundary-text/72"
			>
				{gateState.requestVariable}
			</p>

			<div
				bind:this={gate}
				class={[
					'relative isolate flex h-22 w-[19.75rem] select-none items-center overflow-hidden rounded-full border px-[0.35rem] py-[0.35rem] backdrop-blur-[16px] transition-[border-color,background-color,box-shadow] duration-300 ease-out',
					sliderStateClasses
				]}
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerEnd}
				onpointercancel={handlePointerEnd}
				role="slider"
				tabindex="0"
				aria-label={`${gateState.requestVariable} approval control`}
				aria-valuemin={0}
				aria-valuemax={1}
				aria-valuenow={isApproved ? 1 : 0}
				aria-valuetext={isApproved ? 'approved' : isRejected ? 'rejected' : 'pending'}
			>
				<div
					class="pointer-events-none absolute inset-[1px] rounded-[calc(9999px-1px)] border border-[color:color-mix(in_srgb,var(--color-boundary-text)_6%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,white_4%,transparent),transparent_18%,transparent_100%),radial-gradient(110%_70%_at_18%_0%,color-mix(in_srgb,white_3%,transparent),transparent_24%)]"
				></div>

				<div class="relative z-[1] flex h-full flex-1 items-center justify-center overflow-hidden"></div>

				<div
					class={[
						'absolute top-1/2 left-[0.35rem] z-[2] flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full transition-[background-color,color,box-shadow] duration-300 ease-out',
						isDragging ? 'duration-0' : 'transition-transform duration-300 ease-out',
						thumbStateClasses
					]}
					style={`transform: translate3d(${dragPosition}px, -50%, 0); will-change: transform;`}
				>
					<div
						class="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,color-mix(in_srgb,white_8%,transparent),color-mix(in_srgb,var(--color-boundary-background)_10%,transparent))]"
					></div>
					{#if isApprovePathActive}
						<Check class="relative z-[1] h-10 w-10" strokeWidth={3.4} />
					{:else}
						<X class="relative z-[1] h-10 w-10" strokeWidth={3.4} />
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
