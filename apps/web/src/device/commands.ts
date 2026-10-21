// G-code scripts for the generic Klipper controls. Values are clamped and
// object names checked, so nothing typed in the UI can inject a second command.

const SAFE_NAME = /^[A-Za-z0-9_]+$/;

/** The part after the object type: "heater_generic chamber" -> "chamber". */
export function ownName(object: string): string {
  const own = object.includes(' ') ? object.slice(object.indexOf(' ') + 1) : object;
  if (!SAFE_NAME.test(own)) throw new Error(`Unexpected object name: ${object}`);
  return own;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

export function setHeaterGcode(heater: string, target: number, max: number): string {
  return `SET_HEATER_TEMPERATURE HEATER=${ownName(heater)} TARGET=${Math.round(clamp(target, 0, max))}`;
}

export function homeGcode(axes: ('x' | 'y' | 'z')[] = []): string {
  return axes.length ? `G28 ${axes.map((a) => a.toUpperCase()).join(' ')}` : 'G28';
}

/** A relative move that leaves the printer's absolute/relative mode as it was. */
export function jogGcode(axis: 'x' | 'y' | 'z', distance: number, feedMmPerMin: number): string {
  const d = clamp(distance, -300, 300);
  const f = Math.round(clamp(feedMmPerMin, 60, 30000));
  return ['SAVE_GCODE_STATE NAME=_device_jog', 'G91', `G1 ${axis.toUpperCase()}${+d.toFixed(3)} F${f}`, 'RESTORE_GCODE_STATE NAME=_device_jog'].join('\n');
}

/** Extrude (positive) or retract (negative) on the active tool, which must be hot. */
export function extrudeGcode(mm: number, feedMmPerMin = 300): string {
  const d = clamp(mm, -100, 100);
  return ['SAVE_GCODE_STATE NAME=_device_extrude', 'M83', `G1 E${+d.toFixed(2)} F${Math.round(clamp(feedMmPerMin, 30, 1200))}`, 'RESTORE_GCODE_STATE NAME=_device_extrude'].join('\n');
}

export function fanGcode(fan: string, speed: number): string {
  const s = clamp(speed, 0, 1);
  if (fan === 'fan') return `M106 S${Math.round(s * 255)}`;
  return `SET_FAN_SPEED FAN=${ownName(fan)} SPEED=${+s.toFixed(2)}`;
}

export function lightGcode(led: string, on: boolean): string {
  const v = on ? 1 : 0;
  return `SET_LED LED=${ownName(led)} RED=${v} GREEN=${v} BLUE=${v} WHITE=${v}`;
}

export const speedFactorGcode = (pct: number) => `M220 S${Math.round(clamp(pct, 10, 300))}`;
export const flowFactorGcode = (pct: number) => `M221 S${Math.round(clamp(pct, 50, 200))}`;
export const motorsOffGcode = () => 'M84';

export function excludeObjectGcode(name: string): string {
  // Orca keeps letters of any script and some punctuation in names; whitespace
  // or ';' would end the parameter or start a comment.
  if (!/^[^\s;]+$/.test(name)) throw new Error(`Unexpected object name: ${name}`);
  return `EXCLUDE_OBJECT NAME=${name}`;
}

/** Moonraker upload name: keeps the stem readable and safe. */
export function uploadName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `${stem || 'print'}.gcode`;
}
