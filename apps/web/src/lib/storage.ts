// Per-browser memory of the last preset selection and edits. Optional: it can
// be unavailable (private windows, blocked storage), and the app starts from
// the default printer then.
import type { OrcaConfig, Selection } from '../engine/protocol';

const KEY = 'cloud-slicer:session:v1';

export interface Saved {
  selection: Selection | null;
  overrides: OrcaConfig;
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
