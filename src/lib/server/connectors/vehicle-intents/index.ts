import {
	deriveVehicleInspectionCapabilities,
	planVehicleBodyPaint,
	planVehiclePartHighlight,
	planVehicleWindowTint,
	validateVehicleInspectionPatchManifest
} from '$lib/server/connectors/gltf-preprocess';
import type {
	VehicleInspectionPatchOperation,
	VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation
} from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';

const HEADLIGHT_ON_EMISSIVE: [number, number, number] = [1, 0.95, 0.82];
const NAMED_PAINT_COLORS: Record<string, [number, number, number]> = {
	black: [0.08, 0.08, 0.1],
	white: [0.92, 0.92, 0.94],
	silver: [0.72, 0.74, 0.78],
	gray: [0.45, 0.47, 0.5],
	grey: [0.45, 0.47, 0.5],
	red: [0.83, 0.1, 0.16],
	blue: [0.12, 0.24, 0.8],
	green: [0.12, 0.56, 0.26],
	yellow: [0.9, 0.72, 0.12],
	orange: [0.9, 0.42, 0.12],
	purple: [0.56, 0.42, 0.82]
};
const PAINT_COLOR_ALIASES: Record<string, [number, number, number]> = {
	'black panther purple': [0.29, 0.18, 0.46],
	'midnight purple': [0.31, 0.22, 0.47],
	'dark purple': [0.36, 0.24, 0.52],
	'deep purple': [0.39, 0.24, 0.58],
	'royal purple': [0.45, 0.28, 0.7],
	'metallic black': [0.09, 0.09, 0.12],
	'matte black': [0.06, 0.06, 0.07],
	'gunmetal gray': [0.3, 0.32, 0.36],
	'gunmetal grey': [0.3, 0.32, 0.36],
	'pearl white': [0.95, 0.95, 0.98]
};
const WINDOW_TINT_PRESETS: Array<{
	match: RegExp;
	label: string;
	color: [number, number, number, number];
}> = [
	{
		match: /\b5%\b.*\btint\b|\blimo tint\b/i,
		label: '5% dark tint',
		color: [0.04, 0.04, 0.05, 0.94]
	},
	{
		match: /\b15%\b.*\btint\b|\bdark tint\b/i,
		label: '15% dark tint',
		color: [0.08, 0.08, 0.1, 0.82]
	},
	{
		match: /\b20%\b.*\btint\b|\bsmoke tint\b/i,
		label: '20% smoke tint',
		color: [0.14, 0.14, 0.16, 0.74]
	},
	{
		match: /\b35%\b.*\btint\b|\blight tint\b/i,
		label: '35% light tint',
		color: [0.2, 0.2, 0.22, 0.58]
	},
	{ match: /\b50%\b.*\btint\b/i, label: '50% subtle tint', color: [0.28, 0.28, 0.3, 0.42] },
	{ match: /\bchrome tint\b/i, label: 'chrome tint', color: [0.64, 0.68, 0.74, 0.66] }
];

export type PlannedVehicleIntentResult = {
	assetId: VehicleAssetId;
	operations: SharedVehicleInspectionPatchOperation[];
	rejected: string[];
	summary: string;
};

