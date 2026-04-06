import type { VehicleAssetId } from '$lib/vehicles/catalog';

export type VehicleRegistryAsset = {
	id: VehicleAssetId;
	displayName: string;
	title: string;
	description: string;
	fileName: string;
	lengthMeters: number;
	downloadUrl: string;
	storage: 'local-private' | 'remote-public';
};

export type VehicleRegistryListResponse = {
	items: VehicleRegistryAsset[];
};

export type VehicleRegistryDetailResponse = {
	item: VehicleRegistryAsset;
};
