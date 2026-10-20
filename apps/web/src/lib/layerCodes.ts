// Desktop's layer slider items (IMSlider / TickCodeInfo): a pause, a filament
// change or custom G-code at the start of a layer, one per layer, kept per
// plate in the project (engine/src/plate_api.cpp).
import type { LayerCode } from '../engine/protocol';

/** The layer (index into the G-code's layer heights) a code runs at: the one whose top is nearest its height. */
export function layerOf(z: number, layerZ: ArrayLike<number>): number {
  let lo = 0;
  let hi = layerZ.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layerZ[mid] < z) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && z - layerZ[lo - 1] < layerZ[lo] - z ? lo - 1 : lo;
}

/** The code at layer `layer`, if there is one. */
export function codeAt(codes: LayerCode[], layerZ: ArrayLike<number>, layer: number): LayerCode | undefined {
  return codes.find((c) => layerOf(c.z, layerZ) === layer);
}

/** The codes with `code` at layer `layer` instead of whatever was there (null removes it), in height order. */
export function withCodeAt(codes: LayerCode[], layerZ: ArrayLike<number>, layer: number, code: LayerCode | null): LayerCode[] {
  const rest = codes.filter((c) => layerOf(c.z, layerZ) !== layer);
  return (code ? [...rest, { ...code, z: layerZ[layer] }] : rest).sort((a, b) => a.z - b.z);
}

/** A new code of `type` for layer height z, as desktop's add_tick makes it (a filament change carries its colour). */
export function newCode(type: LayerCode['type'], z: number, extra: { filament?: number; colour?: string; gcode?: string } = {}): LayerCode {
  return { z, type, filament: extra.filament ?? 1, colour: type === 'filament' ? (extra.colour ?? '') : '', gcode: type === 'custom' ? (extra.gcode ?? '') : '' };
}

/** What the code does, in a few words (desktop's tick tooltips). */
export function codeLabel(code: LayerCode): string {
  switch (code.type) {
    case 'pause':
      return 'Pause';
    case 'filament':
      return `Change to filament ${code.filament}`;
    case 'template':
      return 'Custom template';
    case 'colour':
      return 'Colour change (M600)';
    default:
      return code.gcode.trim() ? `Custom G-code: ${firstLine(code.gcode)}` : 'Custom G-code';
  }
}

const firstLine = (gcode: string) => {
  const lines = gcode.trim().split('\n');
  const first = lines[0].length > 28 ? `${lines[0].slice(0, 27)}…` : lines[0];
  return lines.length > 1 ? `${first} …` : first;
};

/**
 * Whether desktop offers Change filament: the project has more than one
 * filament and everything on the plate prints with the same one
 * (Preview::update_layers_slider_mode).
 */
export function canChangeFilament(filamentCount: number, plateFilaments: number[]): boolean {
  return filamentCount > 1 && new Set(plateFilaments).size <= 1;
}
