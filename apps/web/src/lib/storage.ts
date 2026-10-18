// Per-browser memory of the last preset selection and edits. Optional: it can
// be unavailable (private windows, blocked storage), and the app starts from
// the default printer then.
import type { OrcaConfig, Selection } from '../engine/protocol';

const KEY = 'cloud-slicer:session:v1';

export interface Saved {
  selection: Selection | null;
  overrides: OrcaConfig;
  /** The project's mixed filaments (mixed_filament_definitions). */
  mixes?: string;
}

export function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function save(state: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: nothing to remember
  }
}

const CONVERT_KEY = 'cloud-slicer:convert:v1';

/** What to do with a 3MF made for a printer we don't have. */
export interface ConvertPreference {
  printer: string;
  keepSettings: boolean;
  /** Convert without asking next time. */
  auto: boolean;
}

export function loadConvertPreference(): ConvertPreference | null {
  try {
    const raw = localStorage.getItem(CONVERT_KEY);
    return raw ? (JSON.parse(raw) as ConvertPreference) : null;
  } catch {
    return null;
  }
}

export function saveConvertPreference(pref: ConvertPreference | null) {
  try {
    if (pref) localStorage.setItem(CONVERT_KEY, JSON.stringify(pref));
    else localStorage.removeItem(CONVERT_KEY);
  } catch {
    // storage unavailable: ask every time
  }
}
