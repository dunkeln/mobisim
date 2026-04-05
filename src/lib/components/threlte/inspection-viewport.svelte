<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import { OrbitControls } from '@threlte/extras';

	type Props = {
		class?: string;
	};

	let { class: className = '' }: Props = $props();
</script>

<div class={['h-full w-full min-h-0', className]}>
	<div
		class="relative h-full overflow-hidden rounded-[2rem] border border-shell-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-shell-elevated)_88%,transparent),color-mix(in_oklab,var(--color-shell)_92%,black))] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-shell-foreground)_8%,transparent),0_24px_80px_color-mix(in_oklab,var(--color-boundary-background)_62%,black)]"
	>
		<div
			class="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--color-shell-primary)_22%,transparent),transparent_72%)]"
		></div>
		<div
			class="pointer-events-none absolute inset-y-12 left-0 w-40 bg-[radial-gradient(circle_at_left,color-mix(in_oklab,var(--color-shell-secondary)_14%,transparent),transparent_74%)]"
		></div>
		<div
			class="pointer-events-none absolute inset-y-10 right-0 w-48 bg-[radial-gradient(circle_at_right,color-mix(in_oklab,var(--color-shell-primary)_18%,transparent),transparent_72%)]"
		></div>

		<div class="absolute inset-x-4 top-4 z-10 flex items-start justify-between gap-4 sm:inset-x-6">
			<div class="space-y-2">
				<p class="text-[0.65rem] tracking-[0.26em] text-shell-subtle uppercase">inspection viewport</p>
				<p class="max-w-sm text-sm leading-6 text-shell-subtle">
					The dark/default Tailwind 4 surface tokens now drive the viewer shell instead of raw one-off colors.
				</p>
			</div>

			<div
				class="rounded-full border border-shell-border bg-[color-mix(in_oklab,var(--color-shell-elevated)_80%,transparent)] px-3 py-1 text-[0.65rem] tracking-[0.22em] text-shell-subtle uppercase backdrop-blur"
			>
				dark shell
			</div>
		</div>

		<div class="h-full w-full pt-20">
			<Canvas>
				<T.Color attach="background" args={['#0a0a0c']} />
				<T.PerspectiveCamera makeDefault position={[5, 3.5, 7]} fov={34} />

				<T.AmbientLight intensity={1.15} />
				<T.HemisphereLight args={['#e8ecf3', '#08090c', 1.2]} />
				<T.DirectionalLight position={[6, 9, 5]} intensity={2.1} />
				<T.DirectionalLight position={[-4, 3, -5]} intensity={0.45} />

				<T.Group position={[0, -0.1, 0]}>
					<T.Mesh position={[0, 0.6, 0]}>
						<T.BoxGeometry args={[3.8, 0.72, 1.65]} />
						<T.MeshStandardMaterial color="#8e939c" metalness={0.72} roughness={0.28} />
					</T.Mesh>

					<T.Mesh position={[0, 1.18, 0.05]}>
						<T.BoxGeometry args={[2.15, 0.72, 1.42]} />
						<T.MeshStandardMaterial color="#b0b4bd" metalness={0.7} roughness={0.24} />
					</T.Mesh>

					<T.Mesh position={[0, 0.78, 0.88]}>
						<T.BoxGeometry args={[3.1, 0.28, 0.12]} />
						<T.MeshStandardMaterial color="#14161a" metalness={0.24} roughness={0.78} />
					</T.Mesh>

					<T.Mesh position={[0, 0.78, -0.88]}>
						<T.BoxGeometry args={[3.1, 0.28, 0.12]} />
						<T.MeshStandardMaterial color="#14161a" metalness={0.24} roughness={0.78} />
					</T.Mesh>

					<T.Mesh position={[1.28, 0.18, 0.86]} rotation={[Math.PI / 2, 0, 0]}>
						<T.TorusGeometry args={[0.44, 0.18, 20, 42]} />
						<T.MeshStandardMaterial color="#0f1013" metalness={0.12} roughness={0.9} />
					</T.Mesh>

					<T.Mesh position={[-1.28, 0.18, 0.86]} rotation={[Math.PI / 2, 0, 0]}>
						<T.TorusGeometry args={[0.44, 0.18, 20, 42]} />
						<T.MeshStandardMaterial color="#0f1013" metalness={0.12} roughness={0.9} />
					</T.Mesh>

					<T.Mesh position={[1.28, 0.18, -0.86]} rotation={[Math.PI / 2, 0, 0]}>
						<T.TorusGeometry args={[0.44, 0.18, 20, 42]} />
						<T.MeshStandardMaterial color="#0f1013" metalness={0.12} roughness={0.9} />
					</T.Mesh>

					<T.Mesh position={[-1.28, 0.18, -0.86]} rotation={[Math.PI / 2, 0, 0]}>
						<T.TorusGeometry args={[0.44, 0.18, 20, 42]} />
						<T.MeshStandardMaterial color="#0f1013" metalness={0.12} roughness={0.9} />
					</T.Mesh>
				</T.Group>

				<T.Mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.38, 0]}>
					<T.CircleGeometry args={[8, 64]} />
					<T.MeshStandardMaterial color="#131419" metalness={0.14} roughness={0.96} />
				</T.Mesh>

				<OrbitControls
					enablePan={false}
					enableDamping
					minDistance={4.5}
					maxDistance={10}
					maxPolarAngle={Math.PI / 1.85}
				/>
			</Canvas>
		</div>
	</div>
</div>
