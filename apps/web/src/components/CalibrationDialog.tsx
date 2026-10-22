import { useState } from 'react';
import {
  CALIBRATIONS,
  calibrationHint,
  changeChoice,
  checkCalibration,
  defaultValues,
  visibleFields,
  type CalibrationValues,
} from '../lib/calibration';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';

/** Desktop Orca's Calibration menu: pick a test, set its range, and it replaces the plate. */
export function CalibrationDialog({ onClose }: { onClose: () => void }) {
  const startCalibration = useSlicer((s) => s.startCalibration);
  const hasProject = useSlicer((s) => !!s.project?.objects.length);
  const [mode, setMode] = useState(CALIBRATIONS[0].mode);
  const test = CALIBRATIONS.find((c) => c.mode === mode) ?? CALIBRATIONS[0];
  const [values, setValues] = useState<Record<string, CalibrationValues>>({});
  const v = values[mode] ?? defaultValues(test);
  const change = (key: string, value: string | boolean) => setValues({ ...values, [mode]: { ...v, [key]: value } });
  const problem = checkCalibration(mode, v);
  const fields = visibleFields(test, v);
  const numbers = fields.filter((f) => (f.kind ?? 'number') === 'number');
  return (
    <Dialog
      title="Calibration"
      onClose={onClose}
      className="calib-dialog"
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!!problem}
            onClick={() => {
              onClose();
              void startCalibration(mode, v);
            }}
          >
            Create test
          </button>
        </>
      }
    >
      <label className="field">
        <span>Test</span>
        <select aria-label="Calibration test" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          {CALIBRATIONS.map((c) => (
            <option key={c.mode} value={c.mode}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">{calibrationHint(test, v)}</p>
      {test.choices?.map((c) => (
        <label key={c.key} className="field">
          <span>{c.label}</span>
          <select
            aria-label={c.label}
            value={String(v[c.key])}
            onChange={(e) => setValues({ ...values, [mode]: changeChoice(test, v, c.key, e.target.value) })}
          >
            {c.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {numbers.length > 0 && (
        <div className="calib-fields">
          {numbers.map((f) => (
            <label key={f.key} className="field">
              <span>
                {f.label}
                {f.unit && ` (${f.unit})`}
              </span>
              <input type="number" inputMode="decimal" step={f.step ?? 1} value={String(v[f.key])} onChange={(e) => change(f.key, e.target.value)} />
            </label>
          ))}
        </div>
      )}
      {fields
        .filter((f) => f.kind === 'list')
        .map((f) => (
          <label key={f.key} className="field calib-list">
            <span>
              {f.label}
              {f.unit && ` (${f.unit})`}
            </span>
            <input
              type="text"
              placeholder="Empty: from your settings"
              value={String(v[f.key])}
              onChange={(e) => change(f.key, e.target.value.replace(/[^\d,\s]/g, ''))}
            />
            {f.hint && <small className="muted">{f.hint}</small>}
          </label>
        ))}
      {fields
        .filter((f) => f.kind === 'check')
        .map((f) => (
          <label key={f.key} className="check">
            <input type="checkbox" checked={v[f.key] !== false} onChange={(e) => change(f.key, e.target.checked)} />
            {f.label}
          </label>
        ))}
      {problem && <p className="hint warn">{problem}</p>}
      <p className="muted small">
        {hasProject ? 'This replaces what is on the plate. ' : ''}
        The test changes the settings it needs; they show as changed in Settings until you end the test.
      </p>
    </Dialog>
  );
}

/** Shown while a calibration test is on the plate. */
export function CalibrationBanner() {
  const calibration = useSlicer((s) => s.calibration);
  const endCalibration = useSlicer((s) => s.endCalibration);
  if (!calibration) return null;
  return (
    <section className="calib-banner" aria-label="Calibration test">
      <span>
        <b>{calibration.title} test</b> on the plate. Slice and print it, then end the test to get your settings back.
      </span>
      <button className="secondary" onClick={() => void endCalibration()}>
        End test
      </button>
    </section>
  );
}
