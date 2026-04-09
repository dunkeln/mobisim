import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { buildInspectionRoute } from '$lib/routes/inspection';
import { resolveVehicleAssetId } from '$lib/vehicles/catalog';

export const load: PageLoad = ({ params, url }) => {
	const assetId = resolveVehicleAssetId(params.assetId);

	if (assetId !== params.assetId) {
		throw redirect(307, buildInspectionRoute(assetId, url.searchParams));
	}

	return {
		assetId
	};
};
