<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import type { ThrelteGltf } from '@threlte/extras';
	import { GLTF, OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import AssetSelectionDropdown from '$lib/components/inspector/asset-selection-dropdown.svelte';
	import CameraConfigReadout from '$lib/components/inspector/camera-config-readout.svelte';
	import LightingControl from '$lib/components/inspector/lighting-control.svelte';
	import type { CameraConfig, Vec3Tuple } from '$lib/components/inspector/types';
	import { normalizeVehicleScene } from '$lib/components/threlte/vehicle-asset';
	import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';

	type Props = {
		assetId: VehicleAssetId;
		assetUrl: string;
		class?: string;
	};
	let { assetId, assetUrl, class: className = '' }: Props = $props();

	const DOT_FADE_RADIUS = 50;
	const DOT_FIELD_PADDING = 12;
	const CAMERA_AZIMUTH_DEG = 40;
	const CAMERA_ELEVATION_DEG = 20;
	const CAMERA_DISTANCE = 9;
	const DEFAULT_CAMERA_FOV = 34;

	let camera = $state<THREE.PerspectiveCamera | undefined>();
	let controls = $state<ThreeOrbitControls | undefined>();
	let modelPosition = $state<Vec3Tuple>([0, 0, 0]);
	let floorY = $state(-0.8);
	let floorSize = $state(18);
	let viewportLightIntensity = $state(1);
	let cameraConfig = $state<CameraConfig | null>(null);
	let loadedScene = $state<THREE.Object3D | undefined>();
	let headlightLightPositions = $state<Vec3Tuple[]>([]);
	let headlightEmitterPositions = $state<Vec3Tuple[]>([]);
	const originalMaterialState = new WeakMap<
		THREE.Material,
		{
			wireframe?: boolean;
			opacity?: number;
			transparent?: boolean;
			side?: THREE.Side;
			color?: THREE.Color;
			emissive?: THREE.Color;
		}
	>();
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
		if (!camera || !controls) return;

		const target: Vec3Tuple = [controls.target.x, controls.target.y, controls.target.z];
		const position: Vec3Tuple = [camera.position.x, camera.position.y, camera.position.z];
		const offsetX = camera.position.x - controls.target.x;
		const offsetY = camera.position.y - controls.target.y;
		const offsetZ = camera.position.z - controls.target.z;
		const horizontalDistance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
		const nextConfig: CameraConfig = {
			position,
			target,
			distance: camera.position.distanceTo(controls.target),
			fov: camera.fov,
			azimuthDegrees: THREE.MathUtils.radToDeg(Math.atan2(offsetX, offsetZ)),
			elevationDegrees: THREE.MathUtils.radToDeg(Math.atan2(offsetY, horizontalDistance))
		};

		cameraConfig = nextConfig;
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
	const HIGHLIGHT_OVERLAY_NAME = '__mobisim-highlight-overlay__';

	function listNodeMaterials(node: THREE.Object3D): THREE.Material[] {
		if (!(node instanceof THREE.Mesh)) {
			return [];
		}

		return Array.isArray(node.material)
			? node.material.filter(Boolean)
			: node.material
				? [node.material]
				: [];
	}

	function hasWireframeProperty(
		material: THREE.Material
	): material is THREE.Material & { wireframe: boolean } {
		return 'wireframe' in material;
	}

	function hasOpacityProperty(material: THREE.Material): material is THREE.Material & {
		opacity: number;
		transparent: boolean;
		side: THREE.Side;
	} {
		return 'opacity' in material && 'transparent' in material && 'side' in material;
	}

	function hasColorProperty(
		material: THREE.Material
	): material is THREE.Material & { color: THREE.Color } {
		return 'color' in material && material.color instanceof THREE.Color;
	}

	function hasEmissiveProperty(
		material: THREE.Material
	): material is THREE.Material & { emissive: THREE.Color } {
		return 'emissive' in material && material.emissive instanceof THREE.Color;
	}

	function snapshotSceneState(scene: THREE.Object3D): void {
		scene.traverse((node) => {
			for (const material of listNodeMaterials(node)) {
				if (originalMaterialState.has(material)) {
					continue;
				}

				originalMaterialState.set(material, {
					wireframe: hasWireframeProperty(material) ? material.wireframe : undefined,
					opacity: hasOpacityProperty(material) ? material.opacity : undefined,
					transparent: hasOpacityProperty(material) ? material.transparent : undefined,
					side: hasOpacityProperty(material) ? material.side : undefined,
					color: hasColorProperty(material) ? material.color.clone() : undefined,
					emissive: hasEmissiveProperty(material) ? material.emissive.clone() : undefined
				});
			}
		});
	}

	function restoreSceneState(scene: THREE.Object3D): void {
		scene.traverse((node) => {
			for (const material of listNodeMaterials(node)) {
				const originalMaterial = originalMaterialState.get(material);
				if (!originalMaterial) {
					continue;
				}

				if (hasWireframeProperty(material) && originalMaterial.wireframe !== undefined) {
					material.wireframe = originalMaterial.wireframe;
				}

				if (hasOpacityProperty(material)) {
					if (originalMaterial.opacity !== undefined) {
						material.opacity = originalMaterial.opacity;
					}

					if (originalMaterial.transparent !== undefined) {
						material.transparent = originalMaterial.transparent;
					}

					if (originalMaterial.side !== undefined) {
						material.side = originalMaterial.side;
					}
				}

				if (hasColorProperty(material) && originalMaterial.color) {
					material.color.copy(originalMaterial.color);
				}

				if (hasEmissiveProperty(material) && originalMaterial.emissive) {
					material.emissive.copy(originalMaterial.emissive);
				}

				material.needsUpdate = true;
			}
		});
	}

	function setSceneWireframe(scene: THREE.Object3D, enabled: boolean): void {
		scene.traverse((node) => {
			for (const material of listNodeMaterials(node)) {
				if (!hasWireframeProperty(material)) {
					continue;
				}

				material.wireframe = enabled;
				material.needsUpdate = true;
			}
		});
	}

	function clearHighlightOverlays(scene: THREE.Object3D): void {
		scene.traverse((node) => {
			const overlays = node.children.filter(
				(child) => child.name === HIGHLIGHT_OVERLAY_NAME && child instanceof THREE.Mesh
			);

			for (const overlay of overlays) {
				node.remove(overlay);
				if (overlay instanceof THREE.Mesh && overlay.material instanceof THREE.Material) {
					overlay.material.dispose();
				} else if (overlay instanceof THREE.Mesh && Array.isArray(overlay.material)) {
					for (const material of overlay.material) {
						material.dispose();
					}
				}
			}
		});
	}

	function addHighlightOverlay(
		node: THREE.Object3D,
		colorFactor: [number, number, number, number]
	): void {
		if (!(node instanceof THREE.Mesh)) {
			return;
		}

		const overlayMaterial = new THREE.MeshBasicMaterial({
			color: new THREE.Color(colorFactor[0] ?? 1, colorFactor[1] ?? 1, colorFactor[2] ?? 1),
			transparent: true,
			opacity: THREE.MathUtils.clamp(colorFactor[3] ?? 0.48, 0.24, 0.68),
			depthWrite: false,
			depthTest: true,
			side: THREE.DoubleSide,
			blending: THREE.NormalBlending,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			polygonOffsetUnits: -2
		});
		overlayMaterial.toneMapped = false;
		const overlayMesh = new THREE.Mesh(node.geometry, overlayMaterial);
		overlayMesh.name = HIGHLIGHT_OVERLAY_NAME;
		overlayMesh.renderOrder = 16;
		overlayMesh.frustumCulled = false;

		const wireframeMaterial = overlayMaterial.clone();
		wireframeMaterial.wireframe = true;
		wireframeMaterial.opacity = Math.min(0.44, overlayMaterial.opacity * 0.9);
		wireframeMaterial.blending = THREE.NormalBlending;
		wireframeMaterial.toneMapped = false;
		const wireframeOverlay = new THREE.Mesh(node.geometry, wireframeMaterial);
		wireframeOverlay.name = HIGHLIGHT_OVERLAY_NAME;
		wireframeOverlay.renderOrder = 17;
		wireframeOverlay.frustumCulled = false;

		node.add(overlayMesh);
		node.add(wireframeOverlay);
	}

	function getMeshCenter(node: THREE.Object3D): Vec3Tuple | null {
		if (!(node instanceof THREE.Mesh)) {
			return null;
		}

		const bounds = new THREE.Box3().setFromObject(node);
		if (bounds.isEmpty()) {
			return null;
		}

		const center = new THREE.Vector3();
		bounds.getCenter(center);
		return [center.x, center.y, center.z];
	}

	function getDerivedHeadlightEmitters(center: THREE.Vector3, size: THREE.Vector3): Vec3Tuple[] {
		const frontZ = center.z + size.z * 0.38;
		const leftX = center.x - size.x * 0.26;
		const rightX = center.x + size.x * 0.26;
		const y = center.y - size.y * 0.08;

		return [
			[leftX, y, frontZ],
			[rightX, y, frontZ]
		];
	}

	function getEffectiveHeadlightEmitters(
		configuredPositions: [number, number, number][] | undefined,
		center: THREE.Vector3,
		size: THREE.Vector3
	): Vec3Tuple[] {
		if (!configuredPositions || configuredPositions.length === 0) {
			return getDerivedHeadlightEmitters(center, size);
		}

		const maxExpectedRadius = Math.max(size.x, size.y, size.z) * 1.35;
		const areConfiguredPositionsPlausible = configuredPositions.every((position) => {
			const deltaX = Math.abs(position[0] - center.x);
			const deltaY = Math.abs(position[1] - center.y);
			const deltaZ = Math.abs(position[2] - center.z);
			return (
				deltaX <= maxExpectedRadius && deltaY <= maxExpectedRadius && deltaZ <= maxExpectedRadius
			);
		});

		return areConfiguredPositionsPlausible
			? configuredPositions.map((position) => [...position] as Vec3Tuple)
			: getDerivedHeadlightEmitters(center, size);
	}

	function applyMaterialPatch(
		scene: THREE.Object3D,
		operation: VehicleInspectionPatchOperation
	): void {
		if (operation.targetType !== 'material' || !operation.targetName) {
			return;
		}

		const nextHeadlightPositions = [...headlightEmitterPositions];

		scene.traverse((node) => {
			for (const material of listNodeMaterials(node)) {
				if (material.name !== operation.targetName) {
					continue;
				}

				switch (operation.op) {
					case 'set_base_color_factor':
						if (Array.isArray(operation.value) && operation.value.length === 4) {
							if (hasColorProperty(material)) {
								const baseColor =
									originalMaterialState.get(material)?.color ?? material.color.clone();
								const tintStrength = THREE.MathUtils.clamp(operation.value[3] ?? 0.4, 0, 1);
								material.color
									.copy(baseColor)
									.lerp(
										new THREE.Color(
											operation.value[0] ?? 1,
											operation.value[1] ?? 1,
											operation.value[2] ?? 1
										),
										tintStrength
									);
							}
						}
						break;
					case 'set_overlay_highlight':
						if (Array.isArray(operation.value) && operation.value.length === 4) {
							addHighlightOverlay(node, [
								operation.value[0] ?? 1,
								operation.value[1] ?? 1,
								operation.value[2] ?? 1,
								operation.value[3] ?? 0.48
							]);
						}
						break;
					case 'set_emissive_factor':
						if (
							Array.isArray(operation.value) &&
							operation.value.length === 3 &&
							hasEmissiveProperty(material)
						) {
							material.emissive.setRGB(
								operation.value[0] ?? 0,
								operation.value[1] ?? 0,
								operation.value[2] ?? 0
							);

							const emissiveMagnitude =
								Math.abs(operation.value[0] ?? 0) +
								Math.abs(operation.value[1] ?? 0) +
								Math.abs(operation.value[2] ?? 0);
							const meshCenter = getMeshCenter(node);
							if (emissiveMagnitude > 0 && nextHeadlightPositions.length === 0 && meshCenter) {
								nextHeadlightPositions.push(meshCenter);
							}
						}
						break;
					case 'set_alpha':
						if (typeof operation.value === 'number' && hasOpacityProperty(material)) {
							material.opacity = operation.value;
							material.transparent = operation.value < 1;
						}
						break;
					case 'set_double_sided':
						if (typeof operation.value === 'boolean' && hasOpacityProperty(material)) {
							material.side = operation.value
								? THREE.DoubleSide
								: (originalMaterialState.get(material)?.side ?? THREE.FrontSide);
						}
						break;
				}

				material.needsUpdate = true;
			}
		});

		if (operation.op === 'set_emissive_factor') {
			headlightLightPositions = nextHeadlightPositions.slice(0, 4);
		}
	}

	function applyViewerPatch(
		scene: THREE.Object3D,
		operation: VehicleInspectionPatchOperation
	): void {
		if (operation.targetType !== 'viewer') {
			return;
		}

		if (operation.targetId === 'wireframe' && operation.op === 'set_enabled') {
			setSceneWireframe(scene, operation.value === true);
		}
	}

	function applyPatchOperations(
		scene: THREE.Object3D,
		operations: VehicleInspectionPatchOperation[]
	): void {
		snapshotSceneState(scene);
		restoreSceneState(scene);
		clearHighlightOverlays(scene);
		headlightLightPositions = [];

		for (const operation of operations) {
			switch (operation.targetType) {
				case 'material':
					applyMaterialPatch(scene, operation);
					break;
				case 'viewer':
					applyViewerPatch(scene, operation);
					break;
			}
		}
	}

	function frameVehicle(gltf: ThrelteGltf): void {
		loadedScene = gltf.scene;

		const { size, center } = normalizeVehicleScene(gltf.scene);
		headlightEmitterPositions = getEffectiveHeadlightEmitters(
			VEHICLE_CATALOG[assetId].headlightEmitterPositions,
			center,
			size
		);

		modelPosition = [-center.x, -center.y, -center.z];
		cameraPosition = getCameraPresetPosition();
		floorY = -(size.y / 2) - 0.04;
		floorSize = Math.max(Math.max(size.x, size.z) + DOT_FIELD_PADDING, DOT_FADE_RADIUS * 2 + 4);

		if (camera) {
			camera.fov = DEFAULT_CAMERA_FOV;
			camera.updateProjectionMatrix();
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
		currentControls.addEventListener('change', emitCameraConfig);

		return () => {
			currentControls.removeEventListener('change', emitCameraConfig);
		};
	});

	$effect(() => {
		const patchState = $vehiclePatchState;

		if (!loadedScene || patchState.assetId !== assetId) {
			return;
		}

		applyPatchOperations(loadedScene, patchState.operations);
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
		class="relative h-full min-h-0 w-full overflow-hidden rounded-4xl border border-[color:color-mix(in_oklab,var(--color-boundary-text)_9%,transparent)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-boundary-background)_74%,black),color-mix(in_oklab,var(--color-boundary-background)_94%,black)_100%)] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_6%,transparent),inset_0_-18px_36px_color-mix(in_oklab,var(--color-boundary-background)_68%,black)]"
	>
		<div
			class="pointer-events-none absolute inset-[1px] rounded-[calc(2rem-1px)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-boundary-text)_3%,transparent),transparent_14%,transparent_84%,color-mix(in_oklab,var(--color-boundary-background)_24%,black))]"
		></div>
		<div
			class="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklab,var(--color-boundary-text)_3%,transparent),transparent_18%,transparent_50%)]"
		></div>
		<div class="pointer-events-none absolute inset-0 z-20">
			<div class="pointer-events-auto absolute top-4 left-4 sm:top-5 sm:left-6">
				<AssetSelectionDropdown />
			</div>
			<div class="pointer-events-auto absolute top-4 right-4 sm:top-5 sm:right-6">
				<CameraConfigReadout config={cameraConfig} moving={false} />
			</div>
			<div class="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 sm:top-5">
				<LightingControl bind:value={viewportLightIntensity} />
			</div>
		</div>
		<div class="h-full min-h-0 w-full overflow-hidden rounded-[inherit]">
			<Canvas>
				<T.PerspectiveCamera
					bind:ref={camera}
					makeDefault
					position={cameraPosition}
					fov={DEFAULT_CAMERA_FOV}
				>
					<OrbitControls
						bind:ref={controls}
						enablePan={false}
						enableDamping
						minDistance={4}
						maxDistance={200}
					/>
				</T.PerspectiveCamera>
				<T.AmbientLight intensity={1.15 * viewportLightIntensity} />
				<T.HemisphereLight args={['#e8ecf3', '#08090c', 1.2 * viewportLightIntensity]} />
				<T.DirectionalLight position={[6, 9, 5]} intensity={2.1 * viewportLightIntensity} />
				<T.DirectionalLight position={[-4, 3, -5]} intensity={0.45 * viewportLightIntensity} />
				<T.Mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY + 0.003, 0]}>
					<T.CircleGeometry args={[floorSize / 2, 160]} />
					<T is={floorDotMaterial} />
				</T.Mesh>
				{#key assetUrl}
					<T.Group position={modelPosition}>
						{#each headlightLightPositions as position, index (`${position[0]}:${position[1]}:${position[2]}:${index}`)}
							<T.PointLight {position} intensity={7.5} distance={14} decay={2} color="#f4efdf" />
						{/each}
						<GLTF url={assetUrl} onload={frameVehicle} />
					</T.Group>
				{/key}
			</Canvas>
		</div>
	</div>
</div>
