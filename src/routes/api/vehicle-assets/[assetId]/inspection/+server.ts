import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import { getVehicleSemanticOverlayStatus } from '$lib/server/connectors/vehicle-semantic-overlay';
import { isVehicleAssetId } from '$lib/vehicles/catalog';

type InspectionSection = 'all' | 'scenes' | 'controls' | 'wireframes' | 'uv' | 'materials';

function resolveInspectionSection(value: string | null): InspectionSection {
	switch (value) {
		case 'scenes':
		case 'controls':
		case 'wireframes':
		case 'uv':
		case 'materials':
			return value;
		default:
			return 'all';
	}
}

export async function _getVehicleInspectionSection(assetId: string, section: InspectionSection) {
	if (!isVehicleAssetId(assetId)) {
		throw error(404, 'Vehicle asset not found');
	}

	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const semanticOverlayStatus = await getVehicleSemanticOverlayStatus(
		assetId,
		capabilities.generatedAt
	);

	switch (section) {
		case 'scenes':
			return {
				assetId,
				section,
				generatedAt: capabilities.generatedAt,
				semanticOverlayStatus,
				items: capabilities.scenes
			};
		case 'controls':
			return {
				assetId,
				section,
				generatedAt: capabilities.generatedAt,
				semanticOverlayStatus,
				items: capabilities.controlCandidates
			};
		case 'wireframes':
			return {
				assetId,
				section,
				generatedAt: capabilities.generatedAt,
				semanticOverlayStatus,
				items: capabilities.wireframeMeshes
			};
		case 'uv':
			return {
				assetId,
				section,
				generatedAt: capabilities.generatedAt,
				semanticOverlayStatus,
				items: capabilities.uvDebugMeshes
			};
		case 'materials':
			return {
				assetId,
				section,
				generatedAt: capabilities.generatedAt,
				semanticOverlayStatus,
				items: capabilities.materials
			};
		case 'all':
			return {
				assetId,
				section,
				generatedAt: capabilities.generatedAt,
				semanticOverlayStatus,
				item: capabilities
			};
	}
}

export const GET: RequestHandler = async ({ params, url }) => {
	const section = resolveInspectionSection(url.searchParams.get('section'));
	return json(await _getVehicleInspectionSection(params.assetId, section));
};
