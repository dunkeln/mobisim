import { json } from '@sveltejs/kit';
import { listVehicleRegistryAssets } from '$lib/server/connectors/vehicle-registry';

export function GET() {
	return json(listVehicleRegistryAssets());
}
