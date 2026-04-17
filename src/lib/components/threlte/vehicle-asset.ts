import * as THREE from 'three';

const CANONICAL_FIT_BOX = new THREE.Vector3(4.8, 2.2, 7.2);

export type NormalizedVehicleScene = {
	center: THREE.Vector3;
	size: THREE.Vector3;
	scaleFactor: number;
};

export function normalizeVehicleScene(scene: THREE.Object3D): NormalizedVehicleScene {
	scene.updateMatrixWorld(true);

	const initialBounds = new THREE.Box3().setFromObject(scene);
	const initialSize = new THREE.Vector3();
	const initialCenter = new THREE.Vector3();
	initialBounds.getSize(initialSize);
	initialBounds.getCenter(initialCenter);

	const scaleFactor = Math.min(
		CANONICAL_FIT_BOX.x / Math.max(initialSize.x, 0.001),
		CANONICAL_FIT_BOX.y / Math.max(initialSize.y, 0.001),
		CANONICAL_FIT_BOX.z / Math.max(initialSize.z, 0.001)
	);

	scene.scale.multiplyScalar(scaleFactor);
	scene.updateMatrixWorld(true);

	const size = initialSize.clone().multiplyScalar(scaleFactor);
	const center = initialCenter.clone().multiplyScalar(scaleFactor);

	return {
		center,
		size,
		scaleFactor
	};
}
