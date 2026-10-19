// The slicing progress bar's percentage, from the engine's stage reports.
//
// The engine maps Orca's own status (0-100) to 2..92, then reports 93 when it
// starts writing G-code. But Orca's G-code export reports every layer at a
// flat 80 ("Generating G-code: layer N") with no total, so the bar sat still
// (and even stepped back) for what is often the longest part of a slice. Here
// the slicing stages fill the bar to 70%, and the G-code step fills the rest
// layer by layer, against the plate's layer count estimated from its height.

/** Where the slicing stages end and writing G-code begins, in percent. */
export const GCODE_START = 70;

/** Layers the plate will have, roughly: its tallest object over the layer height (0 when unknown). */
export function estimateLayers(heights: number[], layerHeight: number, firstLayer: number): number {
  const top = Math.max(0, ...heights.filter((h) => Number.isFinite(h)));
  if (!(top > 0) || !(layerHeight > 0)) return 0;
  const first = firstLayer > 0 ? Math.min(firstLayer, top) : layerHeight;
  return 1 + Math.ceil(Math.max(0, top - first) / layerHeight - 1e-6);
}

/**
 * The percentage to show for an engine report (pct, stage), given the one shown
 * before. Never goes back, and stays below 100 until the slice is done.
 */
export function slicePercent(shown: number, pct: number, stage: string, layers: number): number {
  let target: number;
  const layer = /generating g-code: layer (\d+)/i.exec(stage);
  if (pct >= 100) target = 100;
  else if (layer) {
    // Orca counts layers from 0; without an estimate, creep towards the end.
    const done = Number(layer[1]) + 1;
    const fraction = layers > 0 ? Math.min(1, done / layers) : 1 - 1 / (1 + done / 50);
    target = GCODE_START + (99 - GCODE_START) * fraction;
  } else if (/generating g-code/i.test(stage) || pct >= 93) target = GCODE_START;
  else target = Math.min(GCODE_START, (Math.max(0, pct) * GCODE_START) / 92);
  return Math.max(shown, Math.min(target, pct >= 100 ? 100 : 99));
}
