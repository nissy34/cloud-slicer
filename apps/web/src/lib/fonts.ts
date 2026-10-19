// Fonts for the Text tool. Desktop lists the computer's installed fonts; the
// page offers a few bundled ones (Google's Noto, copied into engine/fonts by
// scripts/copy-engine.mjs), the computer's own where the browser allows it
// (Chrome and Edge, after asking), and any font file the user picks.

export interface FontChoice {
  /** Shown in the list and kept with the text in the project. */
  name: string;
  source: 'bundled' | 'computer' | 'file';
  /** Bundled: the file under engine/fonts. */
  file?: string;
}

/** The bundled fonts, small Latin TrueType files (Google's Noto, Open Font License). */
export const BUNDLED_FONTS: FontChoice[] = [
  { name: 'Noto Sans', source: 'bundled', file: 'NotoSans-Regular.ttf' },
  { name: 'Noto Sans Bold', source: 'bundled', file: 'NotoSans-Bold.ttf' },
  { name: 'Noto Sans Italic', source: 'bundled', file: 'NotoSans-Italic.ttf' },
  { name: 'Noto Sans Bold Italic', source: 'bundled', file: 'NotoSans-BoldItalic.ttf' },
  { name: 'Noto Serif', source: 'bundled', file: 'NotoSerif-Regular.ttf' },
  { name: 'Noto Serif Bold', source: 'bundled', file: 'NotoSerif-Bold.ttf' },
  { name: 'Noto Sans Mono', source: 'bundled', file: 'NotoSansMono-Regular.ttf' },
];
export const DEFAULT_FONT = BUNDLED_FONTS[0];

/** The text tool's settings, as the engine takes and reports them (engine/src/text_api.cpp). */
export interface TextStyle {
  text: string;
  font: string;
  /** Letter height, mm. */
  size: number;
  /** How far it stands out (or cuts in), mm. */
  depth: number;
  /** Thicker (+) or thinner (-) letters, mm. */
  boldness: number;
  /** Slant, as x per y. */
  skew: number;
  /** Extra space between letters and lines, in font units. */
  charGap: number;
  lineGap: number;
  align: 'left' | 'center' | 'right';
}

/** Desktop's starting text and style: "Embossed text", 10 mm high, 1 mm deep. */
export const DEFAULT_TEXT: TextStyle = {
  text: 'Embossed text',
  font: DEFAULT_FONT.name,
  size: 10,
  depth: 1,
  boldness: 0,
  skew: 0,
  charGap: 0,
  lineGap: 0,
  align: 'center',
};

/** Desktop's limits for the size and depth fields. */
export const TEXT_LIMITS = { size: [0.1, 1000], depth: [0.01, 1000] } as const;

export function clampStyle(style: TextStyle): TextStyle {
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  return { ...style, size: clamp(style.size, TEXT_LIMITS.size), depth: clamp(style.depth, TEXT_LIMITS.depth) };
}

/** A computer font's name from the Local Font Access API: its full name, like desktop's list. */
export function computerFontName(f: { fullName: string; family: string; style: string }): string {
  return f.fullName || (f.style && f.style !== 'Regular' ? `${f.family} ${f.style}` : f.family);
}

/** The engine's file for a font name: letters, digits, dashes and dots only. */
export function fontFileName(name: string): string {
  return `/fonts/${name.replace(/[^A-Za-z0-9.-]+/g, '_')}.ttf`;
}
