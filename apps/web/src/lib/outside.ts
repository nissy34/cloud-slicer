// Models and toolpaths outside the plate, checked the way desktop Orca checks
// them: objects in Prepare against the build volume (GLVolumeCollection::
// check_outside_state, ObjectClashed) and the sliced toolpaths against it
// (GCodeViewer's BuildVolume::all_paths_inside, ToolpathOutside and
// ToolHeightOutside).
import type { PreviewMesh, SliceWarning } from '../engine/protocol';
import { bedSize } from './colour';
import { FEATURES } from './gcode';

/** The build volume in plate coordinates (mm); maxZ is Infinity when the printer has no height. */
export interface PlateBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function plateBounds(printableArea: string | undefined, printableHeight: string | undefined): PlateBounds {
  const { x0, y0, w, d } = bedSize(printableArea);
  const h = parseFloat(printableHeight ?? '');
  return { minX: x0, minY: y0, maxX: x0 + w, maxY: y0 + d, maxZ: h > 0 ? h : Infinity };
}

// Desktop's BuildVolume::SceneEpsilon (EPSILON) and BedEpsilon (3 * EPSILON).
const SCENE_EPSILON = 1e-4;
const BED_EPSILON = 3e-4;

/** Desktop's text when an object is partly outside the plate (EWarning::ObjectClashed). */
export const OBJECT_CLASHED =
  'An object is laid over the plate boundaries or exceeds the height limit. Please solve the problem by moving it totally on or off the plate, and confirming that the height is within the build volume.';

/**
 * Objects with a part that is partly outside the plate or taller than the
 * printer, from the Prepare preview (which holds the objects whose centre is
 * on the shown plate). Like desktop, each part's bounding box is tested, and
 * what sinks below the bed doesn't count.
 */
export function objectsOutside(preview: Pick<PreviewMesh, 'positions' | 'partList'>, b: PlateBounds): number[] {
  const out = new Set<number>();
  const list = preview.partList ?? new Int32Array();
  const p = preview.positions;
  for (let k = 0; k + 3 < list.length; k += 4) {
    const [object, , first, count] = [list[k], list[k + 1], list[k + 2], list[k + 3]];
    if (out.has(object)) continue;
    for (let i = first * 9, end = (first + count) * 9; i < end; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (
        x < b.minX - SCENE_EPSILON || x > b.maxX + SCENE_EPSILON ||
        y < b.minY - SCENE_EPSILON || y > b.maxY + SCENE_EPSILON ||
        z > b.maxZ + SCENE_EPSILON
      ) {
        out.add(object);
        break;
      }
    }
  }
  return [...out].sort((a, c) => a - c);
}

const NOT_CHECKED = new Set([FEATURES.indexOf('Custom'), FEATURES.indexOf('Other')]);

/**
 * Desktop's errors for sliced toolpaths that leave the build volume: above
 * the printer's height, or (when not) off the plate. Custom G-code (start and
 * end G-code, purge lines) isn't checked, as on desktop.
 */
export function toolpathWarnings(parsed: { positions: Float32Array; features: Uint8Array; layerZ: Float32Array }, b: PlateBounds): SliceWarning[] {
  const top = parsed.layerZ.length ? Math.max(...parsed.layerZ) : 0;
  if (top - b.maxZ >= 1e-6) return [{ text: 'A G-code path goes beyond the max print height.', level: 'serious' }];
  const p = parsed.positions;
  for (let s = 0; s < parsed.features.length; s++) {
    if (NOT_CHECKED.has(parsed.features[s])) continue;
    for (let i = s * 6; i < s * 6 + 6; i += 3)
      if (p[i] < b.minX - BED_EPSILON || p[i] > b.maxX + BED_EPSILON || p[i + 1] < b.minY - BED_EPSILON || p[i + 1] > b.maxY + BED_EPSILON)
        return [{ text: 'A G-code path goes beyond the plate boundaries.', level: 'serious' }];
  }
  return [];
}

/** True for a warning that stops the G-code from being printed (desktop greys out Print and Export). */
export const blocksPrinting = (w: SliceWarning) => /^A G-code path goes beyond/.test(w.text);
