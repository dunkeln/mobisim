<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import type { ThrelteGltf } from '@threlte/extras';
	import { GLTF, OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import AssetSelectionDropdown from '$lib/components/inspector/asset-selection-dropdown.svelte';
	import CameraConfigReadout from '$lib/components/inspector/camera-config-readout.svelte';
	import InspectorSidebar from '$lib/components/inspector/inspector-sidebar.svelte';
	import LightingControl from '$lib/components/inspector/lighting-control.svelte';
	import type { CameraConfig, Vec3Tuple } from '$lib/components/inspector/types';
	import ViewportRenderInvalidator from '$lib/components/threlte/viewport-render-invalidator.svelte';
	import ViewportFooterBlueprint from '$lib/components/ui/viewport-footer-blueprint.svelte';
	import Sonner from '$lib/components/ui/sonner.svelte';
	import {
		buildRuntimeNodeLookup,
		buildRuntimeNodePath,
		resolveRuntimeSelection
	} from '$lib/components/threlte/runtime-selection';
	import { normalizeVehicleScene } from '$lib/components/threlte/vehicle-asset';
	import type { VehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
	import type { VehicleSemanticOverlayStatus } from '$lib/server/connectors/vehicle-semantic-overlay/types';
	import { vehicleNodeSelection } from '$lib/stores/vehicle-node-selection';
	import { vehiclePatchState } from '$lib/stores/vehicle-patches';
	import type { VehicleAssetId } from '$lib/vehicles/catalog';

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
	const CAMERA_DISTANCE = 12.7;
	const DEFAULT_CAMERA_FOV = 34;
	const XRAY_OPACITY = 0.18;
	const SELECTION_CLICK_DRAG_THRESHOLD = 8;
	const SELECTION_HIGHLIGHT_FACTOR: [number, number, number, number] = [0.95, 0.79, 0.42, 0.94];

	let camera = $state<THREE.PerspectiveCamera | undefined>();
	let controls = $state<ThreeOrbitControls | undefined>();
	let canvasHost = $state<HTMLDivElement | undefined>();
	let selectionPointerDown = $state<{
		x: number;
		y: number;
		pointerId: number;
		additive: boolean;
	} | null>(null);
	let modelPosition = $state<Vec3Tuple>([0, 0, 0]);
	let floorY = $state(-0.8);
	let floorSize = $state(18);
	let viewportLightIntensity = $state(1);
	let cameraConfig = $state<CameraConfig | null>(null);
	let semanticOverlayStatus = $state<VehicleSemanticOverlayStatus>('unknown');
	let loadedScene = $state<THREE.Object3D | undefined>();
	const originalNodeState = new WeakMap<
		THREE.Object3D,
		{
			visible: boolean;
			position: Vec3Tuple;
		}
	>();
	const originalMeshMaterialState = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
	const originalMaterialState = new WeakMap<
		THREE.Material,
		{
			wireframe?: boolean;
			opacity?: number;
			transparent?: boolean;
			side?: THREE.Side;
			depthWrite?: boolean;
			color?: THREE.Color;
			emissive?: THREE.Color;
			emissiveIntensity?: number;
			transmission?: number;
			thickness?: number;
			roughness?: number;
			metalness?: number;
			envMapIntensity?: number;
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
	const SELECTION_OVERLAY_NAME = '__mobisim-selection-overlay__';
	const semanticOverlayLabel = $derived.by(() => {
		switch (semanticOverlayStatus) {
			case 'fresh':
				return 'Semantic overlay ready';
			case 'stale':
				return 'Semantic overlay stale';
			case 'missing':
				return 'Semantic overlay missing';
			default:
				return 'Semantic overlay status unknown';
		}
	});
	const semanticDotClasses = $derived.by(() => {
		switch (semanticOverlayStatus) {
			case 'fresh':
				return 'bg-[#62f2a2] shadow-[0_0_0_1px_rgba(98,242,162,0.18),0_0_16px_rgba(98,242,162,0.88),0_0_28px_rgba(98,242,162,0.42)]';
			case 'stale':
				return 'bg-boundary-secondary shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-boundary-secondary)_24%,transparent),0_0_12px_color-mix(in_oklab,var(--color-boundary-secondary)_46%,transparent)]';
			case 'missing':
				return 'bg-boundary-warning shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-boundary-warning)_24%,transparent),0_0_12px_color-mix(in_oklab,var(--color-boundary-warning)_34%,transparent)]';
			default:
				return 'bg-boundary-text/28 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-boundary-text)_12%,transparent)]';
		}
	});
	const scopedSelectionRenderToken = $derived.by(() =>
		$vehicleNodeSelection
			.filter((selection) => selection.assetId === assetId)
			.map((selection) =>
				[
					selection.nodeId,
					selection.nodeName,
					selection.nodePath,
					typeof selection.materialIndex === 'number' ? selection.materialIndex : 'none',
					selection.materialName ?? ''
				].join(':')
			)
			.sort((left, right) => left.localeCompare(right))
			.join('|')
	);
	const viewportRenderToken = $derived.by(() => {
		const patchRevision = $vehiclePatchState.assetId === assetId ? $vehiclePatchState.revision : 0;
		return [assetId, assetUrl, patchRevision, scopedSelectionRenderToken].join('::');
	});
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

	function hasEmissiveIntensityProperty(material: THREE.Material): material is THREE.Material & {
		emissiveIntensity: number;
	} {
		return 'emissiveIntensity' in material;
	}

	function hasTransmissionProperty(material: THREE.Material): material is THREE.Material & {
		transmission: number;
		thickness: number;
		roughness: number;
	} {
		return 'transmission' in material && 'thickness' in material && 'roughness' in material;
	}

	function hasFinishProperty(material: THREE.Material): material is THREE.Material & {
		roughness: number;
		metalness: number;
		envMapIntensity: number;
	} {
		return 'roughness' in material && 'metalness' in material && 'envMapIntensity' in material;
	}

	function snapshotSceneState(scene: THREE.Object3D): void {
		scene.traverse((node) => {
			if (!originalNodeState.has(node)) {
				originalNodeState.set(node, {
					visible: node.visible,
					position: [node.position.x, node.position.y, node.position.z]
				});
			}

			if (node instanceof THREE.Mesh && !originalMeshMaterialState.has(node)) {
				originalMeshMaterialState.set(node, node.material);
			}

			for (const material of listNodeMaterials(node)) {
				if (originalMaterialState.has(material)) {
					continue;
				}

				originalMaterialState.set(material, {
					wireframe: hasWireframeProperty(material) ? material.wireframe : undefined,
					opacity: hasOpacityProperty(material) ? material.opacity : undefined,
					transparent: hasOpacityProperty(material) ? material.transparent : undefined,
					side: hasOpacityProperty(material) ? material.side : undefined,
					depthWrite: 'depthWrite' in material ? material.depthWrite : undefined,
					color: hasColorProperty(material) ? material.color.clone() : undefined,
					emissive: hasEmissiveProperty(material) ? material.emissive.clone() : undefined,
					emissiveIntensity: hasEmissiveIntensityProperty(material)
						? material.emissiveIntensity
						: undefined,
					transmission: hasTransmissionProperty(material) ? material.transmission : undefined,
					thickness: hasTransmissionProperty(material) ? material.thickness : undefined,
					roughness:
						hasTransmissionProperty(material) || hasFinishProperty(material)
							? material.roughness
							: undefined,
					metalness: hasFinishProperty(material) ? material.metalness : undefined,
					envMapIntensity: hasFinishProperty(material) ? material.envMapIntensity : undefined
				});
			}
		});
	}

	function restoreSceneState(scene: THREE.Object3D): void {
		scene.traverse((node) => {
			const originalNode = originalNodeState.get(node);
			if (originalNode) {
				node.visible = originalNode.visible;
				node.position.set(...originalNode.position);
			}

			if (node instanceof THREE.Mesh) {
				const originalMeshMaterial = originalMeshMaterialState.get(node);
				if (originalMeshMaterial && node.material !== originalMeshMaterial) {
					for (const material of listNodeMaterials(node)) {
						if (!originalMaterialState.has(material)) {
							material.dispose();
						}
					}

					node.material = originalMeshMaterial;
				}
			}

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

					if (originalMaterial.depthWrite !== undefined && 'depthWrite' in material) {
						material.depthWrite = originalMaterial.depthWrite;
					}
				}

				if (hasColorProperty(material) && originalMaterial.color) {
					material.color.copy(originalMaterial.color);
				}

				if (hasEmissiveProperty(material) && originalMaterial.emissive) {
					material.emissive.copy(originalMaterial.emissive);
				}

				if (
					hasEmissiveIntensityProperty(material) &&
					originalMaterial.emissiveIntensity !== undefined
				) {
					material.emissiveIntensity = originalMaterial.emissiveIntensity;
				}

				if (hasTransmissionProperty(material)) {
					if (originalMaterial.transmission !== undefined) {
						material.transmission = originalMaterial.transmission;
					}

					if (originalMaterial.thickness !== undefined) {
						material.thickness = originalMaterial.thickness;
					}

					if (originalMaterial.roughness !== undefined) {
						material.roughness = originalMaterial.roughness;
					}
				}

				if (hasFinishProperty(material)) {
					if (originalMaterial.roughness !== undefined) {
						material.roughness = originalMaterial.roughness;
					}

					if (originalMaterial.metalness !== undefined) {
						material.metalness = originalMaterial.metalness;
					}

					if (originalMaterial.envMapIntensity !== undefined) {
						material.envMapIntensity = originalMaterial.envMapIntensity;
					}
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

	function setSceneXray(scene: THREE.Object3D, enabled: boolean): void {
		scene.traverse((node) => {
			for (const material of listNodeMaterials(node)) {
				if (!hasOpacityProperty(material) || !enabled) {
					continue;
				}

				material.opacity = Math.min(material.opacity, XRAY_OPACITY);
				material.transparent = true;
				material.side = THREE.DoubleSide;
				if ('depthWrite' in material) {
					material.depthWrite = false;
				}
				material.needsUpdate = true;
			}
		});
	}

	function createUvDebugMaterial(sourceMaterial: THREE.Material): THREE.Material {
		if (sourceMaterial instanceof THREE.ShaderMaterial) {
			return new THREE.MeshBasicMaterial({
				color: new THREE.Color(0.95, 0.1, 0.62),
				wireframe: true,
				toneMapped: false
			});
		}

		return new THREE.ShaderMaterial({
			side: hasOpacityProperty(sourceMaterial) ? sourceMaterial.side : THREE.DoubleSide,
			transparent: false,
			depthWrite: true,
			toneMapped: false,
			vertexShader: `
				varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				varying vec2 vUv;

				float gridLine(float value) {
					float scaled = abs(fract(value * 10.0) - 0.5);
					return 1.0 - smoothstep(0.46, 0.5, scaled);
				}

				void main() {
					vec2 uv = fract(vUv);
					float grid = max(gridLine(uv.x), gridLine(uv.y));
					vec3 uvColor = vec3(uv.x, uv.y, 1.0 - max(uv.x, uv.y) * 0.6);
					vec3 gridColor = mix(uvColor, vec3(1.0), grid * 0.55);
					gl_FragColor = vec4(gridColor, 1.0);
				}
			`
		});
	}

	function setSceneUvDebug(scene: THREE.Object3D, enabled: boolean): void {
		scene.traverse((node) => {
			if (!(node instanceof THREE.Mesh)) {
				return;
			}

			const originalMeshMaterial = originalMeshMaterialState.get(node) ?? node.material;
			if (!enabled) {
				node.material = originalMeshMaterial;
				return;
			}

			if (!node.geometry.getAttribute('uv')) {
				node.material = new THREE.MeshBasicMaterial({
					color: new THREE.Color(0.92, 0.24, 0.56),
					wireframe: true,
					toneMapped: false
				});
				return;
			}

			node.material = Array.isArray(originalMeshMaterial)
				? originalMeshMaterial.map((material) => createUvDebugMaterial(material))
				: createUvDebugMaterial(originalMeshMaterial);
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

	function createInvisibleOverlayMaterial(): THREE.MeshBasicMaterial {
		const material = new THREE.MeshBasicMaterial({
			transparent: true,
			opacity: 0,
			depthWrite: false,
			depthTest: false,
			colorWrite: false
		});
		material.toneMapped = false;
		return material;
	}

	function addHighlightOverlay(
		node: THREE.Object3D,
		colorFactor: [number, number, number, number],
		overlayName: string = HIGHLIGHT_OVERLAY_NAME,
		selectedMaterialIndex?: number
	): void {
		if (!(node instanceof THREE.Mesh)) {
			return;
		}

		const baseOverlayMaterial = new THREE.MeshBasicMaterial({
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
		baseOverlayMaterial.toneMapped = false;
		const overlayMaterial =
			Array.isArray(node.material) && Number.isInteger(selectedMaterialIndex)
				? node.material.map((_, index) =>
						index === selectedMaterialIndex
							? baseOverlayMaterial.clone()
							: createInvisibleOverlayMaterial()
					)
				: baseOverlayMaterial;
		const overlayMesh = new THREE.Mesh(node.geometry, overlayMaterial);
		overlayMesh.name = overlayName;
		overlayMesh.renderOrder = 16;
		overlayMesh.frustumCulled = false;

		const createWireframeMaterial = (
			material: THREE.MeshBasicMaterial
		): THREE.MeshBasicMaterial => {
			const wireframeMaterial = material.clone();
			wireframeMaterial.wireframe = true;
			wireframeMaterial.opacity = Math.min(0.44, material.opacity * 0.9);
			wireframeMaterial.blending = THREE.NormalBlending;
			wireframeMaterial.toneMapped = false;
			return wireframeMaterial;
		};
		const wireframeMaterial = Array.isArray(overlayMaterial)
			? overlayMaterial.map((material) =>
					material.opacity > 0
						? createWireframeMaterial(material)
						: createInvisibleOverlayMaterial()
				)
			: createWireframeMaterial(overlayMaterial);
		const wireframeOverlay = new THREE.Mesh(node.geometry, wireframeMaterial);
		wireframeOverlay.name = overlayName;
		wireframeOverlay.renderOrder = 17;
		wireframeOverlay.frustumCulled = false;

		node.add(overlayMesh);
		node.add(wireframeOverlay);
	}

	function clearSelectionOverlays(scene: THREE.Object3D): void {
		scene.traverse((node) => {
			const overlays = node.children.filter(
				(child) => child.name === SELECTION_OVERLAY_NAME && child instanceof THREE.Mesh
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

	function handleViewportPointerDown(event: PointerEvent): void {
		selectionPointerDown = {
			x: event.clientX,
			y: event.clientY,
			pointerId: event.pointerId,
			additive: event.shiftKey || event.metaKey || event.ctrlKey
		};
	}

	function handleViewportPointerCancel(): void {
		selectionPointerDown = null;
	}

	function handleViewportPointerUp(event: PointerEvent): void {
		if (!loadedScene || !camera || !canvasHost) {
			selectionPointerDown = null;
			return;
		}

		const eventTarget = event.target;
		if (eventTarget instanceof HTMLElement && eventTarget.closest('[data-viewport-ui="true"]')) {
			selectionPointerDown = null;
			return;
		}

		if (!selectionPointerDown || selectionPointerDown.pointerId !== event.pointerId) {
			selectionPointerDown = null;
			return;
		}

		const pointerTravel = Math.hypot(
			event.clientX - selectionPointerDown.x,
			event.clientY - selectionPointerDown.y
		);
		const additiveSelection = selectionPointerDown.additive;
		selectionPointerDown = null;

		if (pointerTravel > SELECTION_CLICK_DRAG_THRESHOLD) {
			return;
		}

		const rect = canvasHost.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}

		const resolvedHit = resolveRuntimeSelection({
			scene: loadedScene,
			camera,
			canvasRect: rect,
			clientX: event.clientX,
			clientY: event.clientY
		});

		if (!resolvedHit) {
			if (!additiveSelection) {
				vehicleNodeSelection.clear(assetId);
			}
			return;
		}

		vehicleNodeSelection.select(
			{
				assetId,
				nodeId: resolvedHit.nodeId,
				nodeName: resolvedHit.runtimeNode.name.trim() || resolvedHit.runtimeNode.type,
				nodePath: buildRuntimeNodePath(resolvedHit.runtimeNode, loadedScene),
				materialIndex: resolvedHit.materialIndex,
				materialName: resolvedHit.materialName
			},
			additiveSelection
		);
	}

	function handleViewportKeyDown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		vehicleNodeSelection.clear(assetId);
	}

	function getResolvedLensGlowColor(color: THREE.Color): THREE.Color {
		const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
		if (luminance >= 0.22) {
			return color;
		}

		const fallbackHeadlightWhite = new THREE.Color(1, 0.98, 0.9);
		const mixRatio = THREE.MathUtils.clamp((0.22 - luminance) / 0.22, 0.32, 0.82);
		return color.clone().lerp(fallbackHeadlightWhite, mixRatio);
	}

	function applyMaterialPatch(
		scene: THREE.Object3D,
		operation: VehicleInspectionPatchOperation
	): void {
		if (operation.targetType !== 'material' || !operation.targetName) {
			return;
		}

		const targetName = operation.targetName;

		scene.traverse((node) => {
			for (const material of listNodeMaterials(node)) {
				if (material.name !== targetName && !targetName.startsWith(`${material.name} (`)) {
					continue;
				}

				switch (operation.op) {
					case 'set_base_color_factor':
						if (Array.isArray(operation.value) && operation.value.length === 4) {
							if (hasColorProperty(material)) {
								material.color.setRGB(
									operation.value[0] ?? 1,
									operation.value[1] ?? 1,
									operation.value[2] ?? 1
								);
							}
						}
						break;
					case 'set_metalness_factor':
						if (typeof operation.value === 'number' && hasFinishProperty(material)) {
							material.metalness = THREE.MathUtils.clamp(operation.value, 0, 1);
						}
						break;
					case 'set_roughness_factor':
						if (typeof operation.value === 'number' && hasFinishProperty(material)) {
							material.roughness = THREE.MathUtils.clamp(operation.value, 0, 1);
						}
						break;
					case 'set_env_map_intensity':
						if (typeof operation.value === 'number' && hasFinishProperty(material)) {
							material.envMapIntensity = THREE.MathUtils.clamp(operation.value, 0, 3);
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
							const requestedEmissiveColor = new THREE.Color(
								operation.value[0] ?? 0,
								operation.value[1] ?? 0,
								operation.value[2] ?? 0
							);
							const emissiveColor = getResolvedLensGlowColor(requestedEmissiveColor);
							const requestedStrength = THREE.MathUtils.clamp(
								Math.max(...operation.value.map((channel) => Math.abs(channel ?? 0))),
								0,
								1
							);
							const resolvedLuminance =
								emissiveColor.r * 0.2126 + emissiveColor.g * 0.7152 + emissiveColor.b * 0.0722;
							const emissiveStrength =
								requestedStrength > 0
									? Math.max(
											requestedStrength,
											THREE.MathUtils.clamp(resolvedLuminance * 0.85, 0.24, 0.9)
										)
									: 0;

							material.emissive.setRGB(emissiveColor.r, emissiveColor.g, emissiveColor.b);

							if (hasEmissiveIntensityProperty(material)) {
								const baseEmissiveIntensity =
									originalMaterialState.get(material)?.emissiveIntensity ??
									material.emissiveIntensity;
								material.emissiveIntensity = baseEmissiveIntensity + emissiveStrength * 1.35;
							}

							if (hasColorProperty(material)) {
								const baseColor =
									originalMaterialState.get(material)?.color ?? material.color.clone();
								material.color.copy(baseColor).lerp(emissiveColor, emissiveStrength * 0.18);
							}

							if (hasOpacityProperty(material) && emissiveStrength > 0) {
								const originalMaterial = originalMaterialState.get(material);
								const baseOpacity = originalMaterial?.opacity ?? material.opacity;
								const baseTransparent = originalMaterial?.transparent ?? material.transparent;

								// Only lift translucency for lens covers that were already authored as translucent.
								if (baseTransparent || baseOpacity < 0.985) {
									material.opacity = Math.min(baseOpacity + emissiveStrength * 0.04, 0.985);
									material.transparent = true;
								}
							}

							if (hasTransmissionProperty(material) && emissiveStrength > 0) {
								const originalMaterial = originalMaterialState.get(material);
								const baseTransmission = originalMaterial?.transmission ?? 0;

								if (baseTransmission > 0.01) {
									material.transmission = Math.max(baseTransmission, 0.08 * emissiveStrength);
									material.thickness = Math.max(originalMaterial?.thickness ?? 0, 0.08);
									material.roughness = Math.min(
										originalMaterial?.roughness ?? material.roughness,
										0.22
									);
								}
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
	}

	function applyViewerPatch(
		scene: THREE.Object3D,
		operation: VehicleInspectionPatchOperation
	): void {
		if (operation.targetType !== 'viewer') {
			return;
		}

		if (operation.targetId === 'scene_y_offset') {
			if (operation.op === 'set_target' && typeof operation.value === 'number') {
				scene.position.y = operation.value;
			}
			return;
		}

		if (operation.op !== 'set_enabled') {
			return;
		}

		if (operation.targetId === 'wireframe') {
			setSceneWireframe(scene, operation.value === true);
			return;
		}

		if (operation.targetId === 'xray') {
			setSceneXray(scene, operation.value === true);
			return;
		}

		if (operation.targetId === 'uv_debug') {
			setSceneUvDebug(scene, operation.value === true);
		}
	}

	function applyNodePatch(
		nodeLookup: Map<string, THREE.Object3D>,
		operation: VehicleInspectionPatchOperation
	): void {
		if (operation.targetType !== 'node') {
			return;
		}

		const node = nodeLookup.get(operation.targetId);
		if (!node) {
			return;
		}

		if (
			operation.op === 'set_overlay_highlight' &&
			Array.isArray(operation.value) &&
			operation.value.length === 4
		) {
			addHighlightOverlay(node, [
				operation.value[0] ?? 1,
				operation.value[1] ?? 1,
				operation.value[2] ?? 1,
				operation.value[3] ?? 0.48
			]);
			return;
		}

		if (operation.op === 'set_visibility' && typeof operation.value === 'boolean') {
			node.visible = operation.value;
		}
	}

	function applyPatchOperations(
		scene: THREE.Object3D,
		operations: VehicleInspectionPatchOperation[]
	): void {
		snapshotSceneState(scene);
		restoreSceneState(scene);
		clearHighlightOverlays(scene);
		const nodeLookup = buildRuntimeNodeLookup(scene).nodeById;

		for (const operation of operations) {
			switch (operation.targetType) {
				case 'node':
					applyNodePatch(nodeLookup, operation);
					break;
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

	$effect(() => {
		if (!loadedScene) {
			return;
		}

		clearSelectionOverlays(loadedScene);
		const selections = $vehicleNodeSelection.filter((selection) => selection.assetId === assetId);
		if (selections.length === 0) {
			return;
		}

		const nodeLookup = buildRuntimeNodeLookup(loadedScene).nodeById;
		for (const selection of selections) {
			const runtimeNode = nodeLookup.get(selection.nodeId);
			if (!runtimeNode) {
				continue;
			}

			addHighlightOverlay(
				runtimeNode,
				SELECTION_HIGHLIGHT_FACTOR,
				SELECTION_OVERLAY_NAME,
				selection.materialIndex
			);
		}
	});

	$effect(() => {
		assetId;
		let cancelled = false;
		let nextPoll: ReturnType<typeof setTimeout> | undefined;

		const loadSemanticOverlayStatus = async (): Promise<void> => {
			try {
				const response = await fetch(`/api/vehicle-assets/${assetId}/inspection`);
				if (!response.ok) {
					throw new Error(`Inspection status request failed: ${response.status}`);
				}

				const payload = (await response.json()) as {
					semanticOverlayStatus?: VehicleSemanticOverlayStatus;
				};

				if (cancelled) {
					return;
				}

				semanticOverlayStatus = payload.semanticOverlayStatus ?? 'unknown';
				if (semanticOverlayStatus !== 'fresh') {
					nextPoll = setTimeout(() => {
						void loadSemanticOverlayStatus();
					}, 5000);
				}
			} catch {
				if (cancelled) {
					return;
				}

				semanticOverlayStatus = 'unknown';
				nextPoll = setTimeout(() => {
					void loadSemanticOverlayStatus();
				}, 5000);
			}
		};

		loadedScene = undefined;
		semanticOverlayStatus = 'unknown';
		vehicleNodeSelection.clear(assetId);
		void loadSemanticOverlayStatus();

		return () => {
			cancelled = true;
			if (nextPoll) {
				clearTimeout(nextPoll);
			}
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
		class="relative h-full min-h-0 w-full overflow-hidden rounded-4xl border border-[color:color-mix(in_oklab,var(--color-boundary-text)_9%,transparent)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-boundary-background)_74%,black),color-mix(in_oklab,var(--color-boundary-background)_94%,black)_100%)] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-boundary-text)_6%,transparent)]"
	>
		<div
			class="pointer-events-none absolute inset-[1px] rounded-[calc(2rem-1px)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-boundary-text)_3%,transparent),transparent_18%,transparent_100%)]"
		></div>
		<div
			class="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklab,var(--color-boundary-text)_3%,transparent),transparent_18%,transparent_50%)]"
		></div>
		<div
			class="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_50%_100%,color-mix(in_oklab,var(--color-boundary-background)_22%,black),transparent_34%)]"
		></div>
		<div class="pointer-events-none absolute inset-0 z-20" data-viewport-ui="true">
			<div
				class="pointer-events-auto absolute top-4 left-4 flex flex-col items-start gap-2 sm:top-5 sm:left-6"
			>
				<AssetSelectionDropdown class="origin-top-left scale-[0.8] xl:scale-100" />
			</div>
			<div
				class="pointer-events-auto absolute top-4 right-4 flex flex-col items-end gap-4 sm:top-5 sm:right-6"
			>
				<CameraConfigReadout
					config={cameraConfig}
					moving={false}
					class="origin-top-right scale-[0.8] xl:scale-100"
				/>
				<InspectorSidebar {assetId} />
			</div>
			<div
				class="pointer-events-auto absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 sm:top-5"
			>
				<LightingControl bind:value={viewportLightIntensity} />
				<span
					class={[
						'h-1.5 w-1.5 self-center rounded-full transition-[background-color,box-shadow,opacity] duration-300',
						semanticDotClasses
					]}
					aria-label={semanticOverlayLabel}
					title={semanticOverlayLabel}
				></span>
			</div>
			<ViewportFooterBlueprint {assetId} />
		</div>
		<div
			bind:this={canvasHost}
			class="h-full min-h-0 w-full overflow-hidden rounded-[inherit]"
			onpointerdown={handleViewportPointerDown}
			onpointerup={handleViewportPointerUp}
			onpointercancel={handleViewportPointerCancel}
			onkeydown={handleViewportKeyDown}
			role="button"
			tabindex="0"
			aria-label="Vehicle inspection viewport"
		>
			<Canvas>
				<ViewportRenderInvalidator token={viewportRenderToken} />
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
						<GLTF url={assetUrl} onload={frameVehicle} />
					</T.Group>
				{/key}
			</Canvas>
		</div>
		<Sonner viewportAnchored={true} />
	</div>
</div>
