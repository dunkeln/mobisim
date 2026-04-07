import { env } from '$env/dynamic/private';
import path from 'node:path';
import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';

export function resolveLocalAssetDirectory(): string {
	return env.ASSET_REGISTRY_LOCAL_DIR
		? path.resolve(env.ASSET_REGISTRY_LOCAL_DIR)
		: path.resolve(process.cwd(), 'storage/vehicle-assets');
}

export function resolveLocalAssetPath(assetId: VehicleAssetId): string {
	return path.join(resolveLocalAssetDirectory(), VEHICLE_CATALOG[assetId].fileName);
}
