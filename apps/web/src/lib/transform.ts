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
export type EditKey = 'delete' | 'copy' | 'cut' | 'paste' | 'clone' | 'addCopy' | 'removeCopy';

export function editKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): EditKey | null {
  if (e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl) return key === 'c' ? 'copy' : key === 'x' ? 'cut' : key === 'v' ? 'paste' : key === 'k' ? 'clone' : null;
  // Backspace is the Mac keyboard's Delete.
  if (key === 'delete' || key === 'backspace') return 'delete';
  // + is Shift+= on most keyboards; the keypad sends + and - as they are.
  if (key === '+' || key === '=') return 'addCopy';
  if (key === '-' || key === '_') return 'removeCopy';
  return null;
}

/**
 * Desktop's arrow keys and Page Up / Page Down on the chosen objects: arrows
 * move them 10 mm on the plate (up is away from the front), Page Up turns them
 * 45° counter-clockwise about their middle, Page Down clockwise.
 */
export function nudgeKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): { move: [number, number] } | { turn: number } | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  switch (e.key) {
    case 'ArrowUp':
      return { move: [0, 10] };
    case 'ArrowDown':
      return { move: [0, -10] };
    case 'ArrowLeft':
      return { move: [-10, 0] };
    case 'ArrowRight':
      return { move: [10, 0] };
    case 'PageUp':
      return { turn: 45 };
    case 'PageDown':
      return { turn: -45 };
  }
  return null;
}
