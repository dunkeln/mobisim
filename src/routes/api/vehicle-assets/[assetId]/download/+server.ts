import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';
import { resolveLocalAssetPath } from '$lib/server/connectors/vehicle-registry/storage';

export async function GET({ params }: { params: { assetId: string } }) {
	const assetId = params.assetId as VehicleAssetId;
	const asset = VEHICLE_CATALOG[assetId];

	if (!asset) {
		throw error(404, 'Vehicle asset not found');
	}

	const absolutePath = resolveLocalAssetPath(assetId);

	try {
		const file = await readFile(absolutePath);

		return new Response(file, {
			headers: {
				'Content-Type': 'model/gltf-binary',
				'Content-Length': String(file.byteLength),
				'Cache-Control': 'no-store, max-age=0',
				Pragma: 'no-cache',
				Expires: '0'
			}
		});
	} catch {
		throw error(404, 'Vehicle asset file not found');
	}
}
