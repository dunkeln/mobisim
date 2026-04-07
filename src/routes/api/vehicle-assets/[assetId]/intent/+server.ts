import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveVehicleIntent } from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

type VehicleIntentRequest = {
	request?: string;
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!isVehicleAssetId(params.assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	const payload = (await request.json().catch(() => ({}))) as VehicleIntentRequest;
	const freeformRequest = payload.request?.trim();

	if (!freeformRequest) {
		throw error(400, 'Intent request is required');
	}

	return json(await resolveVehicleIntent(params.assetId, freeformRequest));
};
