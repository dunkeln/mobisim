import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveVehicleIntent } from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

type VehicleIntentRequest = {
	request?: string;
	selectedGroupId?: string;
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

	const selectedGroupId =
		typeof payload.selectedGroupId === 'string' ? payload.selectedGroupId.trim() : '';

	return json(
		selectedGroupId.length > 0
			? await resolveVehicleIntent(params.assetId, freeformRequest, {
					selectedGroupId
				})
			: await resolveVehicleIntent(params.assetId, freeformRequest)
	);
};
