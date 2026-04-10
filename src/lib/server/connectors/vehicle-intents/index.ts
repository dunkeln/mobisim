import { deriveVehicleInspectionCapabilities } from '$lib/server/connectors/gltf-preprocess';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type { VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation } from '$lib/contracts/vehicle-inspection-patches';
import {
	resolveSemanticLightingEdits,
	resolveLightingCategories
} from './lighting';
import {
	mergePatchOperations
} from './patch-ops';
import {
	shouldHighlightPart,
	shouldTintWindows,
	shouldPaintBody,
	isLightingGlowRequest,
	extractHighlightQuery,
	inferPartIntentMode,
	isDisableRequest
} from './classifiers';
import { planVehiclePartIntent, planVehicleSetLogicIntent } from './part-intent';
import { planVehicleHighlightIntent } from './highlight';
import { planVehiclePaintIntent, planNormalizedVehiclePaintIntent, planVehicleWindowTintIntent } from './paint-intent';
import type { PlannedVehicleIntentResult, VehicleIntentPresentationContext } from './types';

// Re-export all public types and functions from submodules
export type {
	PlannedVehicleIntentResult,
	VehiclePartIntentMode,
	PlannedVehiclePartIntentResult,
	VehiclePlannerTargetExpression,
	VehiclePlannerStep,
	VehiclePlannerConstraint,
	VehiclePlannerJob,
	VehiclePlannerVerification,
	PlannedVehicleSetLogicIntentResult,
	VehicleIntentPresentationContext,
	NormalizedVehiclePaintIntent
} from './types';

export {
	HEADLIGHT_ON_EMISSIVE,
	TAILLIGHT_ON_EMISSIVE,
	ISOLATE_CONTEXT_ALPHA,
	REMOVE_PART_ALPHA,
	NAMED_PAINT_COLORS,
	PAINT_COLOR_ALIASES,
	WINDOW_TINT_PRESETS,
	LIGHTING_SCOPE_CONFIG,
	type LightingSemanticCategory
} from './constants';

export {
	formatSemanticTargetName,
	parsePaintColor,
	parsePaintRequest,
	resolveNormalizedVehiclePaintIntent,
	parseWindowTint
} from './paint';

export {
	isVehicleEditRequest,
	extractHighlightQuery,
	normalizePartQuery,
	requestNeedsHighlightedIntersection,
	requestPreservesCurrentPaint,
	inferPartIntentMode,
	isDisableRequest
} from './classifiers';

export {
	isLightingMaterialEligible,
	resolveLightingCategories,
	resolveSemanticLightingEdits
} from './lighting';

export {
	mergePatchOperations,
	buildNodeIdsByPath,
	collectNodeTargetsFromMaterials,
	mapIntentModeToActionSupport,
	collectEntityMatchedPaths,
	collectEntityMatchedNodeIds,
	collectPartMatchedPaths,
	collectPartMatchedNodeIds,
	collectVisibleNodeIdsForIsolation
} from './patch-ops';

export {
	sanitizePlannerKeepQuery,
	splitPlannerKeepQueries,
	buildPlannerUnionExpression,
	extractRemoveOverrideQueries,
	extractRemoveAllExceptExpression,
	flattenSemanticQueries,
	tokenizeSemanticQuery,
	scoreSemanticEntityMatch
} from './planner';

export { planVehiclePartIntent, planVehicleSetLogicIntent } from './part-intent';
export { planVehicleHighlightIntent } from './highlight';
export { planVehiclePaintIntent, planNormalizedVehiclePaintIntent, planVehicleWindowTintIntent } from './paint-intent';

