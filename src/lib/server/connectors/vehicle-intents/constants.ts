export const HEADLIGHT_ON_EMISSIVE: [number, number, number] = [1, 0.95, 0.82];
export const TAILLIGHT_ON_EMISSIVE: [number, number, number] = [1, 0.14, 0.1];
export const ISOLATE_CONTEXT_ALPHA = 0.18;
export const REMOVE_PART_ALPHA = 0.08;

export const NAMED_PAINT_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [0.92, 0.92, 0.94],
  silver: [0.72, 0.74, 0.78],
  charcoal: [0.16, 0.17, 0.2],
  graphite: [0.24, 0.26, 0.3],
  pink: [0.96, 0.34, 0.68],
  magenta: [0.88, 0.22, 0.62],
  gray: [0.45, 0.47, 0.5],
  grey: [0.45, 0.47, 0.5],
  gold: [0.82, 0.68, 0.2],
  red: [0.83, 0.1, 0.16],
  maroon: [0.42, 0.08, 0.12],
  crimson: [0.72, 0.08, 0.16],
  blue: [0.12, 0.24, 0.8],
  navy: [0.08, 0.14, 0.34],
  cyan: [0.14, 0.72, 0.84],
  green: [0.12, 0.56, 0.26],
  olive: [0.38, 0.42, 0.16],
  teal: [0.16, 0.7, 0.72],
  indigo: [0.28, 0.22, 0.72],
  burgundy: [0.46, 0.08, 0.18],
  bronze: [0.7, 0.4, 0.18],
  copper: [0.74, 0.42, 0.2],
  lime: [0.56, 0.84, 0.12],
  yellow: [0.9, 0.72, 0.12],
  orange: [0.9, 0.42, 0.12],
  purple: [0.56, 0.42, 0.82],
  violet: [0.64, 0.38, 0.88]
};

export const PAINT_COLOR_ALIASES: Record<string, [number, number, number]> = {
  'jet black': [0.02, 0.02, 0.03],
  'obsidian black': [0.04, 0.04, 0.06],
  'satin black': [0.08, 0.08, 0.1],
  'black panther purple': [0.29, 0.18, 0.46],
  'midnight purple': [0.19, 0.12, 0.31],
  'dark purple': [0.22, 0.12, 0.34],
  'deep purple': [0.28, 0.14, 0.42],
  'royal purple': [0.45, 0.28, 0.7],
  'plum purple': [0.42, 0.22, 0.5],
  'metallic black': [0.09, 0.09, 0.12],
  'matte black': [0.06, 0.06, 0.07],
  'hot pink': [0.98, 0.28, 0.64],
  fuchsia: [0.94, 0.18, 0.7],
  rose: [0.9, 0.42, 0.62],
  'rose gold': [0.82, 0.58, 0.54],
  'champagne gold': [0.86, 0.74, 0.48],
  'metallic silver': [0.72, 0.74, 0.78],
  'bright silver': [0.78, 0.8, 0.84],
  'gunmetal gray': [0.3, 0.32, 0.36],
  'gunmetal grey': [0.3, 0.32, 0.36],
  'nardo gray': [0.68, 0.68, 0.7],
  'slate gray': [0.42, 0.45, 0.52],
  'slate grey': [0.42, 0.45, 0.52],
  'pearl white': [0.95, 0.95, 0.98],
  'off white': [0.92, 0.9, 0.84],
  ivory: [0.94, 0.92, 0.82],
  cream: [0.93, 0.89, 0.78],
  eggshell: [0.91, 0.89, 0.82],
  champagne: [0.84, 0.78, 0.68],
  beige: [0.8, 0.74, 0.64],
  bone: [0.88, 0.86, 0.78],
  sand: [0.78, 0.72, 0.58],
  'british racing green': [0.05, 0.2, 0.12],
  'forest green': [0.12, 0.34, 0.18],
  'emerald green': [0.06, 0.56, 0.34],
  'mint green': [0.58, 0.82, 0.68],
  'sky blue': [0.42, 0.68, 0.94],
  'baby blue': [0.58, 0.76, 0.94],
  'ice blue': [0.72, 0.84, 0.94],
  'powder blue': [0.56, 0.7, 0.86],
  'electric blue': [0.12, 0.42, 0.96],
  'royal blue': [0.18, 0.28, 0.82],
  'deep blue': [0.08, 0.18, 0.48],
  'midnight blue': [0.06, 0.1, 0.26],
  'tiffany blue': [0.34, 0.82, 0.78],
  turquoise: [0.24, 0.76, 0.72],
  aqua: [0.22, 0.8, 0.84],
  'sunset orange': [0.92, 0.38, 0.16],
  'burnt orange': [0.72, 0.32, 0.12],
  coral: [0.92, 0.46, 0.34],
  'canary yellow': [0.94, 0.8, 0.18],
  'signal yellow': [0.96, 0.74, 0.12],
  'racing yellow': [0.9, 0.76, 0.08],
  'wine red': [0.5, 0.08, 0.16],
  'ruby red': [0.78, 0.08, 0.18],
  'candy apple red': [0.86, 0.06, 0.12],
  'lava red': [0.74, 0.12, 0.1],
  'hot rod red': [0.84, 0.08, 0.1],
  'iron man red': [0.78, 0.08, 0.12],
  'arc reactor blue': [0.34, 0.84, 0.98],
  'mark iii gold': [0.84, 0.62, 0.16],
  'brushed titanium': [0.62, 0.64, 0.68],
  'gunmetal titanium': [0.34, 0.36, 0.4]
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
    includePattern: /\b(headlights?|front lights?|front lighting|frontlights?)\b/i,
    excludePattern:
      /\b(?:except|excluding|without|but not|not)\s+(?:the\s+)?(?:headlights?|front lights?|front lighting|frontlights?)\b/i
  },
  rear_lighting: {
    enableValue: TAILLIGHT_ON_EMISSIVE,
    includePattern: /\b(taillights?|rear lights?|rear lighting|rearlights?|brake lights?)\b/i,
    excludePattern:
      /\b(?:except|excluding|without|but not|not)\s+(?:the\s+)?(?:taillights?|rear lights?|rear lighting|rearlights?|brake lights?)\b/i
  }
} satisfies Record<
  'front_lighting' | 'rear_lighting',
  {
    enableValue: [number, number, number];
    includePattern: RegExp;
    excludePattern: RegExp;
  }
>;
