import {
	deriveVehicleInspectionCapabilities,
	planVehicleBodyPaint,
	planVehiclePartHighlight,
	planVehicleWindowTint,
	validateVehicleInspectionPatchManifest
} from '$lib/server/connectors/gltf-preprocess';
import { deriveStructuralAssetSnapshot } from '$lib/server/connectors/gltf-structure';
import {
	listSemanticGroupsByQuery,
	listSemanticMaterialsByTags,
	listSemanticPartsByQuery
} from '$lib/server/connectors/vehicle-semantic-overlay';
import type {
	VehicleInspectionPatchOperation,
	VehicleInspectionPatchOperation as SharedVehicleInspectionPatchOperation
} from '$lib/contracts/vehicle-inspection-patches';
import type { VehicleAssetId } from '$lib/vehicles/catalog';
import type {
	VehicleSemanticActionSupport,
	VehicleSemanticGroup,
	VehicleSemanticPartUnit
} from '$lib/server/connectors/vehicle-semantic-overlay/types';

const HEADLIGHT_ON_EMISSIVE: [number, number, number] = [1, 0.95, 0.82];
const EXPLODE_SCALE = 0.5; // explosion distance as a fraction of radial distance from vehicle center
const EXPLODE_MIN_RATIO = 0.1; // minimum explosion distance as a fraction of vehicle bounding diagonal
const ISOLATE_CONTEXT_ALPHA = 0.18;
const ISOLATE_HIGHLIGHT_FACTOR: [number, number, number, number] = [0.64, 0.68, 0.9, 0.96];
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
	'midnight purple': [0.19, 0.12, 0.31],
	'dark purple': [0.22, 0.12, 0.34],
	'deep purple': [0.28, 0.14, 0.42],
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

export type VehicleHeadlightSupport = {
	assetId: VehicleAssetId;
	supported: boolean;
	materialNames: string[];
	materialIds: string[];
	taillightMaterialNames: string[];
};

export type VehiclePartIntentMode = 'highlight' | 'focus' | 'isolate' | 'explode';

export type PlannedVehiclePartIntentResult = {
	assetId: VehicleAssetId;
	mode: VehiclePartIntentMode;
	partQuery: string;
	matchedPartIds: string[];
	matchedPartLabels: string[];
	matchedNodeIds: string[];
	matchedMaterialIds: string[];
	matchedPaths: string[];
	matchedMaterialNames: string[];
	operations: SharedVehicleInspectionPatchOperation[];
	summary: string;
};

type VehiclePaintFinish = {
	metalness?: number;
	roughness?: number;
	envMapIntensity?: number;
	label?: string;
};

