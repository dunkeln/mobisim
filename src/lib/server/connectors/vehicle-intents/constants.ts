export const HEADLIGHT_ON_EMISSIVE: [number, number, number] = [1, 0.95, 0.82];
export const TAILLIGHT_ON_EMISSIVE: [number, number, number] = [1, 0.14, 0.1];
export const ISOLATE_CONTEXT_ALPHA = 0.18;
export const REMOVE_PART_ALPHA = 0.08;

export const NAMED_PAINT_COLORS: Record<string, [number, number, number]> = {
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

export const PAINT_COLOR_ALIASES: Record<string, [number, number, number]> = {
	'black panther purple': [0.29, 0.18, 0.46],
	'midnight purple': [0.19, 0.12, 0.31],
	'dark purple': [0.22, 0.12, 0.34],
	'deep purple': [0.28, 0.14, 0.42],
	'royal purple': [0.45, 0.28, 0.7],
	'metallic black': [0.09, 0.09, 0.12],
	'matte black': [0.06, 0.06, 0.07],
	'gunmetal gray': [0.3, 0.32, 0.36],
	'gunmetal grey': [0.3, 0.32, 0.36],
	'pearl white': [0.95, 0.95, 0.98],
	'off white': [0.92, 0.9, 0.84],
	ivory: [0.94, 0.92, 0.82],
	cream: [0.93, 0.89, 0.78],
	eggshell: [0.91, 0.89, 0.82],
	champagne: [0.84, 0.78, 0.68],
	beige: [0.8, 0.74, 0.64],
	bone: [0.88, 0.86, 0.78],
	sand: [0.78, 0.72, 0.58]
};

export const WINDOW_TINT_PRESETS: Array<{
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

export type LightingSemanticCategory = 'front_lighting' | 'rear_lighting';

export const LIGHTING_SCOPE_CONFIG = {
	front_lighting: {
		enableValue: HEADLIGHT_ON_EMISSIVE,
		includePattern: /\b(headlights?|front lights?|front lighting)\b/i,
		excludePattern:
			/\b(?:except|excluding|without|but not|not)\s+(?:the\s+)?(?:headlights?|front lights?|front lighting)\b/i
	},
	rear_lighting: {
		enableValue: TAILLIGHT_ON_EMISSIVE,
		includePattern: /\b(taillights?|rear lights?|rear lighting|brake lights?)\b/i,
		excludePattern:
			/\b(?:except|excluding|without|but not|not)\s+(?:the\s+)?(?:taillights?|rear lights?|rear lighting|brake lights?)\b/i
	}
} satisfies Record<
	'front_lighting' | 'rear_lighting',
	{
		enableValue: [number, number, number];
		includePattern: RegExp;
		excludePattern: RegExp;
	}
>;
