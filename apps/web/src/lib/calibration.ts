// Desktop Orca's Calibration menu: each test, the values its dialog asks for
// (with desktop's defaults and checks) and the test model it prints. The
// engine sets the test up (calib_api.cpp); the models are copied from
// resources/calib into public/engine/calib by scripts/copy-engine.mjs.

export type CalibrationMode =
  | 'temperature'
  | 'flowRate'
  | 'pressureAdvance'
  | 'retraction'
  | 'volumetricSpeed'
  | 'vfa'
  | 'inputShapingFrequency'
  | 'inputShapingDamping'
  | 'junctionDeviation';

export interface CalibrationField {
  key: string;
  label: string;
  unit?: string;
  value: number | string | boolean;
  step?: number;
  /** number (default), a tick box, or a comma separated list of whole numbers. */
  kind?: 'number' | 'check' | 'list';
  hint?: string;
  /** Shown only for these values of the test's choices. */
  when?: (v: CalibrationValues) => boolean;
}

export interface CalibrationChoice {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
}

export interface CalibrationTest {
  mode: CalibrationMode;
  title: string;
  hint: string | ((v: CalibrationValues) => string);
  fields: CalibrationField[];
  choices?: CalibrationChoice[];
  /** Desktop resets the fields to these when a choice changes. */
  defaults?: (v: CalibrationValues) => CalibrationValues;
}

const towerModel = { key: 'testModel', label: 'Test model', value: '0', options: [
  { value: '0', label: 'Ringing tower' },
  { value: '1', label: 'Fast tower' },
] };

const PA_HINTS: Record<string, string> = {
  tower: 'A tower whose pressure advance rises with height. Measure where the corners look best.',
  line: 'Lines printed with rising pressure advance. Pick the most even line.',
  pattern: 'Rows of nested corners, each printed with a higher pressure advance. Pick the sharpest corner with no gaps; the number above it is the value.',
};

