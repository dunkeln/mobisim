import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { defaultVehicleAssetId } from '$lib/vehicles/catalog';

export const load: PageServerLoad = async () => {
	throw redirect(303, `/app/inspect/${defaultVehicleAssetId}`);
};