export type NormalizedVehiclePaintIntent = {
	colorFamily: string;
	shade?: 'very_dark' | 'dark' | 'medium' | 'light' | 'very_light';
	saturation?: 'muted' | 'balanced' | 'vivid';
	finish?: 'solid' | 'metallic' | 'chrome' | 'matte' | 'pearl' | 'gloss';
	hex?: string;
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

function desaturateColor(
	color: [number, number, number],
	ratio: number
): [number, number, number] {
	const average = (color[0] + color[1] + color[2]) / 3;
	return mixColorChannels(color, [average, average, average], ratio);
}

function boostColorSaturation(
	color: [number, number, number],
	strength: number
): [number, number, number] {
	const average = (color[0] + color[1] + color[2]) / 3;
	return [
		clampColorChannel(average + (color[0] - average) * strength),
		clampColorChannel(average + (color[1] - average) * strength),
		clampColorChannel(average + (color[2] - average) * strength)
	];
}

function applyPaintModifiers(
	input: string,
	baseColor: [number, number, number]
): [number, number, number] {
	let nextColor = [...baseColor] as [number, number, number];

	if (/\b(dark|darker|deep|midnight)\b/i.test(input)) {
		nextColor = scaleColorChannels(nextColor, 0.58);
	}

	if (/\b(light|lighter|pale)\b/i.test(input)) {
		nextColor = mixColorChannels(nextColor, [1, 1, 1], 0.18);
	}

	if (/\b(matte)\b/i.test(input)) {
		nextColor = scaleColorChannels(nextColor, 0.82);
	}

	if (/\b(pearl)\b/i.test(input)) {
		nextColor = mixColorChannels(nextColor, [0.96, 0.96, 0.98], 0.08);
	}

	return nextColor;
}

function parsePaintFinish(input: string): VehiclePaintFinish | null {
	const normalized = input.trim().toLowerCase();

	if (/\bchrome\b/.test(normalized)) {
		return {
			label: 'chrome',
			metalness: 1,
			roughness: 0.08,
			envMapIntensity: 1.85
		};
	}

	if (/\b(metallic|metal)\b/.test(normalized)) {
		return {
			label: 'metallic',
			metalness: 0.88,
			roughness: 0.18,
			envMapIntensity: 1.45
		};
	}

	if (/\bmatte\b/.test(normalized)) {
		return {
			label: 'matte',
			metalness: 0.08,
			roughness: 0.86,
			envMapIntensity: 0.72
		};
	}

	if (/\bpearl\b/.test(normalized)) {
		return {
			label: 'pearl',
			metalness: 0.24,
			roughness: 0.26,
			envMapIntensity: 1.3
		};
	}

	if (/\bgloss|glossy|clear coat|clearcoat\b/.test(normalized)) {
		return {
			label: 'gloss',
			metalness: 0.16,
			roughness: 0.14,
			envMapIntensity: 1.2
		};
	}

	return null;
}

function parseHexColor(hexInput: string): [number, number, number] | null {
	const hex = hexInput.trim().toLowerCase().replace(/^#/, '');
	if (/^[0-9a-f]{6}$/i.test(hex)) {
		return [
			Number.parseInt(hex.slice(0, 2), 16) / 255,
			Number.parseInt(hex.slice(2, 4), 16) / 255,
			Number.parseInt(hex.slice(4, 6), 16) / 255
		];
	}

	if (/^[0-9a-f]{3}$/i.test(hex)) {
		return [
			Number.parseInt(`${hex[0]}${hex[0]}`, 16) / 255,
			Number.parseInt(`${hex[1]}${hex[1]}`, 16) / 255,
			Number.parseInt(`${hex[2]}${hex[2]}`, 16) / 255
		];
	}

	return null;
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

export function parsePaintRequest(input: string): {
	color: [number, number, number, number];
	finish: VehiclePaintFinish | null;
} | null {
	const color = parsePaintColor(input);
	if (!color) {
		return null;
	}

	return {
		color,
		finish: parsePaintFinish(input)
	};
}

function resolveColorFamilyBase(colorFamily: string): [number, number, number] | null {
	const normalized = colorFamily.trim().toLowerCase();
	return PAINT_COLOR_ALIASES[normalized] ?? NAMED_PAINT_COLORS[normalized] ?? null;
}

function applyNormalizedShade(
	color: [number, number, number],
	shade: NormalizedVehiclePaintIntent['shade']
): [number, number, number] {
	switch (shade) {
		case 'very_dark':
			return scaleColorChannels(color, 0.42);
		case 'dark':
			return scaleColorChannels(color, 0.58);
		case 'light':
			return mixColorChannels(color, [1, 1, 1], 0.16);
		case 'very_light':
			return mixColorChannels(color, [1, 1, 1], 0.28);
		case 'medium':
		default:
			return color;
	}
}

function applyNormalizedSaturation(
	color: [number, number, number],
	saturation: NormalizedVehiclePaintIntent['saturation']
): [number, number, number] {
	switch (saturation) {
		case 'muted':
			return desaturateColor(color, 0.22);
		case 'vivid':
			return boostColorSaturation(color, 1.18);
		case 'balanced':
		default:
			return color;
	}
}

function finishFromNormalizedIntent(
	finish: NormalizedVehiclePaintIntent['finish']
): VehiclePaintFinish | null {
	if (!finish || finish === 'solid') {
		return null;
	}

	return parsePaintFinish(finish);
}

export function resolveNormalizedVehiclePaintIntent(intent: NormalizedVehiclePaintIntent): {
	color: [number, number, number, number];
	finish: VehiclePaintFinish | null;
} | null {
	const baseColor =
		(intent.hex ? parseHexColor(intent.hex) : null) ?? resolveColorFamilyBase(intent.colorFamily);
	if (!baseColor) {
		return null;
	}

	const shaded = applyNormalizedShade(baseColor, intent.shade ?? 'medium');
	const saturated = applyNormalizedSaturation(shaded, intent.saturation ?? 'balanced');

	return {
		color: [saturated[0], saturated[1], saturated[2], 1],
		finish: finishFromNormalizedIntent(intent.finish)
	};
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
	return /\b(highlight|call out|focus on|focus|mark|spotlight|isolate|show only|only show|explode|pull out|bring out|expand out|separate out)\b/i.test(request);
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
		/\b(headlight|headlights|wireframe|xray|x-ray|postprocess|post-processing)\b/i.test(request)
	);
}

function extractHighlightQuery(request: string): string {
	return request
		.replace(/\b(highlight|call out|focus on|focus|mark|spotlight|isolate|show only|only show|explode|pull out|bring out|expand out|separate out)\b/gi, ' ')
		.replace(/\b(the|a|an|please|car|vehicle|part|parts)\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizePartQuery(request: string): string {
	const normalized = extractHighlightQuery(request);
	return normalized || request.trim();
}

function inferPartIntentMode(request: string): VehiclePartIntentMode {
	if (/\bexplode|pull out|bring out|expand out|separate out\b/i.test(request)) {
		return 'explode';
	}

	if (/\bisolate|show only|only show\b/i.test(request)) {
		return 'isolate';
	}

	if (/\bfocus on|focus\b/i.test(request)) {
		return 'focus';
	}

	return 'highlight';
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

async function inferHeadlightMaterials(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>
) {
	const semanticMatches = await listSemanticMaterialsByTags(
		capabilities.assetId,
		capabilities.generatedAt,
		['left_headlight', 'right_headlight']
	);
	if (semanticMatches.length > 0) {
		const semanticIds = new Set(semanticMatches.map((material) => material.targetId));
		return capabilities.materials.filter((material) => semanticIds.has(material.id));
	}

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

async function inferTaillightMaterials(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>
) {
	return capabilities.materials.filter((material) => {
		const name = material.name.toLowerCase();
		return (
			name.includes('taillight') ||
			name.includes('tail_light') ||
			name.includes('tail light') ||
			name.includes('stoplight') ||
			name.includes('stop_light') ||
			name.includes('brakelight') ||
			name.includes('brake_light') ||
			name.includes('rear light')
		);
	});
}

export async function getVehicleHeadlightSupport(
	assetId: VehicleAssetId
): Promise<VehicleHeadlightSupport> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const materials = await inferHeadlightMaterials(capabilities);
	const taillightMaterials = await inferTaillightMaterials(capabilities);

	return {
		assetId,
		supported: materials.length > 0,
		materialNames: materials.map((material) => material.name),
		materialIds: materials.map((material) => material.id),
		taillightMaterialNames: taillightMaterials.map((material) => material.name)
	};
}

export async function planVehicleHeadlightIntent(
	assetId: VehicleAssetId,
	enabled: boolean
): Promise<PlannedVehicleIntentResult & VehicleHeadlightSupport> {
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const materials = await inferHeadlightMaterials(capabilities);

	if (materials.length === 0) {
		return {
			assetId,
			supported: false,
			materialNames: [],
			materialIds: [],
			taillightMaterialNames: [],
			operations: [],
			rejected: [],
			summary: 'No headlight materials were identified for this asset.'
		};
	}

	const validation = await validatePlannedOperations(
		assetId,
		'vehicle-intent-headlights',
		materials.map((material) => ({
			targetType: 'material' as const,
			targetId: material.id,
			targetName: material.name,
			op: 'set_emissive_factor' as const,
			value: enabled ? HEADLIGHT_ON_EMISSIVE : [0, 0, 0]
		})),
		capabilities.generatedAt
	);

	return {
		assetId,
		supported: true,
		materialNames: materials.map((material) => material.name),
		materialIds: materials.map((material) => material.id),
		taillightMaterialNames: [],
		operations: validation.operations,
		rejected: validation.rejected,
		summary:
			validation.operations.length > 0
				? enabled
					? 'Turned headlights on.'
					: 'Turned headlights off.'
				: 'No valid headlight operations were accepted.'
	};
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

function mapIntentModeToActionSupport(mode: VehiclePartIntentMode): VehicleSemanticActionSupport {
	switch (mode) {
		case 'focus':
			return 'focus';
		case 'isolate':
			return 'isolate';
		case 'explode':
			return 'explode';
		default:
			return 'highlight';
	}
}

function collectEntityMatchedPaths(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>,
	entities: Array<Pick<VehicleSemanticPartUnit, 'nodeIds' | 'meshIds' | 'materialIds'>>
): string[] {
	return collectPartMatchedPaths(capabilities, entities as VehicleSemanticPartUnit[]);
}

function collectEntityMatchedNodeIds(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	entities: Array<Pick<VehicleSemanticPartUnit, 'nodeIds' | 'meshIds' | 'materialIds'>>
): string[] {
	return collectPartMatchedNodeIds(structure, entities as VehicleSemanticPartUnit[]);
}

function collectNodeIdsByNameQuery(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	query: string
): string[] {
	const baseTerms = query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((term) => term.length > 1);

	// Expand with singular/plural variants so "wheels" matches "Wheel_FL" and vice versa
	const terms = Array.from(
		new Set(
			baseTerms.flatMap((term) =>
				term.endsWith('s') && term.length > 2
					? [term, term.slice(0, -1)]
					: [term, `${term}s`]
			)
		)
	);

	if (terms.length === 0) {
		return [];
	}

	const matched = new Set<string>();
	for (const node of structure.nodes) {
		if (!node.meshId) {
			continue;
		}

		const haystack = `${node.name} ${node.path}`.toLowerCase();
		if (terms.some((term) => haystack.includes(term))) {
			matched.add(node.id);
		}
	}

	return Array.from(matched).sort((left, right) => left.localeCompare(right));
}

function collectPartMatchedPaths(
	capabilities: Awaited<ReturnType<typeof deriveVehicleInspectionCapabilities>>,
	parts: VehicleSemanticPartUnit[]
): string[] {
	const nodeIdToPath = new Map(
		capabilities.controlCandidates.map((candidate) => [candidate.nodeId, candidate.path])
	);
	const meshIdToPaths = new Map<string, Set<string>>();
	for (const candidate of capabilities.controlCandidates) {
		if (!candidate.meshId) {
			continue;
		}

		const existing = meshIdToPaths.get(candidate.meshId) ?? new Set<string>();
		existing.add(candidate.path);
		meshIdToPaths.set(candidate.meshId, existing);
	}

	const materialIdToPaths = new Map(
		capabilities.materials.map((material) => [material.id, material.nodePaths])
	);
	const matchedPaths = new Set<string>();

	for (const part of parts) {
		for (const nodeId of part.nodeIds) {
			const path = nodeIdToPath.get(nodeId);
			if (path) {
				matchedPaths.add(path);
			}
		}

		for (const meshId of part.meshIds) {
			for (const path of meshIdToPaths.get(meshId) ?? []) {
				matchedPaths.add(path);
			}
		}

		for (const materialId of part.materialIds) {
			for (const path of materialIdToPaths.get(materialId) ?? []) {
				matchedPaths.add(path);
			}
		}
	}

	return Array.from(matchedPaths).sort((left, right) => left.localeCompare(right));
}

function collectPartMatchedNodeIds(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	parts: VehicleSemanticPartUnit[]
): string[] {
	const matchedNodeIds = new Set<string>();
	const nodeIdsByMeshId = new Map<string, string[]>();
	const nodeIdsByMaterialId = new Map<string, string[]>();

	for (const node of structure.nodes) {
		if (!node.meshId) {
			continue;
		}

		const meshNodeIds = nodeIdsByMeshId.get(node.meshId) ?? [];
		meshNodeIds.push(node.id);
		nodeIdsByMeshId.set(node.meshId, meshNodeIds);
	}

	for (const material of structure.materials) {
		nodeIdsByMaterialId.set(material.id, material.nodeIds);
	}

	for (const part of parts) {
		for (const nodeId of part.nodeIds) {
			matchedNodeIds.add(nodeId);
		}

		for (const meshId of part.meshIds) {
			for (const nodeId of nodeIdsByMeshId.get(meshId) ?? []) {
				matchedNodeIds.add(nodeId);
			}
		}

		for (const materialId of part.materialIds) {
			for (const nodeId of nodeIdsByMaterialId.get(materialId) ?? []) {
				matchedNodeIds.add(nodeId);
			}
		}
	}

	return Array.from(matchedNodeIds).sort((left, right) => left.localeCompare(right));
}

function collectVisibleNodeIdsForIsolation(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	matchedNodeIds: string[]
): Set<string> {
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const visibleNodeIds = new Set<string>();

	for (const nodeId of matchedNodeIds) {
		let currentId: string | null = nodeId;
		while (currentId) {
			if (visibleNodeIds.has(currentId)) {
				break;
			}

			visibleNodeIds.add(currentId);
			currentId = nodeById.get(currentId)?.parentId ?? null;
		}
	}

	return visibleNodeIds;
}

function getVehicleCenter(structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>): [
	number,
	number,
	number
] {
	const primaryScene = structure.scenes[0];
	if (!primaryScene) {
		return [0, 0, 0];
	}

	return [
		(primaryScene.bounds.min[0] + primaryScene.bounds.max[0]) / 2,
		(primaryScene.bounds.min[1] + primaryScene.bounds.max[1]) / 2,
		(primaryScene.bounds.min[2] + primaryScene.bounds.max[2]) / 2
	];
}

function getSelectionCentroid(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	matchedNodeIds: string[]
): [number, number, number] {
	const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
	const matchedNodes = matchedNodeIds
		.map((nodeId) => nodeById.get(nodeId))
		.filter((node): node is NonNullable<typeof node> => node !== undefined);

	if (matchedNodes.length === 0) {
		return getVehicleCenter(structure);
	}

	const bounds = matchedNodes.reduce<{
		min: [number, number, number];
		max: [number, number, number];
	}>(
		(accumulator, node) => {
			const min = node.bounds?.min ?? node.worldTranslation;
			const max = node.bounds?.max ?? node.worldTranslation;
			return {
				min: [
					Math.min(accumulator.min[0], min[0]),
					Math.min(accumulator.min[1], min[1]),
					Math.min(accumulator.min[2], min[2])
				],
				max: [
					Math.max(accumulator.max[0], max[0]),
					Math.max(accumulator.max[1], max[1]),
					Math.max(accumulator.max[2], max[2])
				]
			};
		},
		{
			min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
			max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
		}
	);

	return [
		(bounds.min[0] + bounds.max[0]) / 2,
		(bounds.min[1] + bounds.max[1]) / 2,
		(bounds.min[2] + bounds.max[2]) / 2
	];
}

function getNodeCenter(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	nodeId: string
): [number, number, number] {
	const node = structure.nodes.find((entry) => entry.id === nodeId);
	return node?.bounds?.center ?? node?.worldTranslation ?? getSelectionCentroid(structure, [nodeId]);
}

function scaleExplodeVector(
	vector: [number, number, number],
	distance: number
): [number, number, number] {
	const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
	if (magnitude === 0) {
		return [0, 0, distance];
	}

	return [
		(vector[0] / magnitude) * distance,
		(vector[1] / magnitude) * distance,
		(vector[2] / magnitude) * distance
	];
}

function computeExplodeOffsetForNode(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	nodeId: string
): [number, number, number] {
	const vehicleCenter = getVehicleCenter(structure);
	const nodeCenter = getNodeCenter(structure, nodeId);

	const primaryScene = structure.scenes[0];
	const vehicleDiagonal = primaryScene
		? Math.hypot(
				primaryScene.bounds.max[0] - primaryScene.bounds.min[0],
				primaryScene.bounds.max[1] - primaryScene.bounds.min[1],
				primaryScene.bounds.max[2] - primaryScene.bounds.min[2]
			)
		: 2;
	const minDistance = vehicleDiagonal * EXPLODE_MIN_RATIO;

	// Project onto the horizontal plane: parts spread outward in XZ only.
	// Using the full 3D vehicle center as the Y reference pulls low-mounted parts
	// (wheels, sills) downward, causing the "implosion" effect. Ignoring Y keeps
	// the explosion a clean radial spread with no unintended vertical pull.
	const radialVector: [number, number, number] = [
		nodeCenter[0] - vehicleCenter[0],
		0,
		nodeCenter[2] - vehicleCenter[2]
	];
	const radialMagnitude = Math.hypot(radialVector[0], radialVector[2]);

	if (radialMagnitude > 0.0001) {
		return scaleExplodeVector(radialVector, Math.max(radialMagnitude * EXPLODE_SCALE, minDistance));
	}

	// Node sits on the vehicle's vertical axis (e.g. central interior) — push straight up
	return [0, minDistance, 0];
}

function computeGroundClearanceLift(
	structure: Awaited<ReturnType<typeof deriveStructuralAssetSnapshot>>,
	explodeOffsets: Map<string, [number, number, number]>
): number {
	let minimumY = Number.POSITIVE_INFINITY;

	for (const node of structure.nodes) {
		const offset = explodeOffsets.get(node.id) ?? [0, 0, 0];
		const baseMinY = node.bounds?.min[1] ?? node.worldTranslation[1];
		minimumY = Math.min(minimumY, baseMinY + offset[1]);
	}

	if (!Number.isFinite(minimumY) || minimumY >= 0) {
		return 0;
	}

	return -minimumY;
}

export async function planVehiclePartIntent(
	assetId: VehicleAssetId,
	partQuery: string,
	mode: VehiclePartIntentMode = 'highlight'
): Promise<PlannedVehiclePartIntentResult> {
	const normalizedQuery = normalizePartQuery(partQuery);
	const capabilities = await deriveVehicleInspectionCapabilities(assetId);
	const structure = await deriveStructuralAssetSnapshot(assetId);
	const matchedGroups = await listSemanticGroupsByQuery(
		assetId,
		capabilities.generatedAt,
		normalizedQuery,
		mapIntentModeToActionSupport(mode)
	);
	const matchedParts = matchedGroups.length
		? []
		: await listSemanticPartsByQuery(assetId, capabilities.generatedAt, normalizedQuery);
	const matchedEntities: Array<VehicleSemanticGroup | VehicleSemanticPartUnit> =
		matchedGroups.length > 0 ? matchedGroups : matchedParts;

	const semanticNodeIds = Array.from(
		new Set(collectEntityMatchedNodeIds(structure, matchedEntities))
	).sort((left, right) => left.localeCompare(right));

	// For explode, fall back to name-based node matching when semantic yields nothing.
	// This covers two cases: no semantic entities at all, and semantic entities whose
	// materialIds were sanitized to empty by the group validator.
	const matchedNodeIds =
		semanticNodeIds.length === 0 && mode === 'explode'
			? collectNodeIdsByNameQuery(structure, normalizedQuery)
			: semanticNodeIds;

	if (matchedEntities.length === 0 && matchedNodeIds.length === 0) {
		return {
			assetId,
			mode,
			partQuery: normalizedQuery,
			matchedPartIds: [],
			matchedPartLabels: [],
			matchedNodeIds: [],
			matchedMaterialIds: [],
			matchedPaths: [],
			matchedMaterialNames: [],
			operations: [],
			summary: `No semantic part units matched "${normalizedQuery}".`
		};
	}
	const matchedMaterialIds = Array.from(
		new Set(matchedEntities.flatMap((entity) => entity.materialIds))
	).sort((left, right) => left.localeCompare(right));
	const matchedMaterialNames = capabilities.materials
		.filter((material) => matchedMaterialIds.includes(material.id))
		.map((material) => material.name)
		.sort((left, right) => left.localeCompare(right));
	const matchedPartLabels = matchedEntities
		.map((entity) => entity.humanLabel)
		.sort((left, right) => left.localeCompare(right));
	let operations: SharedVehicleInspectionPatchOperation[] = [];

	if (mode === 'highlight') {
		operations = capabilities.materials
			.filter((material) => matchedMaterialIds.includes(material.id))
			.map((material) => ({
				targetType: 'material' as const,
				targetId: material.id,
				targetName: material.name,
				op: 'set_overlay_highlight' as const,
				value: [0.58, 0.54, 0.86, 1] as [number, number, number, number]
			}));
	}

	if (mode === 'isolate') {
		const contextMaterialOperations = capabilities.materials
			.filter((material) => !matchedMaterialIds.includes(material.id))
			.map((material) => ({
				targetType: 'material' as const,
				targetId: material.id,
				targetName: material.name,
				op: 'set_alpha' as const,
				value: ISOLATE_CONTEXT_ALPHA
			}));
		const highlightMaterialOperations = capabilities.materials
			.filter((material) => matchedMaterialIds.includes(material.id))
			.map((material) => ({
				targetType: 'material' as const,
				targetId: material.id,
				targetName: material.name,
				op: 'set_overlay_highlight' as const,
				value: ISOLATE_HIGHLIGHT_FACTOR
			}));
		operations = [...contextMaterialOperations, ...highlightMaterialOperations];
	}

	if (mode === 'explode') {
		const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
		const explodeOffsets = new Map<string, [number, number, number]>(
			matchedNodeIds.map((nodeId) => [nodeId, computeExplodeOffsetForNode(structure, nodeId)])
		);
		const groundLift = computeGroundClearanceLift(structure, explodeOffsets);
		operations = matchedNodeIds
			.map((nodeId) => nodeById.get(nodeId))
			.filter((node): node is NonNullable<typeof node> => node !== undefined)
			.map((node) => {
				const explodeOffset = explodeOffsets.get(node.id) ?? [0, 0, 0];
				return {
					targetType: 'node' as const,
					targetId: node.id,
					targetName: node.name,
					op: 'set_translation' as const,
					value: [
						node.translation[0] + explodeOffset[0],
						node.translation[1] + explodeOffset[1],
						node.translation[2] + explodeOffset[2]
					] as [number, number, number]
				};
			});

		if (groundLift > 0) {
			operations.push({
				targetType: 'viewer',
				targetId: 'scene_y_offset',
				op: 'set_target',
				value: groundLift
			});
		}
	}

	return {
		assetId,
		mode,
		partQuery: normalizedQuery,
		matchedPartIds: matchedEntities
			.map((entity) => entity.id)
			.sort((left, right) => left.localeCompare(right)),
		matchedPartLabels,
		matchedNodeIds,
		matchedMaterialIds,
		matchedPaths: collectEntityMatchedPaths(capabilities, matchedEntities),
		matchedMaterialNames,
		operations,
		summary:
			mode === 'highlight'
				? `Matched ${matchedEntities.length} semantic grouping(s) for highlight.`
				: mode === 'isolate'
					? `Isolated ${matchedEntities.length} semantic grouping(s).`
					: mode === 'explode'
						? `Exploded ${matchedEntities.length} semantic grouping(s).`
					: `Matched ${matchedEntities.length} semantic grouping(s) for ${mode}.`
	};
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

	if (requestText.includes('xray') || requestText.includes('x-ray')) {
		operations.push({
			targetType: 'viewer',
			targetId: 'xray',
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
		for (const material of await inferHeadlightMaterials(capabilities)) {
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

	const plan = await planVehicleBodyPaint(assetId, resolvedPaint.color, resolvedPaint.finish ?? undefined);
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

	const plan = await planVehicleBodyPaint(assetId, resolvedPaint.color, resolvedPaint.finish ?? undefined);
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
	const semanticPartMode = inferPartIntentMode(trimmedRequest);

	if (shouldHighlightPart(trimmedRequest)) {
		matchedIntent = true;
		const query = extractHighlightQuery(trimmedRequest);
		if (semanticPartMode === 'highlight') {
			const highlightPlan = await planVehicleHighlightIntent(assetId, query || trimmedRequest);

			plannedOperations = mergePatchOperations(plannedOperations, highlightPlan.operations);
			rejected.push(...highlightPlan.rejected);
			summaryParts.push(highlightPlan.summary);
		} else {
			const partPlan = await planVehiclePartIntent(assetId, query || trimmedRequest, semanticPartMode);
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
