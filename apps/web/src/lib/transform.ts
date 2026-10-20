/**
 * New scale factors after one axis's factor became `factor` (typed as a
 * percent or a size in mm): with `uniform` (desktop's lock) the other two
 * change by as much, so the shape keeps its proportions.
 */
export function scaledBy(scale: number[], axis: number, factor: number, uniform: boolean): number[] {
  const ratio = factor / scale[axis];
  return uniform ? scale.map((v) => v * ratio) : scale.map((v, k) => (k === axis ? factor : v));
}

/** Desktop's editing keys on the Prepare plate (they work while no text box has the keys). */
export type EditKey = 'delete' | 'copy' | 'paste' | 'clone' | 'addCopy' | 'removeCopy';

export function editKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): EditKey | null {
  if (e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl) return key === 'c' ? 'copy' : key === 'v' ? 'paste' : key === 'k' ? 'clone' : null;
  // Backspace is the Mac keyboard's Delete.
  if (key === 'delete' || key === 'backspace') return 'delete';
  // + is Shift+= on most keyboards; the keypad sends + and - as they are.
  if (key === '+' || key === '=') return 'addCopy';
  if (key === '-' || key === '_') return 'removeCopy';
  return null;
}
