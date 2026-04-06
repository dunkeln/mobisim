import { env } from '$env/dynamic/private';
import { VEHICLE_CATALOG, VEHICLE_CATALOG_LIST, type VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleRegistryAsset, VehicleRegistryListResponse } from './types';

function stripTrailingSlash(value: string): string {
	return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveAssetBaseUrl(): string | null {
	return env.ASSET_REGISTRY_PUBLIC_BASE_URL
		? stripTrailingSlash(env.ASSET_REGISTRY_PUBLIC_BASE_URL)
		: null;
}

function toRegistryAsset(assetId: VehicleAssetId): VehicleRegistryAsset {
	const asset = VEHICLE_CATALOG[assetId];
	const baseUrl = resolveAssetBaseUrl();

	return {
		id: asset.id,
		displayName: asset.displayName,
		title: asset.title,
		description: asset.description,
		fileName: asset.fileName,
		lengthMeters: asset.lengthMeters,
		downloadUrl: baseUrl
			? `${baseUrl}/${asset.fileName}`
			: `/api/vehicle-assets/${asset.id}/download`,
		storage: baseUrl ? 'remote-public' : 'local-private'
	};
}

export function listVehicleRegistryAssets(): VehicleRegistryListResponse {
	return {
		items: VEHICLE_CATALOG_LIST.map((asset) => toRegistryAsset(asset.id))
	};
}
