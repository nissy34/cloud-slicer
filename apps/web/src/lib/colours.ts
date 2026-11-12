import { i18n } from '../i18n';
/**
 * The colours the colour popup offers (components/ColourPicker.tsx).
 *
 * BUILT_IN_COLOURS is desktop Orca's own list: the 24 "Other Color" squares of its filament
 * colour popup (`ColorPickerPopup::m_def_colors` in src/slic3r/GUI/AMSMaterialsSetting.cpp),
 * in the same order. The names are ours (word keys in the i18n colourPicker files), for the
 * tooltip and screen readers.
 */
export const BUILT_IN_COLOURS: { hex: string; name: string }[] = [
  { hex: '#FFFFFF', name: 'colourPicker.white' },
  { hex: '#FFF144', name: 'colourPicker.yellow' },
  { hex: '#DCF478', name: 'colourPicker.lime' },
  { hex: '#0ACC38', name: 'colourPicker.green' },
  { hex: '#057748', name: 'colourPicker.darkGreen' },
  { hex: '#0D6284', name: 'colourPicker.teal' },
  { hex: '#0EE2A0', name: 'colourPicker.mint' },
  { hex: '#76D9F4', name: 'colourPicker.skyBlue' },
  { hex: '#46A8F9', name: 'colourPicker.lightBlue' },
  { hex: '#2850E0', name: 'colourPicker.blue' },
  { hex: '#443089', name: 'colourPicker.indigo' },
  { hex: '#A03CF7', name: 'colourPicker.purple' },
  { hex: '#F330F9', name: 'colourPicker.magenta' },
  { hex: '#D4B1DD', name: 'colourPicker.lavender' },
  { hex: '#F95D73', name: 'colourPicker.pink' },
  { hex: '#F72323', name: 'colourPicker.red' },
  { hex: '#7C4B00', name: 'colourPicker.brown' },
  { hex: '#F98C36', name: 'colourPicker.orange' },
  { hex: '#FCECD6', name: 'colourPicker.cream' },
  { hex: '#D3C5A3', name: 'colourPicker.beige' },
  { hex: '#AF7933', name: 'colourPicker.tan' },
  { hex: '#898989', name: 'colourPicker.grey' },
  { hex: '#BCBCBC', name: 'colourPicker.lightGrey' },
  { hex: '#161616', name: 'colourPicker.black' },
];

/** "#RGB", "#RRGGBBAA", "rrggbb" -> "#RRGGBB"; anything else -> the fallback. */
export function toHex6(colour: string | undefined, fallback = '#FFFFFF'): string {
  const c = (colour ?? '').trim().replace(/^#?/, '#');
  if (/^#[0-9a-f]{6}/i.test(c)) return c.slice(0, 7).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toUpperCase();
  return fallback;
}

/** A typed hex code, or null when it isn't one ("40a040", "#4a4", "#40A040"). */
export function parseHex(text: string): string | null {
  const c = text.trim().replace(/^#?/, '#');
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? toHex6(c) : null;
}

/** The name of a built-in colour, or its hex code. */
export function colourName(hex: string): string {
  const h = toHex6(hex);
  const c = BUILT_IN_COLOURS.find((b) => b.hex === h);
  return c ? i18n.t(c.name as 'colourPicker.red') : h;
}

const RECENT_KEY = 'cloud-slicer:recent-colours:v1';
export const MAX_RECENT = 8;

/** Your own colours picked lately (not the built-in ones), newest first. Kept in this browser only. */
export function recentColours(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string' && parseHex(c) !== null).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** The recent list after picking `hex`: built-in colours don't go in it. */
export function withRecent(list: string[], hex: string): string[] {
  const h = toHex6(hex);
  if (BUILT_IN_COLOURS.some((c) => c.hex === h)) return list;
  return [h, ...list.filter((c) => c !== h)].slice(0, MAX_RECENT);
}

export function rememberColour(hex: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(withRecent(recentColours(), hex)));
  } catch {
    // Private window or blocked storage: the popup works without a recent row.
  }
}