export const CALIBRATIONS: CalibrationTest[] = [
  {
    mode: 'temperature', title: 'Temperature', hint: 'A tower with one block per nozzle temperature. Pick the block that looks best.',
    fields: [
      { key: 'start', label: 'Start temperature', unit: '°C', value: 230 },
      { key: 'end', label: 'End temperature', unit: '°C', value: 190 },
      { key: 'step', label: 'Step', unit: '°C', value: 5 },
    ],
  },
  {
    mode: 'flowRate', title: 'Flow rate', hint: 'Blocks printed at different flow ratios. Pick the smoothest top surface and set its ratio in the filament.',
    fields: [],
    choices: [{ key: 'method', label: 'Test', value: 'pass1', options: [
      { value: 'pass1', label: 'Pass 1 (coarse)' },
      { value: 'pass2', label: 'Pass 2 (fine)' },
      { value: 'yolo', label: 'YOLO (recommended)' },
      { value: 'yoloFine', label: 'YOLO (perfectionist)' },
    ] }],
  },
  {
    // Desktop's PA Calibration dialog (calib_dlg.cpp PA_Calibration_Dlg).
    mode: 'pressureAdvance', title: 'Pressure advance',
    hint: (v) => PA_HINTS[String(v.method)] ?? PA_HINTS.tower,
    choices: [
      { key: 'extruder', label: 'Extruder type', value: 'direct', options: [
        { value: 'direct', label: 'Direct drive' },
        { value: 'bowden', label: 'Bowden' },
      ] },
      { key: 'method', label: 'Method', value: 'tower', options: [
        { value: 'tower', label: 'Tower' },
        { value: 'line', label: 'Lines' },
        { value: 'pattern', label: 'Pattern' },
      ] },
    ],
    fields: [
      { key: 'start', label: 'Start PA', value: 0, step: 0.001 },
      { key: 'end', label: 'End PA', value: 0.1, step: 0.001 },
      { key: 'step', label: 'PA step', value: 0.002, step: 0.001 },
      { key: 'printNumbers', label: 'Print numbers', kind: 'check', value: true, when: (v) => v.method === 'line' },
      { key: 'accelerations', label: 'Accelerations', unit: 'mm/s²', kind: 'list', value: '', when: (v) => v.method === 'pattern',
        hint: 'Comma separated, like 1000, 3000. One test per speed and acceleration pair. Empty uses the outer wall acceleration.' },
      { key: 'speeds', label: 'Speeds', unit: 'mm/s', kind: 'list', value: '', when: (v) => v.method === 'pattern',
        hint: 'Comma separated, like 100, 200. Empty picks the best speed for the test.' },
    ],
    defaults: (v) => {
      const bowden = v.extruder === 'bowden';
      const pattern = v.method === 'pattern';
      return {
        start: 0,
        end: bowden ? 1 : pattern ? 0.08 : 0.1,
        step: bowden ? (pattern ? 0.05 : 0.02) : pattern ? 0.005 : 0.002,
      };
    },
  },
  {
    mode: 'retraction', title: 'Retraction', hint: 'A tower whose retraction length grows with height. Find the lowest length without strings.',
    fields: [
      { key: 'start', label: 'Start length', unit: 'mm', value: 0, step: 0.1 },
      { key: 'end', label: 'End length', unit: 'mm', value: 2, step: 0.1 },
      { key: 'step', label: 'Step', unit: 'mm', value: 0.1, step: 0.1 },
    ],
  },
  {
    mode: 'volumetricSpeed', title: 'Max volumetric speed', hint: 'A vase that prints faster as it grows. Note the height where it starts to fail.',
    fields: [
      { key: 'start', label: 'Start', unit: 'mm³/s', value: 5 },
      { key: 'end', label: 'End', unit: 'mm³/s', value: 20 },
      { key: 'step', label: 'Step', unit: 'mm³/s', value: 0.5, step: 0.1 },
    ],
  },
  {
    mode: 'vfa', title: 'VFA', hint: 'Vertical fine artifacts: a tower printed at rising speeds. Pick the speed with the cleanest walls.',
    fields: [
      { key: 'start', label: 'Start speed', unit: 'mm/s', value: 40 },
      { key: 'end', label: 'End speed', unit: 'mm/s', value: 200 },
      { key: 'step', label: 'Step', unit: 'mm/s', value: 10 },
    ],
  },
  {
    mode: 'inputShapingFrequency', title: 'Input shaping frequency', hint: 'Sweeps the input shaper frequency on X and Y. Pick where ringing is lowest.',
    fields: [
      { key: 'freqStartX', label: 'X start', unit: 'Hz', value: 15 },
      { key: 'freqEndX', label: 'X end', unit: 'Hz', value: 110 },
      { key: 'freqStartY', label: 'Y start', unit: 'Hz', value: 15 },
      { key: 'freqEndY', label: 'Y end', unit: 'Hz', value: 110 },
      { key: 'start', label: 'Damping', value: 0.15, step: 0.01 },
    ],
    choices: [towerModel],
  },
  {
    mode: 'inputShapingDamping', title: 'Input shaping damping', hint: 'Sweeps the damping factor at fixed frequencies. Pick where ringing is lowest.',
    fields: [
      { key: 'freqStartX', label: 'X frequency', unit: 'Hz', value: 30 },
      { key: 'freqStartY', label: 'Y frequency', unit: 'Hz', value: 30 },
      { key: 'start', label: 'Damping start', value: 0, step: 0.01 },
      { key: 'end', label: 'Damping end', value: 0.4, step: 0.01 },
    ],
    choices: [towerModel],
  },
  {
    mode: 'junctionDeviation', title: 'Junction deviation', hint: 'Sweeps junction deviation up the tower. Pick the highest value with sharp corners.',
    fields: [
      { key: 'start', label: 'Start', unit: 'mm', value: 0, step: 0.01 },
      { key: 'end', label: 'End', unit: 'mm', value: 0.25, step: 0.01 },
    ],
    choices: [towerModel],
  },
];

export type CalibrationValues = Record<string, number | string | boolean>;

/** Desktop's list fields keep the whole numbers above 0 (calib_dlg.cpp ParseStringValues). */
export const parseList = (text: unknown) =>
  String(text ?? '')
    .split(/[\s,]+/)
    .map((x) => parseInt(x, 10))
    .filter((x) => x > 0);

export const calibrationHint = (test: CalibrationTest, v: CalibrationValues) =>
  typeof test.hint === 'function' ? test.hint(v) : test.hint;

/** The fields shown for the current choices. */
export const visibleFields = (test: CalibrationTest, v: CalibrationValues) => test.fields.filter((f) => !f.when || f.when(v));

