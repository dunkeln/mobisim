import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getVehicleHeadlightSupport,
	planVehicleHeadlightIntent
} from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

type HeadlightRequest = {
	enabled?: boolean;
};

export const GET: RequestHandler = async ({ params }) => {
	if (!isVehicleAssetId(params.assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	return json(await getVehicleHeadlightSupport(params.assetId));
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!isVehicleAssetId(params.assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	const payload = (await request.json().catch(() => ({}))) as HeadlightRequest;

	if (typeof payload.enabled !== 'boolean') {
		throw error(400, 'Headlight enabled flag is required');
	}

	return json(await planVehicleHeadlightIntent(params.assetId, payload.enabled));
};
