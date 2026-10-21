import { describe, expect, it } from 'vitest';
import { gcodeErrors, readableGcodeError } from './gcode-errors';

// The engine's text for Bambu Studio 2.5's A1 mini G-code in Snapmaker Orca 2.4.
const ENGINE = `Failed to generate G-code for invalid custom G-code.

change_filament_gcode Parsing error at line 17: Referencing a vector variable with a negative index
{if long_retractions_when_cut[previous_extruder]}
    ^

machine_start_gcode Parsing error at line 88: Not a variable name
    M620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60} T{flush_temperatures[initial_no_support_extruder]}
               ^

Please check the custom G-code or use the default custom G-code.`;

const labels: Record<string, string> = { machine_start_gcode: 'Start G-code', change_filament_gcode: 'Change filament G-code' };

describe('gcodeErrors', () => {
  it('lists each G-code, line and variable', () => {
    expect(gcodeErrors(ENGINE)).toEqual([
      { key: 'change_filament_gcode', line: 17, reason: 'Referencing a vector variable with a negative index', variable: 'long_retractions_when_cut[previous_extruder]' },
      { key: 'machine_start_gcode', line: 88, reason: 'Not a variable name', variable: 'flush_volumetric_speeds[initial_no_support_extruder]' },
    ]);
    expect(gcodeErrors('This plate is empty.')).toEqual([]);
  });
});

describe('readableGcodeError', () => {
  it('names the G-code, the line and the variable', () => {
    expect(readableGcodeError(ENGINE, (k) => labels[k])).toBe(
      [
        "Slicing stopped: some custom G-code can't be filled in.",
        'Change filament G-code, line 17: “long_retractions_when_cut[previous_extruder]” is read before the first filament is loaded (its index is -1 there); check that index with {if ...} first.',
        "Start G-code, line 88: “flush_volumetric_speeds[initial_no_support_extruder]” isn't a setting this slicer knows (it may come from another slicer or a newer version).",
        "Fix it in the printer settings, or reset it to the preset's G-code.",
      ].join('\n'),
    );
  });
  it('sends filament G-code to the filament settings, and keeps unknown reasons', () => {
    const msg = 'Failed to generate G-code for invalid custom G-code.\n\nfilament_start_gcode Parsing error at line 2. Expecting tag expression\nM104 S{ }\n       ^\n\nPlease check the custom G-code or use the default custom G-code.';
    expect(readableGcodeError(msg, () => undefined)).toBe(
      "Slicing stopped: a custom G-code can't be filled in.\nfilament_start_gcode, line 2: Expecting tag expression.\nFix it in the filament settings, or reset it to the preset's G-code.",
    );
  });
  it('leaves other errors alone', () => {
    expect(readableGcodeError('This plate is empty.', () => undefined)).toBe('This plate is empty.');
  });
});
