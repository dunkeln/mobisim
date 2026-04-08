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
});
