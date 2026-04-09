import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { resolveRuntimeSelection } from './runtime-selection';

function createCanvasRect(width: number, height: number): DOMRect {
	return {
		left: 0,
		top: 0,
		width,
		height,
		right: width,
		bottom: height,
		x: 0,
		y: 0,
		toJSON: () => ({})
	} as DOMRect;
}

describe('runtime selection', () => {
	it('passes through low-alpha front meshes and selects the opaque part behind them', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const shell = new THREE.Mesh(
			new THREE.PlaneGeometry(2.8, 2.8),
			new THREE.MeshStandardMaterial({
				color: new THREE.Color(0.4, 0.1, 0.1),
				transparent: true,
				opacity: 0.05
			})
		);
		shell.name = 'Shell';
		shell.position.z = 0.4;

		const engine = new THREE.Mesh(
			new THREE.PlaneGeometry(1.4, 1.4),
			new THREE.MeshStandardMaterial({
				color: new THREE.Color(0.1, 0.1, 0.1),
				transparent: true,
				opacity: 1
			})
		);
		engine.name = 'Engine';

		scene.add(shell);
		scene.add(engine);

		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
		camera.position.set(0, 0, 4);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		scene.updateMatrixWorld(true);

		const selection = resolveRuntimeSelection({
			scene,
			camera,
			canvasRect: createCanvasRect(200, 200),
			clientX: 100,
			clientY: 100
		});

		expect(selection).not.toBeNull();
		expect(selection?.runtimeNode.name).toBe('Engine');
	});

	it('defaults to node-first selection even when clicking a multi-material mesh', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const geometry = new THREE.BufferGeometry();
		const vertices = new Float32Array([
			-1, -1, 0,
			0, -1, 0,
			0, 1, 0,
			-1, 1, 0,
			0, -1, 0,
			1, -1, 0,
			1, 1, 0,
			0, 1, 0
		]);
		const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
		geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
		geometry.setIndex(indices);
		geometry.clearGroups();
		geometry.addGroup(0, 6, 0);
		geometry.addGroup(6, 6, 1);
		geometry.computeVertexNormals();

		const mesh = new THREE.Mesh(geometry, [
			new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.1, 0.1), name: 'Left' }),
			new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.1, 0.8), name: 'Right' })
		]);
		mesh.name = 'Door Assembly';
		scene.add(mesh);

		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
		camera.position.set(0, 0, 4);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		scene.updateMatrixWorld(true);

		const selection = resolveRuntimeSelection({
			scene,
			camera,
			canvasRect: createCanvasRect(200, 200),
			clientX: 150,
			clientY: 100
		});

		expect(selection).not.toBeNull();
		expect(selection?.runtimeNode.name).toBe('Door Assembly');
		expect(selection?.materialIndex).toBeUndefined();
		expect(selection?.materialName).toBeUndefined();
	});

	it('can still resolve material-specific selection when explicitly requested', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const geometry = new THREE.BufferGeometry();
		const vertices = new Float32Array([
			-1, -1, 0,
			0, -1, 0,
			0, 1, 0,
			-1, 1, 0,
			0, -1, 0,
			1, -1, 0,
			1, 1, 0,
			0, 1, 0
		]);
		const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
		geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
		geometry.setIndex(indices);
		geometry.clearGroups();
		geometry.addGroup(0, 6, 0);
		geometry.addGroup(6, 6, 1);
		geometry.computeVertexNormals();

		const mesh = new THREE.Mesh(geometry, [
			new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.1, 0.1), name: 'Left' }),
			new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.1, 0.8), name: 'Right' })
		]);
		mesh.name = 'Door Assembly';
		scene.add(mesh);

		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
		camera.position.set(0, 0, 4);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		scene.updateMatrixWorld(true);

		const selection = resolveRuntimeSelection({
			scene,
			camera,
			canvasRect: createCanvasRect(200, 200),
			clientX: 150,
			clientY: 100,
			granularity: 'material'
		});

		expect(selection).not.toBeNull();
		expect(selection?.runtimeNode.name).toBe('Door Assembly');
		expect(selection?.materialIndex).toBe(1);
		expect(selection?.materialName).toBe('Right');
	});

	it('prefers the first accepted front surface in node mode over deeper geometry', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const outerShell = new THREE.Mesh(
			new THREE.PlaneGeometry(2.8, 2.8),
			new THREE.MeshStandardMaterial({
				color: new THREE.Color(0.7, 0.7, 0.72),
				transparent: true,
				opacity: 1
			})
		);
		outerShell.name = 'Outer Shell';
		outerShell.position.z = 0.45;

		const innerCore = new THREE.Mesh(
			new THREE.PlaneGeometry(1.6, 1.6),
			new THREE.MeshStandardMaterial({
				color: new THREE.Color(0.1, 0.1, 0.1),
				transparent: true,
				opacity: 1
			})
		);
		innerCore.name = 'Inner Core';

		scene.add(outerShell);
		scene.add(innerCore);

		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
		camera.position.set(0, 0, 4);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		scene.updateMatrixWorld(true);

		const selection = resolveRuntimeSelection({
			scene,
			camera,
			canvasRect: createCanvasRect(200, 200),
			clientX: 100,
			clientY: 100
		});

		expect(selection).not.toBeNull();
		expect(selection?.runtimeNode.name).toBe('Outer Shell');
		expect(selection?.materialIndex).toBeUndefined();
		expect(selection?.materialName).toBeUndefined();
	});

	it('can anchor selection scoring to the center sample to avoid neighboring node drift', () => {
		const scene = new THREE.Scene();
		scene.name = 'Scene';

		const centerTarget = new THREE.Mesh(
			new THREE.PlaneGeometry(0.48, 0.48),
			new THREE.MeshStandardMaterial({
				color: new THREE.Color(0.72, 0.72, 0.76),
				transparent: true,
				opacity: 1
			})
		);
		centerTarget.name = 'Center Target';
		centerTarget.position.set(0, 0, 0.24);

		const neighborTarget = new THREE.Mesh(
			new THREE.PlaneGeometry(0.74, 0.74),
			new THREE.MeshStandardMaterial({
				color: new THREE.Color(0.18, 0.32, 0.74),
				transparent: true,
				opacity: 1
			})
		);
		neighborTarget.name = 'Neighbor Target';
		neighborTarget.position.set(0.38, 0, 0);

		scene.add(centerTarget);
		scene.add(neighborTarget);

		const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
		camera.position.set(0, 0, 4);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		scene.updateMatrixWorld(true);

		const looseSelection = resolveRuntimeSelection({
			scene,
			camera,
			canvasRect: createCanvasRect(200, 200),
			clientX: 100,
			clientY: 100
		});
		const anchoredSelection = resolveRuntimeSelection({
			scene,
			camera,
			canvasRect: createCanvasRect(200, 200),
			clientX: 100,
			clientY: 100,
			anchorToCenterSample: true
		});

		expect(anchoredSelection).not.toBeNull();
		expect(anchoredSelection?.runtimeNode.name).toBe('Center Target');
		expect(looseSelection).not.toBeNull();
	});
});
