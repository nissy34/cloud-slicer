import { i18n } from '../i18n';

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
  if (units === 'inch') return [{ to: 'toInch', label: i18n.t('objectMenu.backToInches') }];
  if (units === 'meter') return [{ to: 'toMeter', label: i18n.t('objectMenu.backToMeters') }];
  return [
    { to: 'fromInch', label: i18n.t('objectMenu.fromInches') },
    { to: 'fromMeter', label: i18n.t('objectMenu.fromMeters') },
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

/** Most copies or instances one Clone or "Set number of instances" makes. */
export const MAX_COPIES = 1000;

/**
 * The number typed in a copies box, kept between 1 and MAX_COPIES. The box
 * keeps what is typed (even nothing, on the way to another number); this is
 * what counts when it is used.
 */
export function copiesFrom(text: string): number {
  const n = Math.round(Number(text));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_COPIES, n) : 1;
}
