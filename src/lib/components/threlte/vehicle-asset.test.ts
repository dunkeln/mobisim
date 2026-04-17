import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { normalizeVehicleScene } from './vehicle-asset';

describe('normalizeVehicleScene', () => {
	it('returns normalized bounds without changing the centered fit outcome', () => {
		const scene = new THREE.Object3D();
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(2, 1, 1),
			new THREE.MeshBasicMaterial()
		);
		mesh.position.set(4, 0, 0);
		scene.add(mesh);

		const result = normalizeVehicleScene(scene);

		expect(result.scaleFactor).toBeCloseTo(2.2, 6);
		expect(result.size.x).toBeCloseTo(4.4, 6);
		expect(result.size.y).toBeCloseTo(2.2, 6);
		expect(result.size.z).toBeCloseTo(2.2, 6);
		expect(result.center.x).toBeCloseTo(8.8, 6);
		expect(result.center.y).toBeCloseTo(0, 6);
		expect(result.center.z).toBeCloseTo(0, 6);
	});
});