/** Options for the engine's calibrationStart, with the test model to load. */
export function calibrationOptions(mode: CalibrationMode, v: CalibrationValues): { mode: string; model?: string; [key: string]: unknown } {
  const n = (k: string) => Number(v[k] ?? 0);
  const towers = ['input_shaping/ringing_tower.stl', 'input_shaping/fast_tower_test.stl'];
  const title = CALIBRATIONS.find((c) => c.mode === mode)?.title ?? mode;
  const base = { mode, start: n('start'), end: n('end'), step: n('step'), name: `${title} test` };
  switch (mode) {
    case 'temperature': return { ...base, model: 'temperature_tower/temperature_tower.stl' };
    case 'flowRate': {
      const method = String(v.method ?? 'pass1');
      const linear = method.startsWith('yolo');
      const pass = method === 'pass2' || method === 'yoloFine' ? 2 : 1;
      const model = linear
        ? pass === 1 ? 'filament_flow/Orca-LinearFlow.3mf' : 'filament_flow/Orca-LinearFlow_fine.3mf'
        : `filament_flow/flowrate-test-pass${pass}.3mf`;
      return { ...base, model, linear, pass };
    }
    case 'pressureAdvance':
      switch (v.method) {
        case 'line':
          return { ...base, mode: 'paLine', printNumbers: v.printNumbers !== false, model: 'pressure_advance/pressure_advance_test.stl' };
        // The pattern needs no model file: the engine makes its test cubes.
        case 'pattern':
          return { ...base, mode: 'paPattern', speeds: parseList(v.speeds), accelerations: parseList(v.accelerations) };
        default:
          return { ...base, mode: 'paTower', model: 'pressure_advance/tower_with_seam.stl' };
      }
    case 'retraction': return { ...base, model: 'retraction/retraction_tower.stl' };
    case 'volumetricSpeed': return { ...base, model: 'volumetric_speed/SpeedTestStructure.stl' };
    case 'vfa': return { ...base, model: 'vfa/VFA.stl' };
    default: {
      const testModel = Number(v.testModel ?? 0);
      return {
        ...base,
        model: towers[testModel] ?? towers[0],
        testModel,
        freqStartX: n('freqStartX'),
        freqEndX: n('freqEndX'),
        freqStartY: n('freqStartY'),
        freqEndY: n('freqEndY'),
      };
    }
  }
}

/** Desktop's checks on the dialog values; returns a message, or '' when fine. */
export function checkCalibration(mode: CalibrationMode, v: CalibrationValues): string {
  const n = (k: string) => Number(v[k]);
  const test = CALIBRATIONS.find((c) => c.mode === mode);
  const fields = test ? visibleFields(test, v).filter((f) => (f.kind ?? 'number') === 'number') : [];
  if (fields.some((f) => v[f.key] === '' || !Number.isFinite(n(f.key)))) return 'Please fill in every value.';
  switch (mode) {
    case 'flowRate': return '';
    case 'inputShapingFrequency':
      if (n('freqStartX') < 0 || n('freqEndX') > 500 || n('freqStartY') < 0 || n('freqEndY') > 500 ||
          n('freqStartX') >= n('freqEndX') || n('freqStartY') >= n('freqEndY'))
        return 'Frequencies must be 0 ≤ start < end ≤ 500 Hz.';
      return n('start') < 0 || n('start') >= 1 ? 'The damping factor must be from 0 to below 1.' : '';
    case 'inputShapingDamping':
      if (n('freqStartX') < 0 || n('freqStartX') > 500 || n('freqStartY') < 0 || n('freqStartY') > 500)
        return 'Frequencies must be from 0 to 500 Hz.';
      return n('start') < 0 || n('end') > 1 || n('start') >= n('end') ? 'Damping must be 0 ≤ start < end ≤ 1.' : '';
    case 'junctionDeviation':
      return n('start') < 0 || n('end') >= 1 || n('start') >= n('end') ? 'Junction deviation must be 0 ≤ start < end < 1.' : '';
    case 'temperature':
      if (n('step') <= 0) return 'The step must be more than 0.';
      return n('start') > 350 || n('end') < 170 || n('end') > n('start') - 5
        ? 'Temperatures must be from 170 to 350 °C, with start at least 5 °C above end.' : '';
    case 'pressureAdvance':
      return n('start') < 0 || n('step') < 0.001 || n('end') < n('start') + n('step')
        ? 'Start PA must be 0 or more, the PA step at least 0.001, and end PA at least one step above start.' : '';
    default:
      return n('start') < 0 || n('step') <= 0 || n('end') < n('start') + n('step')
        ? 'Start must be 0 or more, the step above 0, and end at least one step above start.' : '';
  }
}

export const defaultValues = (test: CalibrationTest): CalibrationValues => {
  const v: CalibrationValues = {
    ...Object.fromEntries(test.fields.map((f) => [f.key, f.value])),
    ...Object.fromEntries((test.choices ?? []).map((c) => [c.key, c.value])),
  };
  return { ...v, ...test.defaults?.(v) };
};

/** Values after a choice changes: desktop resets the range for the new choice. */
export const changeChoice = (test: CalibrationTest, v: CalibrationValues, key: string, value: string): CalibrationValues => {
  const next = { ...v, [key]: value };
  return { ...next, ...test.defaults?.(next) };
};
