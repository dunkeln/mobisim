import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveVehicleAssetId } from '$lib/vehicles/catalog';

export const load: PageServerLoad = async ({ locals, url }) => {
	const session = await locals.auth();
	const assetId = resolveVehicleAssetId(url.searchParams.get('asset'));
	const destination = session?.user
		? `/app/inspect/${assetId}`
		: '/signin';

	throw redirect(303, destination);
};
