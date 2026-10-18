import { useState } from 'react';
import { CALIBRATIONS, checkCalibration, defaultValues, type CalibrationValues } from '../lib/calibration';
import { useSlicer } from '../state/store';

/** Desktop Orca's Calibration menu: pick a test, set its range, and it replaces the plate. */
export function CalibrationDialog({ onClose }: { onClose: () => void }) {
  const startCalibration = useSlicer((s) => s.startCalibration);
  const hasProject = useSlicer((s) => !!s.project?.objects.length);
  const [mode, setMode] = useState(CALIBRATIONS[0].mode);
  const test = CALIBRATIONS.find((c) => c.mode === mode) ?? CALIBRATIONS[0];
  const [values, setValues] = useState<Record<string, CalibrationValues>>({});
  const v = values[mode] ?? defaultValues(test);
  const change = (key: string, value: string) => setValues({ ...values, [mode]: { ...v, [key]: value } });
  const problem = checkCalibration(mode, v);
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog calib-dialog" role="dialog" aria-modal="true" aria-labelledby="calib-title">
        <h2 id="calib-title">Calibration</h2>
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
        <p className="muted small">{test.hint}</p>
        {test.choices?.map((c) => (
          <label key={c.key} className="field">
            <span>{c.label}</span>
            <select aria-label={c.label} value={String(v[c.key])} onChange={(e) => change(c.key, e.target.value)}>
              {c.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {test.fields.length > 0 && (
          <div className="calib-fields">
            {test.fields.map((f) => (
              <label key={f.key} className="field">
                <span>
                  {f.label}
                  {f.unit && ` (${f.unit})`}
                </span>
                <input type="number" inputMode="decimal" step={f.step ?? 1} value={v[f.key]} onChange={(e) => change(f.key, e.target.value)} />
              </label>
            ))}
          </div>
        )}
        {problem && <p className="hint warn">{problem}</p>}
        <p className="muted small">
          {hasProject ? 'This replaces what is on the plate. ' : ''}
          The test changes the settings it needs; they show as changed in Settings until you end the test.
        </p>
        <div className="dialog-actions">
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
        </div>
      </div>
    </div>
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
