<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import type { ThrelteGltf } from '@threlte/extras';
	import { GLTF, OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import type { CameraConfig, Vec3Tuple } from '$lib/components/inspector/types';
	import { normalizeVehicleScene } from '$lib/components/threlte/vehicle-asset';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		assetId: VehicleAssetId;
		assetUrl: string;
		class?: string;
		lightIntensity?: number;
		onCameraChange?: (config: CameraConfig) => void;
	};
	let {
		assetId,
		assetUrl,
		class: className = '',
		lightIntensity = 1,
		onCameraChange
	}: Props = $props();

	const DOT_FADE_RADIUS = 50;
	const DOT_FIELD_PADDING = 12;
	const CAMERA_AZIMUTH_DEG = 40;
	const CAMERA_ELEVATION_DEG = 20;
	const CAMERA_DISTANCE = 9;

	let camera = $state<THREE.PerspectiveCamera | undefined>();
	let controls = $state<ThreeOrbitControls | undefined>();
	let modelPosition = $state<Vec3Tuple>([0, 0, 0]);
	let floorY = $state(-0.8);
	let floorSize = $state(18);
	const floorDotMaterial = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms: {
			uFloorSize: { value: 18 },
			uFadeRadius: { value: DOT_FADE_RADIUS }
		},
		vertexShader: `
			varying vec2 vWorldXZ;

			void main() {
				vec4 worldPosition = modelMatrix * vec4(position, 1.0);
				vWorldXZ = worldPosition.xz;
				gl_Position = projectionMatrix * viewMatrix * worldPosition;
			}
		`,
		fragmentShader: `
			precision highp float;

			varying vec2 vWorldXZ;
			uniform float uFloorSize;
			uniform float uFadeRadius;

			void main() {
				float radialDistance = length(vWorldXZ);
				if (radialDistance >= uFadeRadius) discard;

				float normalizedDistance = clamp(radialDistance / max(uFadeRadius, 0.001), 0.0, 1.0);
				float fade = exp(-8.5 * normalizedDistance * normalizedDistance);

				float gridScale = mix(3.2, 1.15, normalizedDistance);
				vec2 gridUv = fract(vWorldXZ * gridScale);
				vec2 centeredUv = gridUv - 0.5;
				float dotRadius = mix(0.0075, 0.0018, normalizedDistance);
				float distToDot = length(centeredUv);
				float aa = max(fwidth(distToDot), 0.0018);
				float dotMask = 1.0 - smoothstep(dotRadius - aa, dotRadius + aa, distToDot);
				float alpha = dotMask * fade * 0.42;

				if (alpha <= 0.001) discard;

				gl_FragColor = vec4(vec3(1.0), alpha);
			}
		`
	});

	$effect(() => {
		floorDotMaterial.uniforms.uFloorSize.value = floorSize;
	});

	function emitCameraConfig(): void {
		if (!camera || !controls || !onCameraChange) return;

		const target: Vec3Tuple = [controls.target.x, controls.target.y, controls.target.z];
		const position: Vec3Tuple = [camera.position.x, camera.position.y, camera.position.z];

		onCameraChange({
			position,
			target,
			distance: camera.position.distanceTo(controls.target),
			fov: camera.fov
		});
	}

	function getCameraPresetPosition(): Vec3Tuple {
		const azimuthRadians = THREE.MathUtils.degToRad(CAMERA_AZIMUTH_DEG);
		const elevationRadians = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG);
		const horizontalRadius = CAMERA_DISTANCE * Math.cos(elevationRadians);
		const y = CAMERA_DISTANCE * Math.sin(elevationRadians);
		const x = horizontalRadius * Math.sin(azimuthRadians);
		const z = horizontalRadius * Math.cos(azimuthRadians);

		return [x, y, z];
	}

	let cameraPosition = $state<Vec3Tuple>(getCameraPresetPosition());

	function enforceOpaqueExterior(scene: THREE.Object3D): void {
		scene.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;

			const materials = Array.isArray(child.material) ? child.material : [child.material];

			for (const material of materials) {
				if (!material) continue;

				material.transparent = false;
				material.opacity = 1;
				material.alphaTest = 0;
				material.depthWrite = true;
				material.depthTest = true;
				material.side = THREE.FrontSide;

				if ('transmission' in material) {
					material.transmission = 0;
				}

				if ('clearcoat' in material && material.clearcoat < 0) {
					material.clearcoat = 0;
				}

				material.needsUpdate = true;
			}
		});
	}

	function frameVehicle(gltf: ThrelteGltf): void {
		enforceOpaqueExterior(gltf.scene);

		const { size, center } = normalizeVehicleScene(gltf.scene, assetId);

		modelPosition = [-center.x, -center.y, -center.z];
		cameraPosition = getCameraPresetPosition();
		floorY = -(size.y / 2) - 0.04;
		floorSize = Math.max(Math.max(size.x, size.z) + DOT_FIELD_PADDING, DOT_FADE_RADIUS * 2 + 4);

		if (camera) {
			camera.position.set(...cameraPosition);
			camera.lookAt(0, 0, 0);
		}

		if (controls) {
			controls.target.set(0, 0, 0);
			controls.update();
		}

		emitCameraConfig();
	}

	$effect(() => {
		if (!camera || !controls) return;
		const currentControls = controls;

		const syncCameraConfig = () => {
			emitCameraConfig();
		};

		currentControls.addEventListener('change', syncCameraConfig);
		syncCameraConfig();

		return () => {
			currentControls.removeEventListener('change', syncCameraConfig);
		};
	});