// Main exported functions
async function validatePlannedOperations(
	assetId: VehicleAssetId,
	presetId: string,
	operations: SharedVehicleInspectionPatchOperation[],
	baseGeneratedAt?: string
): Promise<PlannedVehicleIntentResult> {
	const { validateVehicleInspectionPatchManifest } = await import('$lib/server/connectors/gltf-preprocess');
	const validation = await validateVehicleInspectionPatchManifest({
		assetId,
		baseGeneratedAt,
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

export async function planVehicleEditOperations(
	assetId: VehicleAssetId,
	request: string
): Promise<PlannedVehicleIntentResult> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const operations: SharedVehicleInspectionPatchOperation[] = [];
	const requestText = request.toLowerCase();
	const disable = isDisableRequest(request);
	const requestedLightingCategories = resolveLightingCategories(requestText);

	if (requestText.includes('wireframe')) {
		operations.push({
			targetType: 'viewer',
			targetId: 'wireframe',
			op: 'set_enabled',
			value: !disable
		});
	}

	if (requestText.includes('xray') || requestText.includes('x-ray')) {
		operations.push({
			targetType: 'viewer',
			targetId: 'xray',
			op: 'set_enabled',
			value: !disable
		});
	}

	if (
		requestText.includes('uv debug') ||
		requestText.includes('uv_debug') ||
		/\buv\b/.test(requestText)
	) {
		operations.push({
			targetType: 'viewer',
			targetId: 'uv_debug',
			op: 'set_enabled',
			value: !disable
		});
	}

	if (requestText.includes('postprocess') || requestText.includes('post-processing')) {
		operations.push({
			targetType: 'viewer',
			targetId: 'postprocess',
			op: 'set_enabled',
			value: !disable
		});
	}

	operations.push(...(await resolveSemanticLightingEdits(capabilities, requestText, disable)));

	if (operations.length === 0) {
		if (requestedLightingCategories.length > 0) {
			return {
				assetId,
				operations: [],
				rejected: [],
				summary: `No accepted executable semantic lighting targets were found for ${requestedLightingCategories.join(', ')}.`
			};
		}

		return {
			assetId,
			operations: [],
			rejected: [],
			summary: 'No supported viewer or material edits matched the request.'
		};
	}

	return validatePlannedOperations(
		assetId,
		'vehicle-intent-live',
		operations,
		capabilities.generatedAt
	);
}

export async function resolveVehicleIntent(
	assetId: VehicleAssetId,
	request: string,
	options?: {
		presentation?: VehicleIntentPresentationContext;
	}
): Promise<PlannedVehicleIntentResult> {
	const trimmedRequest = request.trim();

	if (!trimmedRequest) {
		return {
			assetId,
			operations: [],
			rejected: [],
			summary: 'No request was provided.'
		};
	}

	let plannedOperations: SharedVehicleInspectionPatchOperation[] = [];
	const rejected: string[] = [];
	const summaryParts: string[] = [];
	let matchedIntent = false;
	const semanticPartMode = inferPartIntentMode(trimmedRequest);
	const prioritizeLightingEdit =
		isLightingGlowRequest(trimmedRequest) && /\b(turn|enable|disable|on|off)\b/i.test(trimmedRequest);

	if (!prioritizeLightingEdit) {
		const setLogicPlan = await planVehicleSetLogicIntent(assetId, trimmedRequest, options);
		if (setLogicPlan) {
			return setLogicPlan;
		}
	}

	// "remove front lights" has remove-intent but isLightingGlowRequest also matches because
	// "remove" appears in its second pattern.  When the part mode is explicitly 'remove' and
	// there are no toggle verbs (turn/on/off/enable/disable/glow/lit) we treat it as a part
	// removal (set_alpha) rather than a lighting emissive toggle.
	const isPartRemovalIntent =
		semanticPartMode === 'remove' &&
		isLightingGlowRequest(trimmedRequest) &&
		!/\b(turn|enable|disable|on|off|glow|glowing|lit|light up)\b/i.test(trimmedRequest);

	if (shouldHighlightPart(trimmedRequest) && (!isLightingGlowRequest(trimmedRequest) || isPartRemovalIntent)) {
		matchedIntent = true;
		const query = extractHighlightQuery(trimmedRequest);
		if (semanticPartMode === 'highlight') {
			const highlightPlan = await planVehicleHighlightIntent(assetId, query || trimmedRequest);

			plannedOperations = mergePatchOperations(plannedOperations, highlightPlan.operations);
			rejected.push(...highlightPlan.rejected);
			summaryParts.push(highlightPlan.summary);
		} else {
			const partPlan = await planVehiclePartIntent(
				assetId,
				query || trimmedRequest,
				semanticPartMode
			);
			plannedOperations = mergePatchOperations(plannedOperations, partPlan.operations);
			summaryParts.push(partPlan.summary);
		}
	}

	if (shouldTintWindows(trimmedRequest)) {
		matchedIntent = true;
		const tintPlan = await planVehicleWindowTintIntent(assetId, trimmedRequest);

		plannedOperations = mergePatchOperations(plannedOperations, tintPlan.operations);
		rejected.push(...tintPlan.rejected);
		summaryParts.push(tintPlan.summary);
	}

	if (shouldPaintBody(trimmedRequest)) {
		matchedIntent = true;
		const paintPlan = await planVehiclePaintIntent(assetId, trimmedRequest);

		plannedOperations = mergePatchOperations(plannedOperations, paintPlan.operations);
		rejected.push(...paintPlan.rejected);
		summaryParts.push(paintPlan.summary);
	}

	const editPlan = await planVehicleEditOperations(assetId, trimmedRequest);
	if (editPlan.operations.length > 0 || editPlan.rejected.length > 0) {
		// When a part-intent already claimed this request (highlight, focus, isolate, remove) and
		// there is no explicit lighting toggle verb, suppress any material-level lighting ops that
		// planVehicleEditOperations may have emitted.  This prevents "highlight front lights" from
		// also enabling the emissive factor as a side-effect.
		const hasExplicitLightingToggle =
			/\b(turn on|turn off|enable|disable|glow|glowing|lit|light up)\b/i.test(trimmedRequest);
		const effectiveOps =
			matchedIntent && !hasExplicitLightingToggle
				? editPlan.operations.filter((op) => op.targetType !== 'material')
				: editPlan.operations;
		if (effectiveOps.length > 0 || editPlan.rejected.length > 0) {
			matchedIntent = true;
			plannedOperations = mergePatchOperations(plannedOperations, effectiveOps);
			rejected.push(...editPlan.rejected);
			summaryParts.push(editPlan.summary);
		}
	}

	if (prioritizeLightingEdit && !matchedIntent) {
		const setLogicPlan = await planVehicleSetLogicIntent(assetId, trimmedRequest, options);
		if (setLogicPlan) {
			return setLogicPlan;
		}
	}

	if (!matchedIntent) {
		return editPlan;
	}

	return {
		assetId,
		operations: plannedOperations,
		rejected,
		summary: summaryParts.join(' ')
	};
}
