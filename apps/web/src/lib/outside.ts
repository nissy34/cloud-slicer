// Models and toolpaths outside the plate, checked the way desktop Orca checks
// them: objects in Prepare against the build volume (GLVolumeCollection::
// check_outside_state, ObjectClashed) and the sliced toolpaths against it
// (GCodeViewer's BuildVolume::all_paths_inside, ToolpathOutside and
// ToolHeightOutside).
import type { PreviewMesh, ProjectInfo, SliceWarning } from '../engine/protocol';
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
 * printer, from the Prepare preview (which holds the objects shown on the
 * plate, including those off every plate). Like desktop
 * (GLVolumeCollection::check_outside_state), each part's bounding box is
 * tested: partly outside is a clash, totally off the plate is not (it isn't
 * printed). What sinks below the bed doesn't count.
 */
export function objectsOutside(preview: Pick<PreviewMesh, 'positions' | 'partList'>, b: PlateBounds): number[] {
  const out = new Set<number>();
  const list = preview.partList ?? new Int32Array();
  const p = preview.positions;
  for (let k = 0; k + 3 < list.length; k += 4) {
    const [object, , first, count] = [list[k], list[k + 1], list[k + 2], list[k + 3]];
    if (out.has(object) || count === 0) continue;
    let [x0, y0, x1, y1, z1] = [Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = first * 9, end = (first + count) * 9; i < end; i += 3) {
      x0 = Math.min(x0, p[i]);
      x1 = Math.max(x1, p[i]);
      y0 = Math.min(y0, p[i + 1]);
      y1 = Math.max(y1, p[i + 1]);
      z1 = Math.max(z1, p[i + 2]);
    }
    const overlaps = x1 > b.minX && x0 < b.maxX && y1 > b.minY && y0 < b.maxY;
    const inside =
      x0 >= b.minX - SCENE_EPSILON && x1 <= b.maxX + SCENE_EPSILON && y0 >= b.minY - SCENE_EPSILON && y1 <= b.maxY + SCENE_EPSILON && z1 <= b.maxZ + SCENE_EPSILON;
    if (overlaps && !inside) out.add(object);
  }
  return [...out].sort((a, c) => a - c);
}

/** The objects printed with `plate`: those with a copy on it that isn't off every plate. */
export function printedObjects(project: Pick<ProjectInfo, 'plates' | 'objects'> | null | undefined, plate: number): number[] {
  return (project?.plates[plate]?.objects ?? []).filter((o) => project?.objects[o]?.instances.some((i) => i.plate === plate && !i.loose));
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