</script>

<div
	class={[
		'relative h-full min-h-0 w-full overflow-visible rounded-4xl',
		'drop-shadow-[0_18px_30px_color-mix(in_oklab,var(--color-boundary-background)_16%,black)]',
		'drop-shadow-[0_4px_10px_color-mix(in_oklab,var(--color-boundary-background)_10%,black)]',
		className
	]}
>
	<div
		class="relative h-full min-h-0 w-full overflow-hidden rounded-[2rem] border border-[color:color-mix(in_oklab,var(--color-boundary-text)_9%,transparent)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-boundary-background)_74%,black),color-mix(in_oklab,var(--color-boundary-background)_94%,black)_100%)] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_6%,transparent),inset_0_-18px_36px_color-mix(in_oklab,var(--color-boundary-background)_68%,black)]"
	>
		<div
			class="pointer-events-none absolute inset-[1px] rounded-[calc(2rem-1px)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-boundary-text)_3%,transparent),transparent_14%,transparent_84%,color-mix(in_oklab,var(--color-boundary-background)_24%,black))]"
		></div>
		<div
			class="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklab,var(--color-boundary-text)_3%,transparent),transparent_18%,transparent_50%)]"
		></div>
		<div class="h-full min-h-0 w-full overflow-hidden rounded-[inherit]">
			<Canvas>
				<T.PerspectiveCamera bind:ref={camera} makeDefault position={cameraPosition} fov={34}>
					<OrbitControls
						bind:ref={controls}
						enablePan={false}
						enableDamping
						minDistance={4}
						maxDistance={200}
					/>
				</T.PerspectiveCamera>
				<T.AmbientLight intensity={1.15 * lightIntensity} />
				<T.HemisphereLight args={['#e8ecf3', '#08090c', 1.2 * lightIntensity]} />
				<T.DirectionalLight position={[6, 9, 5]} intensity={2.1 * lightIntensity} />
				<T.DirectionalLight position={[-4, 3, -5]} intensity={0.45 * lightIntensity} />
				<T.Mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY + 0.003, 0]}>
					<T.CircleGeometry args={[floorSize / 2, 160]} />
					<T is={floorDotMaterial} />
				</T.Mesh>
				<T.Group position={modelPosition}>
					<GLTF url={assetUrl} onload={frameVehicle} />
				</T.Group>
			</Canvas>
		</div>
	</div>
</div>
