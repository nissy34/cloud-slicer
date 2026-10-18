// Desktop Orca's Calibration menu: each test, the values its dialog asks for
// (with desktop's defaults and checks) and the test model it prints. The
// engine sets the test up (calib_api.cpp); the models are copied from
// resources/calib into public/engine/calib by scripts/copy-engine.mjs.

export type CalibrationMode =
  | 'temperature'
  | 'flowRate'
  | 'paLine'
  | 'paTower'
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
  value: number;
  step?: number;
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
  hint: string;
  fields: CalibrationField[];
  choices?: CalibrationChoice[];
}

const towerModel = { key: 'testModel', label: 'Test model', value: '0', options: [
  { value: '0', label: 'Ringing tower' },
  { value: '1', label: 'Fast tower' },
] };

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
    mode: 'paLine', title: 'Pressure advance (lines)', hint: 'Lines printed with rising pressure advance. Pick the most even line.',
    fields: [
      { key: 'start', label: 'Start PA', value: 0, step: 0.001 },
      { key: 'end', label: 'End PA', value: 0.1, step: 0.001 },
      { key: 'step', label: 'PA step', value: 0.002, step: 0.001 },
    ],
  },
  {
    mode: 'paTower', title: 'Pressure advance (tower)', hint: 'A tower whose pressure advance rises with height. Measure where the corners look best.',
    fields: [
      { key: 'start', label: 'Start PA', value: 0, step: 0.001 },
      { key: 'end', label: 'End PA', value: 0.1, step: 0.001 },
      { key: 'step', label: 'PA step', value: 0.002, step: 0.001 },
    ],
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

export type CalibrationValues = Record<string, number | string>;

/** Options for the engine's calibrationStart, with the test model to load. */
export function calibrationOptions(mode: CalibrationMode, v: CalibrationValues) {
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
    case 'paLine': return { ...base, model: 'pressure_advance/pressure_advance_test.stl' };
    case 'paTower': return { ...base, model: 'pressure_advance/tower_with_seam.stl' };
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
  const fields = CALIBRATIONS.find((c) => c.mode === mode)?.fields ?? [];
  if (fields.some((f) => !Number.isFinite(n(f.key)))) return 'Please fill in every value.';
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
    default:
      return n('start') < 0 || n('step') <= 0 || n('end') < n('start') + n('step')
        ? 'Start must be 0 or more, the step above 0, and end at least one step above start.' : '';
  }
}

export const defaultValues = (test: CalibrationTest): CalibrationValues => ({
  ...Object.fromEntries(test.fields.map((f) => [f.key, f.value])),
  ...Object.fromEntries((test.choices ?? []).map((c) => [c.key, c.value])),
});
