import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { buildInspectionRoute } from '$lib/routes/inspection';
import { listVehicleRegistryAssets } from '$lib/server/connectors/vehicle-registry';
import { resolveVehicleAssetId } from '$lib/vehicles/catalog';

export const load: PageServerLoad = async ({ params, url }) => {
	const assetId = resolveVehicleAssetId(params.assetId);

	if (assetId !== params.assetId) {
		throw redirect(307, buildInspectionRoute(assetId, url.searchParams));
	}

	const asset = listVehicleRegistryAssets().items.find((item) => item.id === assetId);
	if (!asset) {
		throw error(404, 'Vehicle asset not found');
	}

	return {
		assetId,
		assetUrl: asset.downloadUrl
	};
};
