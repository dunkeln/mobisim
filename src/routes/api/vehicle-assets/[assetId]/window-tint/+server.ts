import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { planVehicleWindowTintIntent } from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

type WindowTintRequest = {
	tint?: string;
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!isVehicleAssetId(params.assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	const payload = (await request.json().catch(() => ({}))) as WindowTintRequest;
	const tint = payload.tint?.trim();

	if (!tint) {
		throw error(400, 'Window tint is required');
	}

	const plan = await planVehicleWindowTintIntent(params.assetId, tint);

	if (plan.operations.length === 0) {
		throw error(400, 'Window tint could not be resolved');
	}

	return json(plan);
};
