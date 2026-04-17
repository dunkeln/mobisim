import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveVehicleAssetId } from '$lib/vehicles/catalog';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { session } = await parent();
	const assetId = resolveVehicleAssetId(url.searchParams.get('asset'));
	const destination = session?.user
		? `/app/inspect/${assetId}`
		: '/signin';

	throw redirect(303, destination);
};
