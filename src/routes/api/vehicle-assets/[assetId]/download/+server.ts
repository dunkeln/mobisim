import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { VEHICLE_CATALOG, type VehicleAssetId } from '$lib/vehicles/catalog';

function resolveLocalAssetDirectory(): string {
	return env.ASSET_REGISTRY_LOCAL_DIR
		? path.resolve(env.ASSET_REGISTRY_LOCAL_DIR)
		: path.resolve(process.cwd(), 'storage/vehicle-assets');
}

export async function GET({ params }: { params: { assetId: string } }) {
	const assetId = params.assetId as VehicleAssetId;
	const asset = VEHICLE_CATALOG[assetId];

	if (!asset) {
		throw error(404, 'Vehicle asset not found');
	}

	const absolutePath = path.join(resolveLocalAssetDirectory(), asset.fileName);

	try {
		const file = await readFile(absolutePath);

		return new Response(file, {
			headers: {
				'Content-Type': 'model/gltf-binary',
				'Content-Length': String(file.byteLength),
				'Cache-Control': 'private, max-age=3600'
			}
		});
	} catch {
		throw error(404, 'Vehicle asset file not found');
	}
}
