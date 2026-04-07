import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { planVehicleHighlightIntent } from '$lib/server/connectors/vehicle-intents';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

type HighlightRequest = {
	query?: string;
};

export async function _highlightVehiclePart(assetId: string, query: string) {
	if (!isVehicleAssetId(assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	const plan = await planVehicleHighlightIntent(assetId, query);

	return {
		assetId,
		query,
		matchedPaths: plan.matchedPaths,
		matchedMaterialNames: plan.matchedMaterialNames,
		operations: plan.operations,
		rejected: plan.rejected,
		summary: plan.summary
	};
}

export const POST: RequestHandler = async ({ params, request }) => {
	const payload = (await request.json().catch(() => ({}))) as HighlightRequest;
	const query = payload.query?.trim();

	if (!query) {
		throw error(400, 'Highlight query is required');
	}

	return json(await _highlightVehiclePart(params.assetId, query));
};
