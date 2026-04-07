import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { planVehiclePaintIntent } from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

type VehiclePaintRequest = {
	color?: string;
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!isVehicleAssetId(params.assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	const payload = (await request.json().catch(() => ({}))) as VehiclePaintRequest;
	const color = payload.color?.trim();

	if (!color) {
		throw error(400, 'Paint color is required');
	}

	const plan = await planVehiclePaintIntent(params.assetId, color);

	if (plan.operations.length === 0) {
		throw error(400, 'Paint color could not be resolved');
	}

	return json(plan);
};
