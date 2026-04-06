import { error, json } from '@sveltejs/kit';
import {
	getVehicleRegistryAsset
} from '$lib/server/connectors/vehicle-registry';
import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';

export function GET({ params }: { params: { assetId: string } }) {
	const assetId = params.assetId as VehicleAssetId;

	if (!(assetId in VEHICLE_CATALOG)) {
		throw error(404, 'Vehicle asset not found');
	}

	return json(getVehicleRegistryAsset(assetId));
}
