import {
	planVehiclePartHighlight
} from '$lib/server/connectors/gltf-preprocess';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import { planVehiclePartIntent } from './part-intent';

async function validatePlannedOperations(
	assetId: VehicleAssetId,
	presetId: string,
	operations: SharedVehicleInspectionPatchOperation[]
): Promise<{ assetId: VehicleAssetId; operations: SharedVehicleInspectionPatchOperation[]; rejected: string[]; summary: string }> {
	const { validateVehicleInspectionPatchManifest } = await import('$lib/server/connectors/gltf-preprocess');
	const validation = await validateVehicleInspectionPatchManifest({
		assetId,
		userId: 'vehicle-intent',
		presetId,
		operations
	});

	return {
		assetId,
		operations: validation.accepted as SharedVehicleInspectionPatchOperation[],
		rejected: validation.rejected.map((item) => item.reason),
		summary:
			validation.accepted.length > 0
				? `Planned ${validation.accepted.length} patch operation(s).`
				: 'No valid patch operations were accepted.'
	};
}

export async function planVehicleHighlightIntent(
	assetId: VehicleAssetId,
	query: string
): Promise<
	{
		assetId: VehicleAssetId;
		operations: SharedVehicleInspectionPatchOperation[];
		rejected: string[];
		summary: string;
	} & { matchedPaths: string[]; matchedMaterialNames: string[] }
> {
	const normalizedQuery = query.trim();
	const semanticPlan = await planVehiclePartIntent(assetId, normalizedQuery, 'highlight');
	const plan =
		semanticPlan.operations.length > 0
			? {
					assetId,
					partQuery: normalizedQuery,
					matchedPaths: semanticPlan.matchedPaths,
					matchedMaterialNames: semanticPlan.matchedMaterialNames,
					operations: semanticPlan.operations
				}
			: await planVehiclePartHighlight(assetId, normalizedQuery);
	const validation = await validatePlannedOperations(
		assetId,
		'vehicle-intent-highlight',
		plan.operations
	);

	return {
		assetId,
		matchedPaths: plan.matchedPaths,
		matchedMaterialNames: plan.matchedMaterialNames,
		operations: validation.operations,
		rejected: validation.rejected,
		summary:
			validation.operations.length > 0
				? `Highlighted ${plan.matchedMaterialNames.length} matching material region(s).`
				: 'No valid highlight targets were accepted.'
	};
}
