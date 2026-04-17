import { NAMED_PAINT_COLORS, PAINT_COLOR_ALIASES, WINDOW_TINT_PRESETS } from './constants';
import type { NormalizedVehiclePaintIntent } from './types';

type VehiclePaintFinish = {
	metalness?: number;
	roughness?: number;
	envMapIntensity?: number;
	label?: string;
};

export function formatSemanticTargetName(materialName: string, semanticLabels: string[]): string {
	const uniqueLabels = Array.from(new Set(semanticLabels.map((label) => label.trim()).filter(Boolean)));
	if (uniqueLabels.length === 0) {
		return materialName;
	}

	return `${materialName} (${uniqueLabels.join(', ')})`;
}

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

function desaturateColor(color: [number, number, number], ratio: number): [number, number, number] {
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

	if (/\bsolid\b/.test(normalized)) {
		return {
			label: 'solid',
			metalness: 0.12,
			roughness: 0.3,
			envMapIntensity: 1
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

	if (/\b(off[-\s]?white|warm white|dirty white)\b/i.test(trimmed)) {
		return [0.92, 0.9, 0.84, 1];
	}

	if (/\b(ivory|cream|eggshell|bone)\b/i.test(trimmed)) {
		const base =
			/\bivory\b/i.test(trimmed)
				? PAINT_COLOR_ALIASES.ivory
				: /\bcream\b/i.test(trimmed)
					? PAINT_COLOR_ALIASES.cream
					: /\beggshell\b/i.test(trimmed)
						? PAINT_COLOR_ALIASES.eggshell
						: PAINT_COLOR_ALIASES.bone;
		return [base[0], base[1], base[2], 1];
	}

	if (/\b(champagne|beige|sand)\b/i.test(trimmed)) {
		const base =
			/\bchampagne\b/i.test(trimmed)
				? PAINT_COLOR_ALIASES.champagne
				: /\bbeige\b/i.test(trimmed)
					? PAINT_COLOR_ALIASES.beige
					: PAINT_COLOR_ALIASES.sand;
		return [base[0], base[1], base[2], 1];
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
