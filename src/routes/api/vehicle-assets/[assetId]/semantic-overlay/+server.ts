import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	generateVehicleSemanticOverlay,
	readVehicleSemanticOverlay,
	VehicleSemanticOverlayConfigError,
	VehicleSemanticOverlayUpstreamError
} from '$lib/server/connectors/vehicle-semantic-overlay';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

type SemanticOverlayRequest = {
	force?: boolean;
	minAcceptedConfidence?: number;
};

export const GET: RequestHandler = async ({ params }) => {
	if (!isVehicleAssetId(params.assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	const overlay = await readVehicleSemanticOverlay(params.assetId);
	if (!overlay) {
		throw error(404, 'Semantic overlay not found');
	}

	return json(overlay);
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!isVehicleAssetId(params.assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	const payload = (await request.json().catch(() => ({}))) as SemanticOverlayRequest;

	try {
		return json(
			await generateVehicleSemanticOverlay(params.assetId, {
				force: payload.force === true,
				minAcceptedConfidence:
					typeof payload.minAcceptedConfidence === 'number'
						? payload.minAcceptedConfidence
						: undefined
			})
		);
	} catch (caughtError) {
		if (caughtError instanceof VehicleSemanticOverlayConfigError) {
			throw error(500, caughtError.message);
		}

		if (caughtError instanceof VehicleSemanticOverlayUpstreamError) {
			throw error(502, caughtError.message);
		}

		throw caughtError;
	}
};
