import { env } from '$env/dynamic/private';
import {
	VEHICLE_CATALOG,
	VEHICLE_CATALOG_LIST,
	type VehicleAssetId
} from '$lib/vehicles/catalog';
import { resolveVehicleAssetDownloadUrl } from './storage';
import type { VehicleRegistryAsset, VehicleRegistryListResponse } from './types';

export function resolveAssetBaseUrl(): string | null {
	const baseUrl = env.ASSET_REGISTRY_PUBLIC_BASE_URL?.trim();
	if (!baseUrl) {
		throw new Error('ASSET_REGISTRY_PUBLIC_BASE_URL is required.');
	}

	return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function toRegistryAsset(assetId: VehicleAssetId): VehicleRegistryAsset {
	const asset = VEHICLE_CATALOG[assetId];

	return {
		id: asset.id,
		displayName: asset.displayName,
		title: asset.title,
		description: asset.description,
		fileName: asset.fileName,
		lengthMeters: asset.lengthMeters,
		downloadUrl: resolveVehicleAssetDownloadUrl(assetId),
		storage: 'remote-public'
	};
}

export function listVehicleRegistryAssets(): VehicleRegistryListResponse {
	return {
		items: VEHICLE_CATALOG_LIST.map((asset) => toRegistryAsset(asset.id))
	};
}
