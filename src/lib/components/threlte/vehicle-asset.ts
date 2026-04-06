import * as THREE from 'three';
import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';

type VehicleAssetSpec = {
	url: string;
	lengthMeters: number;
};

export const VEHICLE_ASSETS: Record<VehicleAssetId, VehicleAssetSpec> = Object.fromEntries(
	Object.values(VEHICLE_CATALOG).map((asset) => [
		asset.id,
		{
			url: `/${asset.fileName}`,
			lengthMeters: asset.lengthMeters
		}
	])
) as Record<VehicleAssetId, VehicleAssetSpec>;

export type NormalizedVehicleScene = {
  center: THREE.Vector3;
  size: THREE.Vector3;
  scaleFactor: number;
};

export function normalizeVehicleScene(
  scene: THREE.Object3D,
  assetId: VehicleAssetId
): NormalizedVehicleScene {
  scene.updateMatrixWorld(true);

  const initialBounds = new THREE.Box3().setFromObject(scene);
  const initialSize = new THREE.Vector3();
  initialBounds.getSize(initialSize);

  const measuredLength = Math.max(initialSize.x, initialSize.z) || 1;
  const scaleFactor = VEHICLE_ASSETS[assetId].lengthMeters / measuredLength;

  scene.scale.multiplyScalar(scaleFactor);
  scene.updateMatrixWorld(true);

  const normalizedBounds = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  normalizedBounds.getSize(size);
  normalizedBounds.getCenter(center);

  return {
    center,
    size,
    scaleFactor
  };
}
