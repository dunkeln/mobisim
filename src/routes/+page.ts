import type { PageLoad } from './$types';
import {
	VEHICLE_CATALOG,
	VEHICLE_CATALOG_LIST,
	type VehicleAssetId
} from '$lib/vehicles/catalog';

type VehicleRegistryDetailResponse = {
	item: {
		id: VehicleAssetId;
		displayName: string;
		fileName: string;
		lengthMeters: number;
		downloadUrl: string;
		storage: 'local-private' | 'remote-public';
	};
};

const DEFAULT_ASSET_ID = VEHICLE_CATALOG_LIST[0]?.id ?? 'audi_r8';

function resolveAssetId(value: string | null): VehicleAssetId {
	if (value && value in VEHICLE_CATALOG) {
		return value as VehicleAssetId;
	}

	return DEFAULT_ASSET_ID;
}

export const load: PageLoad = async ({ fetch, url }) => {
	const assetId = resolveAssetId(url.searchParams.get('asset'));
	const response = await fetch(`/api/vehicle-assets/${assetId}`);

	if (!response.ok) {
		throw new Error(`Failed to load vehicle asset metadata: ${response.status}`);
	}

	const data = (await response.json()) as VehicleRegistryDetailResponse;

	return {
		assetId,
		vehicleAsset: data.item
	};
};
