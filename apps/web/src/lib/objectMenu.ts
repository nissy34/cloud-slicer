// The object menu's requests to the engine (engine/src/object_api.cpp).
export type UnitConversion = 'fromInch' | 'toInch' | 'fromMeter' | 'toMeter';
export type ObjectAction =
  | { op: 'rename'; name: string }
  | { op: 'printable'; value: boolean }
  | { op: 'center' }
  | { op: 'scaleToFit'; height: number }
  | { op: 'clone'; count: number }
  | { op: 'convert'; to: UnitConversion }
  | { op: 'replace'; volume: number };

/**
 * The unit conversions desktop offers for an object: converting from inches
 * and meters, or back once it was converted.
 */
export function unitConversions(units: '' | 'inch' | 'meter'): { to: UnitConversion; label: string }[] {
  if (units === 'inch') return [{ to: 'toInch', label: 'Convert back to inches' }];
  if (units === 'meter') return [{ to: 'toMeter', label: 'Convert back to meters' }];
  return [
    { to: 'fromInch', label: 'Convert from inches' },
    { to: 'fromMeter', label: 'Convert from meters' },
  ];
}

/** A file name for an object's STL: its name without a model extension. */
export function stlName(objectName: string): string {
  const base = objectName.replace(/\.(stl|3mf|obj|step|stp|amf)$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return `${base || 'object'}.stl`;
}

/** Keeps a menu at (x, y) inside a w × h area. */
export function menuPosition(x: number, y: number, menuW: number, menuH: number, w: number, h: number): { left: number; top: number } {
  return { left: Math.max(4, Math.min(x, w - menuW - 4)), top: Math.max(4, Math.min(y, h - menuH - 4)) };
}