function clampColorChannel(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function mixColorChannels(
	base: [number, number, number],
	target: [number, number, number],
	ratio: number
): [number, number, number] {
	return [
		base[0] + (target[0] - base[0]) * ratio,
		base[1] + (target[1] - base[1]) * ratio,
		base[2] + (target[2] - base[2]) * ratio
	];
}

function scaleColorChannels(
	color: [number, number, number],
	multiplier: number
): [number, number, number] {
	return [
		clampColorChannel(color[0] * multiplier),
		clampColorChannel(color[1] * multiplier),
		clampColorChannel(color[2] * multiplier)
	];
}

function applyPaintModifiers(
	input: string,
	baseColor: [number, number, number]
): [number, number, number] {
	let nextColor = [...baseColor] as [number, number, number];

	if (/\b(dark|darker|deep|midnight)\b/i.test(input)) {
		nextColor = scaleColorChannels(nextColor, 0.72);
	}

	if (/\b(light|lighter|pale)\b/i.test(input)) {
		nextColor = mixColorChannels(nextColor, [1, 1, 1], 0.18);
	}

	if (/\b(chrome|metallic|metal)\b/i.test(input)) {
		const average = (nextColor[0] + nextColor[1] + nextColor[2]) / 3;
		const desaturated = mixColorChannels(nextColor, [average, average, average], 0.28);
		nextColor = mixColorChannels(desaturated, [0.82, 0.84, 0.88], 0.12);
	}

	if (/\b(matte)\b/i.test(input)) {
		nextColor = scaleColorChannels(nextColor, 0.9);
	}

	if (/\b(pearl)\b/i.test(input)) {
		nextColor = mixColorChannels(nextColor, [0.96, 0.96, 0.98], 0.08);
	}

	return nextColor;
}

export function parsePaintColor(color: string): [number, number, number, number] | null {
	const trimmed = color.trim().toLowerCase();
	const directAlias = PAINT_COLOR_ALIASES[trimmed];
	if (directAlias) {
		return [directAlias[0], directAlias[1], directAlias[2], 1];
	}

	const named = NAMED_PAINT_COLORS[trimmed];
	if (named) {
		return [named[0], named[1], named[2], 1];
	}

	const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
	if (/^[0-9a-f]{6}$/i.test(hex)) {
		const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
		const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
		const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
		return [red, green, blue, 1];
	}

	if (/^[0-9a-f]{3}$/i.test(hex)) {
		const red = Number.parseInt(`${hex[0]}${hex[0]}`, 16) / 255;
		const green = Number.parseInt(`${hex[1]}${hex[1]}`, 16) / 255;
		const blue = Number.parseInt(`${hex[2]}${hex[2]}`, 16) / 255;
		return [red, green, blue, 1];
	}

	for (const [alias, aliasColor] of Object.entries(PAINT_COLOR_ALIASES)) {
		if (trimmed.includes(alias)) {
			const modifiedColor = applyPaintModifiers(trimmed, aliasColor);
			return [modifiedColor[0], modifiedColor[1], modifiedColor[2], 1];
		}
	}

	for (const [name, namedColor] of Object.entries(NAMED_PAINT_COLORS)) {
		if (trimmed.includes(name)) {
			const modifiedColor = applyPaintModifiers(trimmed, namedColor);
			return [modifiedColor[0], modifiedColor[1], modifiedColor[2], 1];
		}
	}

	return null;
}

export function parseWindowTint(
	tint: string
): { label: string; color: [number, number, number, number] } | null {
	const trimmed = tint.trim();

	for (const preset of WINDOW_TINT_PRESETS) {
		if (preset.match.test(trimmed)) {
			return {
				label: preset.label,
				color: preset.color
			};
		}
	}

	return null;
}

function shouldHighlightPart(request: string): boolean {
	return /\b(highlight|call out|focus on|mark|spotlight|isolate)\b/i.test(request);
}

function shouldTintWindows(request: string): boolean {
	return /\b(tint|smoke|chrome tint|window tint|windows|glass|windshield)\b/i.test(request);
}

function shouldPaintBody(request: string): boolean {
	return /\b(paint|repaint|body color|body paint|color the body|change the color|make it)\b/i.test(
		request
	);
}

export function isVehicleEditRequest(request: string): boolean {
	return (
		shouldHighlightPart(request) ||
		shouldTintWindows(request) ||
		shouldPaintBody(request) ||
		/\b(headlight|headlights|wireframe|postprocess|post-processing)\b/i.test(request)
	);
}

function extractHighlightQuery(request: string): string {
	return request
		.replace(/\b(highlight|call out|focus on|mark|spotlight|isolate)\b/gi, ' ')
		.replace(/\b(the|a|an|please|car|vehicle|part|parts)\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function isDisableRequest(request: string): boolean {
	return /\b(off|disable|disabled|without|hide|remove|plain)\b/i.test(request);
}

async function validatePlannedOperations(
	assetId: VehicleAssetId,
	presetId: string,
	operations: VehicleInspectionPatchOperation[],
	baseGeneratedAt?: string
): Promise<PlannedVehicleIntentResult> {
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

function inferHeadlightMaterials(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>
) {
	return capabilities.materials.filter((material) => {
		const name = material.name.toLowerCase();
		return (
			material.textureSlots.includes('emissiveTexture') ||
			name.includes('headlight') ||
			name.includes('headlamp') ||
			name.includes('lamp') ||
			name.includes('light')
		);
	});
}

function mergePatchOperations(
	current: SharedVehicleInspectionPatchOperation[],
	incoming: SharedVehicleInspectionPatchOperation[]
): SharedVehicleInspectionPatchOperation[] {
	const merged = new Map(
		current.map((operation) => [
			`${operation.targetType}:${operation.targetId}:${operation.op}`,
			operation
		])
	);

	for (const operation of incoming) {
		merged.set(`${operation.targetType}:${operation.targetId}:${operation.op}`, operation);
	}

	return Array.from(merged.values());
}

export async function planVehicleEditOperations(
	assetId: VehicleAssetId,
	request: string
): Promise<PlannedVehicleIntentResult> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const operations: VehicleInspectionPatchOperation[] = [];
	const requestText = request.toLowerCase();
	const disable = isDisableRequest(request);

	if (requestText.includes('wireframe')) {
		operations.push({
			targetType: 'viewer',
			targetId: 'wireframe',
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

	if (requestText.includes('headlight') || requestText.includes('headlights')) {
		for (const material of inferHeadlightMaterials(capabilities)) {
			operations.push({
				targetType: 'material',
				targetId: material.id,
				targetName: material.name,
				op: 'set_emissive_factor',
				value: disable ? [0, 0, 0] : HEADLIGHT_ON_EMISSIVE
			});
		}
	}

	if (operations.length === 0) {
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

export async function planVehicleHighlightIntent(
	assetId: VehicleAssetId,
	query: string
): Promise<
	PlannedVehicleIntentResult & { matchedPaths: string[]; matchedMaterialNames: string[] }
> {
	const normalizedQuery = query.trim();
	const plan = await planVehiclePartHighlight(assetId, normalizedQuery);
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

export async function planVehiclePaintIntent(
	assetId: VehicleAssetId,
	colorRequest: string
): Promise<PlannedVehicleIntentResult & { resolvedColor: [number, number, number, number] }> {
	const resolvedColor = parsePaintColor(colorRequest);
	if (!resolvedColor) {
		return {
			assetId,
			resolvedColor: [0, 0, 0, 1],
			operations: [],
			rejected: [],
			summary: 'Paint color could not be resolved.'
		};
	}

	const plan = await planVehicleBodyPaint(assetId, resolvedColor);
	const validation = await validatePlannedOperations(
		assetId,
		'vehicle-intent-body-paint',
		plan.operations
	);

	return {
		assetId,
		resolvedColor,
		operations: validation.operations,
		rejected: validation.rejected,
		summary:
			validation.operations.length > 0
				? `Applied body paint to ${plan.matchedMaterialNames.length} material region(s).`
				: 'No valid body paint operations were accepted.'
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

export async function resolveVehicleIntent(
	assetId: VehicleAssetId,
	request: string
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

	if (shouldHighlightPart(trimmedRequest)) {
		matchedIntent = true;
		const query = extractHighlightQuery(trimmedRequest);
		const highlightPlan = await planVehicleHighlightIntent(assetId, query || trimmedRequest);

		plannedOperations = mergePatchOperations(plannedOperations, highlightPlan.operations);
		rejected.push(...highlightPlan.rejected);
		summaryParts.push(highlightPlan.summary);
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
		matchedIntent = true;
		plannedOperations = mergePatchOperations(plannedOperations, editPlan.operations);
		rejected.push(...editPlan.rejected);
		summaryParts.push(editPlan.summary);
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
