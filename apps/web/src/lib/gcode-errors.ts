// The engine's error when custom G-code can't be filled in (GCode::
// check_placeholder_parser_failed), made readable: which G-code, which line,
// and the variable at fault, instead of the parser's caret drawing.
//
//   Failed to generate G-code for invalid custom G-code.
//
//   machine_start_gcode Parsing error at line 88: Not a variable name
//       M620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60}
//                  ^
//
//   Please check the custom G-code or use the default custom G-code.

import { i18n } from '../i18n';

const HEADER = 'Failed to generate G-code for invalid custom G-code.';
const ONE = /^(\w+) Parsing error at line (\d+)[:.] ?(.*)\n(.*)\n( *)\^/gm;

/** The variable (with its [index], if any) starting at `col` of `line`. */
function variableAt(line: string, col: number): string {
  const m = /^[A-Za-z_]\w*(\[[^\]\n]*\])?/.exec(line.slice(col));
  return m ? m[0] : '';
}

function why(reason: string, variable: string): string {
  // The engine's own reason stays as it gives it (English).
  const bare = reason.replace(/\.$/, '');
  if (/^Not a variable name/i.test(reason)) return variable ? i18n.t('gcodeErrors.notSetting', { variable }) : i18n.t('gcodeErrors.unknownName');
  if (/negative index/i.test(reason)) return variable ? i18n.t('gcodeErrors.negativeIndex', { variable }) : i18n.t('gcodeErrors.negativeIndexList');
  return variable ? i18n.t('gcodeErrors.reasonAt', { reason: bare, variable }) : i18n.t('gcodeErrors.reason', { reason: bare });
}

export interface GcodeError {
  /** The setting: machine_start_gcode, change_filament_gcode... */
  key: string;
  line: number;
  reason: string;
  /** The variable at fault, with its [index] if any; '' when there is none. */
  variable: string;
}

/** Each G-code the engine couldn't fill in; empty for any other error. */
export function gcodeErrors(message: string): GcodeError[] {
  if (!message.startsWith(HEADER)) return [];
  return [...message.matchAll(ONE)].map(([, key, line, reason, source, pad]) => ({ key, line: Number(line), reason, variable: variableAt(source, pad.length) }));
}

/**
 * A readable version of the engine's custom G-code error, or the message as
 * it is when it isn't one. `label` names a setting ("Machine start G-code").
 */
export function readableGcodeError(message: string, label: (key: string) => string | undefined): string {
  const lines: string[] = [];
  const where = new Set<string>();
  for (const { key, line, reason, variable } of gcodeErrors(message)) {
    lines.push(i18n.t('gcodeErrors.line', { setting: label(key) ?? key, line, why: why(reason, variable) }));
    where.add(key.startsWith('filament_') ? 'filament' : 'printer');
  }
  if (!lines.length) return message;
  const fix = [...where].map((w) => (w === 'filament' ? i18n.t('gcodeErrors.filamentSettings') : i18n.t('gcodeErrors.printerSettings'))).join(i18n.t('gcodeErrors.or'));
  return [lines.length === 1 ? i18n.t('gcodeErrors.stoppedOne') : i18n.t('gcodeErrors.stoppedSome'), ...lines, i18n.t('gcodeErrors.fix', { where: fix })].join('\n');
}
