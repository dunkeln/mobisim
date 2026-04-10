import {
	planVehicleBodyPaint,
	planVehicleWindowTint
} from '$lib/server/connectors/gltf-preprocess';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import type { PlannedVehicleIntentResult, NormalizedVehiclePaintIntent } from './types';
import { parsePaintRequest, resolveNormalizedVehiclePaintIntent, parseWindowTint } from './paint';

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

export async function planVehiclePaintIntent(
	assetId: VehicleAssetId,
	colorRequest: string
): Promise<PlannedVehicleIntentResult & { resolvedColor: [number, number, number, number] }> {
	const resolvedPaint = parsePaintRequest(colorRequest);
	if (!resolvedPaint) {
		return {
			assetId,
			resolvedColor: [0, 0, 0, 1],
			operations: [],
			rejected: [],
			summary: 'Paint color could not be resolved.'
		};
	}

	const plan = await planVehicleBodyPaint(
		assetId,
		resolvedPaint.color,
		resolvedPaint.finish ?? undefined
	);
	const validation = await validatePlannedOperations(
		assetId,
		'vehicle-intent-body-paint',
		plan.operations
	);

	return {
		assetId,
		resolvedColor: resolvedPaint.color,
		operations: validation.operations,
		rejected: validation.rejected,
		summary:
			validation.operations.length > 0
				? `Applied ${resolvedPaint.finish?.label ? `${resolvedPaint.finish.label} ` : ''}body paint to ${plan.matchedMaterialNames.length} material region(s).`
				: 'No valid body paint operations were accepted.'
	};
}

export async function planNormalizedVehiclePaintIntent(
	assetId: VehicleAssetId,
	intent: NormalizedVehiclePaintIntent
): Promise<PlannedVehicleIntentResult & { resolvedColor: [number, number, number, number] }> {
	const resolvedPaint = resolveNormalizedVehiclePaintIntent(intent);
	if (!resolvedPaint) {
		return {
			assetId,
			resolvedColor: [0, 0, 0, 1],
			operations: [],
			rejected: [],
			summary: 'Normalized paint intent could not be resolved.'
		};
	}

	const plan = await planVehicleBodyPaint(
		assetId,
		resolvedPaint.color,
		resolvedPaint.finish ?? undefined
	);
	const validation = await validatePlannedOperations(
		assetId,
		'vehicle-intent-body-paint-normalized',
		plan.operations
	);

	return {
		assetId,
		resolvedColor: resolvedPaint.color,
		operations: validation.operations,
		rejected: validation.rejected,
		summary:
			validation.operations.length > 0
				? `Applied ${resolvedPaint.finish?.label ? `${resolvedPaint.finish.label} ` : ''}body paint to ${plan.matchedMaterialNames.length} material region(s).`
				: 'No valid normalized body paint operations were accepted.'
	};
}

export async function planVehicleWindowTintIntent(
	assetId: VehicleAssetId,
	tintRequest: string
): Promise<
	PlannedVehicleIntentResult & {
		resolvedTintLabel?: string;
		resolvedTintColor?: [number, number, number, number];
	}
> {
	const tint = parseWindowTint(tintRequest);
	if (!tint) {
		return {
			assetId,
			operations: [],
			rejected: [],
			summary: 'Window tint could not be resolved.'
		};
	}

	const plan = await planVehicleWindowTint(assetId, tint.label, tint.color);
	const validation = await validatePlannedOperations(
		assetId,
		'vehicle-intent-window-tint',
		plan.operations
	);

	return {
		assetId,
		resolvedTintLabel: tint.label,
		resolvedTintColor: tint.color,
		operations: validation.operations,
		rejected: validation.rejected,
		summary:
			validation.operations.length > 0
				? `Applied ${plan.resolvedLabel}.`
				: 'No valid window tint operations were accepted.'
	};
}
