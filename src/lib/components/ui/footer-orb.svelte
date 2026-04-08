<script lang="ts">
	/**
	 * FooterOrb — geodesic hypersphere with per-edge dimming + vertex heartbeat.
	 *
	 * Outer geodesic sphere (r=0.90) + inner sphere (r=0.76) with connector spokes.
	 * ~1/3 of edges on each net are rendered at reduced brightness via vertexColors.
	 * Per-vertex radial displacement drives the heartbeat surface deformation.
	 *
	 * amplitude: 0–1 — controls deformation depth + speed in 'responding' mode.
	 */

	import { onMount } from 'svelte';
	import * as THREE from 'three';

	type OrbMode = 'idle' | 'listening' | 'processing' | 'responding';

	type Props = {
		mode?: OrbMode;
		amplitude?: number;
		class?: string;
	};

	let { mode = 'idle', amplitude = 0, class: className = '' }: Props = $props();

	let canvas: HTMLCanvasElement | undefined = $state();

	// Secondary: hsl(34 75% 73%) ≈ #EBBE7A
	const SEC = new THREE.Color(0xebbe7a);
	const SEC_BRIGHT = new THREE.Color(0xffd898);
	const SEC_DIM = new THREE.Color(0xc8923a);
	const SEC_FAINT = new THREE.Color(0x8a5c18); // dim edge tone

	// Deterministic pseudo-random from an integer seed (no stdlib dependency)
	function pseudoRand(seed: number): number {
		let s = seed ^ 0x9e3779b9;
		s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
		s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35);
		return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
	}

	// Build a LineSegments geometry with per-edge vertex colors from a source
	// IcosahedronGeometry. Returns the LineSegments, the render position buffer,
	// and a lookup table: renderVertex[i] → source vertex index (for deformation).
	function buildNetGeometry(
		topoGeo: THREE.IcosahedronGeometry,
		dimFraction: number,
		dimSeed: number
	): {
		lines: THREE.LineSegments;
		renderPosBuf: THREE.BufferAttribute;
		vertToSrc: Uint16Array;
		origSrcPos: Float32Array;
	} {
		const srcPos = topoGeo.getAttribute('position') as THREE.BufferAttribute;

		// Map position string → source vertex index (icosahedron is indexed, so unique)
		const posToSrc = new Map<string, number>();
		for (let i = 0; i < srcPos.count; i++) {
			const k = `${srcPos.getX(i).toFixed(5)},${srcPos.getY(i).toFixed(5)},${srcPos.getZ(i).toFixed(5)}`;
			posToSrc.set(k, i);
		}

		const edgesGeo = new THREE.EdgesGeometry(topoGeo);
		const edgePos = edgesGeo.getAttribute('position') as THREE.BufferAttribute;
		const edgeVertCount = edgePos.count; // always even: pairs of vertices
		const edgeCount = edgeVertCount / 2;

		// For each edge-vertex, find its source icosahedron vertex index
		const vertToSrc = new Uint16Array(edgeVertCount);
		for (let i = 0; i < edgeVertCount; i++) {
			const k = `${edgePos.getX(i).toFixed(5)},${edgePos.getY(i).toFixed(5)},${edgePos.getZ(i).toFixed(5)}`;
			vertToSrc[i] = posToSrc.get(k) ?? 0;
		}

		// Snapshot original source positions
		const origSrcPos = new Float32Array(srcPos.count * 3);
		for (let i = 0; i < srcPos.count; i++) {
			origSrcPos[i * 3] = srcPos.getX(i);
			origSrcPos[i * 3 + 1] = srcPos.getY(i);
			origSrcPos[i * 3 + 2] = srcPos.getZ(i);
		}

		// Classify edges: ~dimFraction are dim (pseudo-random by edge index + seed)
		const edgeIsDim = new Uint8Array(edgeCount);
		for (let e = 0; e < edgeCount; e++) {
			if (pseudoRand(e + dimSeed * 997) < dimFraction) edgeIsDim[e] = 1;
		}

		// Build render geometry: positions + vertex colors
		const renderPosArr = new Float32Array(edgeVertCount * 3);
		const colorArr = new Float32Array(edgeVertCount * 3);

		for (let e = 0; e < edgeCount; e++) {
			const isDim = edgeIsDim[e] === 1;
			const col = isDim ? SEC_FAINT : SEC;
			for (let v = 0; v < 2; v++) {
				const vi = e * 2 + v;
				const si = vertToSrc[vi];
				renderPosArr[vi * 3] = origSrcPos[si * 3];
				renderPosArr[vi * 3 + 1] = origSrcPos[si * 3 + 1];
				renderPosArr[vi * 3 + 2] = origSrcPos[si * 3 + 2];
				colorArr[vi * 3] = col.r;
				colorArr[vi * 3 + 1] = col.g;
				colorArr[vi * 3 + 2] = col.b;
			}
		}

		const renderGeo = new THREE.BufferGeometry();
		const renderPosBuf = new THREE.BufferAttribute(renderPosArr, 3);
		renderGeo.setAttribute('position', renderPosBuf);
		renderGeo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));

		const mat = new THREE.LineBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.5
		});

		edgesGeo.dispose();
		return { lines: new THREE.LineSegments(renderGeo, mat), renderPosBuf, vertToSrc, origSrcPos };
	}

	// Deform a net's render position buffer using radial sine displacement.
	// origSrc: base vertex positions (indexed), vertToSrc: edge-vert → src-vert.
	function deformNet(
		renderPosBuf: THREE.BufferAttribute,
		vertToSrc: Uint16Array,
		origSrc: Float32Array,
		t: number,
		freq: number,
		depth: number
	): void {
		const edgeVertCount = vertToSrc.length;
		for (let i = 0; i < edgeVertCount; i++) {
			const si = vertToSrc[i];
			const ox = origSrc[si * 3];
			const oy = origSrc[si * 3 + 1];
			const oz = origSrc[si * 3 + 2];
			const phase = ox * 3.1 + oy * 2.3 + oz * 1.7;
			const r = 1 + Math.sin(t * freq + phase) * depth;
			renderPosBuf.setXYZ(i, ox * r, oy * r, oz * r);
		}
		renderPosBuf.needsUpdate = true;
	}

	onMount(() => {
		if (!canvas) return;

		const SIZE = 100;

		// ── Scene ───────────────────────────────────────────────
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
		camera.position.z = 3.6;

		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		renderer.setSize(SIZE, SIZE, false);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setClearColor(0x000000, 0);

		// ── Lighting ────────────────────────────────────────────
		scene.add(new THREE.AmbientLight(0xffeedd, 0.4));

		const keyLight = new THREE.PointLight(0xffd090, 7, 12);
		keyLight.position.set(-2.2, 2.8, 3.0);
		scene.add(keyLight);

		const rimLight = new THREE.PointLight(0xc87030, 2.5, 10);
		rimLight.position.set(2.2, -1.8, -1.5);
		scene.add(rimLight);

		// ── Depth volume sphere ──────────────────────────────────
		const volGeo = new THREE.SphereGeometry(0.88, 64, 64);
		const volMat = new THREE.MeshPhongMaterial({
			color: SEC_DIM,
			emissive: SEC_DIM,
			emissiveIntensity: 0.08,
			transparent: true,
			opacity: 0.05,
			depthWrite: false
		});
		scene.add(new THREE.Mesh(volGeo, volMat));

		// ── Outer net: r=0.90, detail=2, ~1/3 dim edges ─────────
		const outerTopoGeo = new THREE.IcosahedronGeometry(0.9, 2);
		const {
			lines: outerLines,
			renderPosBuf: outerPosBuf,
			vertToSrc: outerVertToSrc,
			origSrcPos: outerOrigSrc
		} = buildNetGeometry(outerTopoGeo, 0.33, 1);

		const outerMat = outerLines.material as THREE.LineBasicMaterial;
		outerMat.opacity = 0.5;
		scene.add(outerLines);
		outerTopoGeo.dispose();

		// ── Inner net: r=0.87, detail=1, ~1/3 dim edges ─────────
		const innerTopoGeo = new THREE.IcosahedronGeometry(0.87, 1);
		const {
			lines: innerLines,
			renderPosBuf: innerPosBuf,
			vertToSrc: innerVertToSrc,
			origSrcPos: innerOrigSrc
		} = buildNetGeometry(innerTopoGeo, 0.33, 42);

		const innerMat = innerLines.material as THREE.LineBasicMaterial;
		innerMat.opacity = 0.28;
		scene.add(innerLines);
		innerTopoGeo.dispose();

		// ── Connector spokes: 12 icosahedron vertices ────────────
		// Outer endpoints at r=0.90, inner endpoints at r=0.87
		const baseGeo = new THREE.IcosahedronGeometry(1, 0);
		const baseAttr = baseGeo.getAttribute('position');
		const seenKeys = new Set<string>();
		const spokeVerts: THREE.Vector3[] = [];

		for (let i = 0; i < baseAttr.count; i++) {
			const v = new THREE.Vector3().fromBufferAttribute(baseAttr, i).normalize();
			const key = [v.x, v.y, v.z].map((n) => n.toFixed(3)).join(',');
			if (!seenKeys.has(key)) {
				seenKeys.add(key);
				spokeVerts.push(v.clone());
			}
		}
		baseGeo.dispose();

		const OUTER_R = 0.90;
		const INNER_R = 0.87;

		const spokePts: number[] = [];
		for (const v of spokeVerts) {
			spokePts.push(v.x * OUTER_R, v.y * OUTER_R, v.z * OUTER_R);
			spokePts.push(v.x * INNER_R, v.y * INNER_R, v.z * INNER_R);
		}
		const spokeGeo = new THREE.BufferGeometry();
		const spokePosAttr = new THREE.Float32BufferAttribute(spokePts, 3);
		spokeGeo.setAttribute('position', spokePosAttr);
		const origSpoke = new Float32Array(spokePts);

		const spokeMat = new THREE.LineBasicMaterial({
			color: SEC_BRIGHT,
			transparent: true,
			opacity: 0.18
		});
		const spokeLines = new THREE.LineSegments(spokeGeo, spokeMat);
		// Spokes co-rotate with the outer net
		outerLines.add(spokeLines);

		// ── Core ─────────────────────────────────────────────────
		const coreGeo = new THREE.SphereGeometry(0.065, 16, 16);
		const coreMat = new THREE.MeshPhongMaterial({
			color: 0xffffff,
			emissive: 0xffeecc,
			emissiveIntensity: 3.5,
			transparent: true,
			opacity: 0.95
		});
		const coreMesh = new THREE.Mesh(coreGeo, coreMat);
		scene.add(coreMesh);

		// ── Animation loop ───────────────────────────────────────
		const clock = new THREE.Clock();
		let raf: number;

		function animate() {
			raf = requestAnimationFrame(animate);
			const t = clock.getElapsedTime();
			const m = mode;
			const a = Math.min(1, Math.max(0, amplitude));

			// Rotation
			const outerSpeed =
				m === 'idle' ? 0.07 : m === 'listening' ? 0.22 : m === 'processing' ? 0.3 : 0.16;
			const innerSpeed = m === 'idle' ? 0.1 : 0.28;

			outerLines.rotation.y = t * outerSpeed;
			outerLines.rotation.x = t * outerSpeed * 0.38;
			innerLines.rotation.y = -t * innerSpeed;
			innerLines.rotation.z = t * innerSpeed * 0.52;

			// Heartbeat parameters
			const heartFreq =
				m === 'idle' ? 0.65 : m === 'listening' ? 1.9 : m === 'processing' ? 3.5 : 1.4 + a * 3.2;

			const heartDepth =
				m === 'idle'
					? 0.016
					: m === 'listening'
						? 0.04
						: m === 'processing'
							? 0.03
							: 0.024 + a * 0.095;

			// Deform outer net vertices
			deformNet(outerPosBuf, outerVertToSrc, outerOrigSrc, t, heartFreq, heartDepth);

			// Sync spoke outer endpoints with deformed outer surface
			for (let i = 0; i < spokeVerts.length; i++) {
				const si = i * 6;
				const ox = origSpoke[si] / OUTER_R; // unit direction
				const oy = origSpoke[si + 1] / OUTER_R;
				const oz = origSpoke[si + 2] / OUTER_R;
				const phase = ox * 3.1 + oy * 2.3 + oz * 1.7;
				const r = 1 + Math.sin(t * heartFreq + phase) * heartDepth;
				spokePosAttr.setXYZ(i * 2, ox * r * OUTER_R, oy * r * OUTER_R, oz * r * OUTER_R);
			}
			spokePosAttr.needsUpdate = true;

			// Inner net: lighter deformation, slightly offset phase
			deformNet(
				innerPosBuf,
				innerVertToSrc,
				innerOrigSrc,
				t + 0.4,
				heartFreq * 0.8,
				heartDepth * 0.6
			);

			// Material opacity by mode
			outerMat.opacity =
				m === 'idle'
					? 0.38
					: m === 'listening'
						? 0.72
						: m === 'processing'
							? 0.55
							: 0.45 + a * 0.35;

			innerMat.opacity = m === 'idle' ? 0.2 : 0.25 + a * 0.22;

			spokeMat.opacity = m === 'idle' ? 0.11 : 0.16 + a * 0.32;

			volMat.opacity = m === 'idle' ? 0.03 : 0.05 + a * 0.08;

			// Core pulse
			const coreScale =
				m === 'idle'
					? 1 + Math.sin(t * 0.85) * 0.18
					: m === 'listening'
						? 1 + Math.sin(t * 1.9) * 0.28
						: m === 'processing'
							? 1 + Math.sin(t * 3.8) * 0.22
							: 1 + a * 0.65;
			coreMesh.scale.setScalar(coreScale);
			coreMat.emissiveIntensity = m === 'idle' ? 2.5 : 3.5 + a * 5.0;

			// Key light breathes with heartbeat
			keyLight.intensity =
				m === 'idle' ? 5 + Math.sin(t * 0.7) * 2 : 6 + a * 5 + Math.sin(t * heartFreq * 0.5) * 2;

			renderer.render(scene, camera);
		}

		animate();

		return () => {
			cancelAnimationFrame(raf);
			renderer.dispose();
			[volGeo, spokeGeo, coreGeo].forEach((g) => g.dispose());
			[outerLines, innerLines].forEach((ls) => {
				ls.geometry.dispose();
				(ls.material as THREE.Material).dispose();
			});
		};
	});
</script>

<div class="orb {className}" aria-hidden="true">
	<canvas bind:this={canvas} class="orb-canvas"></canvas>
</div>

<style>
	.orb {
		width: 96px;
		height: 96px;
		flex-shrink: 0;
	}

	.orb-canvas {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
