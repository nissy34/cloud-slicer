// Desktop Orca's Calibration menu: each test, the values its dialog asks for
// (with desktop's defaults and checks) and the test model it prints. The
// engine sets the test up (calib_api.cpp); the models are copied from
// resources/calib into public/engine/calib by scripts/copy-engine.mjs.
// Titles stay English in the table (they name the test object the engine makes);
// labels and hints are word keys, shown with t().
import { i18n } from '../i18n';

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

const towerModel = { key: 'testModel', label: 'calibration.testModel', value: '0', options: [
  { value: '0', label: 'calibration.ringingTower' },
  { value: '1', label: 'calibration.fastTower' },
] };

const PA_HINTS: Record<string, string> = {
  tower: 'calibration.paTowerHint',
  line: 'calibration.paLineHint',
  pattern: 'calibration.paPatternHint',
};

export const CALIBRATIONS: CalibrationTest[] = [
  {
    mode: 'temperature', title: 'Temperature', hint: 'calibration.temperatureHint',
    fields: [
      { key: 'start', label: 'calibration.startTemperature', unit: '°C', value: 230 },
      { key: 'end', label: 'calibration.endTemperature', unit: '°C', value: 190 },
      { key: 'step', label: 'calibration.step', unit: '°C', value: 5 },
    ],
  },
  {
    mode: 'flowRate', title: 'Flow rate', hint: 'calibration.flowRateHint',
    fields: [],
    choices: [{ key: 'method', label: 'calibration.test', value: 'pass1', options: [
      { value: 'pass1', label: 'calibration.pass1' },
      { value: 'pass2', label: 'calibration.pass2' },
      { value: 'yolo', label: 'calibration.yolo' },
      { value: 'yoloFine', label: 'calibration.yoloFine' },
    ] }],
  },
  {
    // Desktop's PA Calibration dialog (calib_dlg.cpp PA_Calibration_Dlg).
    mode: 'pressureAdvance', title: 'Pressure advance',
    hint: (v) => PA_HINTS[String(v.method)] ?? PA_HINTS.tower,
    choices: [
      { key: 'extruder', label: 'calibration.extruderType', value: 'direct', options: [
        { value: 'direct', label: 'calibration.directDrive' },
        { value: 'bowden', label: 'calibration.bowden' },
      ] },
      { key: 'method', label: 'calibration.method', value: 'tower', options: [
        { value: 'tower', label: 'calibration.tower' },
        { value: 'line', label: 'calibration.lines' },
        { value: 'pattern', label: 'calibration.pattern' },
      ] },
    ],
    fields: [
      { key: 'start', label: 'calibration.startPa', value: 0, step: 0.001 },
      { key: 'end', label: 'calibration.endPa', value: 0.1, step: 0.001 },
      { key: 'step', label: 'calibration.paStep', value: 0.002, step: 0.001 },
      { key: 'printNumbers', label: 'calibration.printNumbers', kind: 'check', value: true, when: (v) => v.method === 'line' },
      { key: 'accelerations', label: 'calibration.accelerations', unit: 'mm/s²', kind: 'list', value: '', when: (v) => v.method === 'pattern',
        hint: 'calibration.accelerationsHint' },
      { key: 'speeds', label: 'calibration.speeds', unit: 'mm/s', kind: 'list', value: '', when: (v) => v.method === 'pattern',
        hint: 'calibration.speedsHint' },
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
    mode: 'retraction', title: 'Retraction', hint: 'calibration.retractionHint',
    fields: [
      { key: 'start', label: 'calibration.startLength', unit: 'mm', value: 0, step: 0.1 },
      { key: 'end', label: 'calibration.endLength', unit: 'mm', value: 2, step: 0.1 },
      { key: 'step', label: 'calibration.step', unit: 'mm', value: 0.1, step: 0.1 },
    ],
  },
  {
    mode: 'volumetricSpeed', title: 'Max volumetric speed', hint: 'calibration.volumetricHint',
    fields: [
      { key: 'start', label: 'calibration.start', unit: 'mm³/s', value: 5 },
      { key: 'end', label: 'calibration.end', unit: 'mm³/s', value: 20 },
      { key: 'step', label: 'calibration.step', unit: 'mm³/s', value: 0.5, step: 0.1 },
    ],
  },
  {
    mode: 'vfa', title: 'VFA', hint: 'calibration.vfaHint',
    fields: [
      { key: 'start', label: 'calibration.startSpeed', unit: 'mm/s', value: 40 },
      { key: 'end', label: 'calibration.endSpeed', unit: 'mm/s', value: 200 },
      { key: 'step', label: 'calibration.step', unit: 'mm/s', value: 10 },
    ],
  },
  {
    mode: 'inputShapingFrequency', title: 'Input shaping frequency', hint: 'calibration.shapingFrequencyHint',
    fields: [
      { key: 'freqStartX', label: 'calibration.xStart', unit: 'Hz', value: 15 },
      { key: 'freqEndX', label: 'calibration.xEnd', unit: 'Hz', value: 110 },
      { key: 'freqStartY', label: 'calibration.yStart', unit: 'Hz', value: 15 },
      { key: 'freqEndY', label: 'calibration.yEnd', unit: 'Hz', value: 110 },
      { key: 'start', label: 'calibration.damping', value: 0.15, step: 0.01 },
    ],
    choices: [towerModel],
  },
  {
    mode: 'inputShapingDamping', title: 'Input shaping damping', hint: 'calibration.shapingDampingHint',
    fields: [
      { key: 'freqStartX', label: 'calibration.xFrequency', unit: 'Hz', value: 30 },
      { key: 'freqStartY', label: 'calibration.yFrequency', unit: 'Hz', value: 30 },
      { key: 'start', label: 'calibration.dampingStart', value: 0, step: 0.01 },
      { key: 'end', label: 'calibration.dampingEnd', value: 0.4, step: 0.01 },
    ],
    choices: [towerModel],
  },
  {
    mode: 'junctionDeviation', title: 'Junction deviation', hint: 'calibration.junctionHint',
    fields: [
      { key: 'start', label: 'calibration.start', unit: 'mm', value: 0, step: 0.01 },
      { key: 'end', label: 'calibration.end', unit: 'mm', value: 0.25, step: 0.01 },
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
  i18n.t(typeof test.hint === 'function' ? test.hint(v) : test.hint);

const TITLE_WORDS: Record<CalibrationMode, string> = {
  temperature: 'calibration.temperature',
  flowRate: 'calibration.flowRate',
  pressureAdvance: 'calibration.pressureAdvance',
  retraction: 'calibration.retraction',
  volumetricSpeed: 'calibration.volumetricSpeed',
  vfa: 'calibration.vfa',
  inputShapingFrequency: 'calibration.inputShapingFrequency',
  inputShapingDamping: 'calibration.inputShapingDamping',
  junctionDeviation: 'calibration.junctionDeviation',
};

/** A test's name in the site's language; `title` is the English one the table keeps. */
export function calibrationTitle(title: string): string {
  const mode = CALIBRATIONS.find((c) => c.title === title)?.mode;
  return mode ? i18n.t(TITLE_WORDS[mode]) : title;
}

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
  if (fields.some((f) => v[f.key] === '' || !Number.isFinite(n(f.key)))) return i18n.t('calibration.fillAll');
  switch (mode) {
    case 'flowRate': return '';
    case 'inputShapingFrequency':
      if (n('freqStartX') < 0 || n('freqEndX') > 500 || n('freqStartY') < 0 || n('freqEndY') > 500 ||
          n('freqStartX') >= n('freqEndX') || n('freqStartY') >= n('freqEndY'))
        return i18n.t('calibration.frequencies');
      return n('start') < 0 || n('start') >= 1 ? i18n.t('calibration.dampingFactor') : '';
    case 'inputShapingDamping':
      if (n('freqStartX') < 0 || n('freqStartX') > 500 || n('freqStartY') < 0 || n('freqStartY') > 500)
        return i18n.t('calibration.frequencyRange');
      return n('start') < 0 || n('end') > 1 || n('start') >= n('end') ? i18n.t('calibration.dampingRange') : '';
    case 'junctionDeviation':
      return n('start') < 0 || n('end') >= 1 || n('start') >= n('end') ? i18n.t('calibration.junctionRange') : '';
    case 'temperature':
      if (n('step') <= 0) return i18n.t('calibration.stepPositive');
      return n('start') > 350 || n('end') < 170 || n('end') > n('start') - 5
        ? i18n.t('calibration.temperatureRange') : '';
    case 'pressureAdvance':
      return n('start') < 0 || n('step') < 0.001 || n('end') < n('start') + n('step')
        ? i18n.t('calibration.paRange') : '';
    default:
      return n('start') < 0 || n('step') <= 0 || n('end') < n('start') + n('step')
        ? i18n.t('calibration.range') : '';
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
