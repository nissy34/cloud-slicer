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

const HEADER = 'Failed to generate G-code for invalid custom G-code.';
const ONE = /^(\w+) Parsing error at line (\d+)[:.] ?(.*)\n(.*)\n( *)\^/gm;

/** The variable (with its [index], if any) starting at `col` of `line`. */
function variableAt(line: string, col: number): string {
  const m = /^[A-Za-z_]\w*(\[[^\]\n]*\])?/.exec(line.slice(col));
  return m ? m[0] : '';
}

function why(reason: string, variable: string): string {
  const v = variable ? `“${variable}”` : '';
  if (/^Not a variable name/i.test(reason))
    return v ? `${v} isn't a setting this slicer knows (it may come from another slicer or a newer version).` : 'it uses a name this slicer doesn\'t know.';
  if (/negative index/i.test(reason))
    return `${v || 'a list'} is read before the first filament is loaded (its index is -1 there); check that index with {if ...} first.`;
  return v ? `${reason.replace(/\.$/, '')} at ${v}.` : `${reason.replace(/\.$/, '')}.`;
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
    lines.push(`${label(key) ?? key}, line ${line}: ${why(reason, variable)}`);
    where.add(key.startsWith('filament_') ? 'filament' : 'printer');
  }
  if (!lines.length) return message;
  const fix = [...where].map((w) => `${w} settings`).join(' or ');
  return [
    `Slicing stopped: ${lines.length === 1 ? 'a custom G-code' : 'some custom G-code'} can't be filled in.`,
    ...lines,
    `Fix it in the ${fix}, or reset it to the preset's G-code.`,
  ].join('\n');
}
