import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CALIBRATIONS,
  calibrationHint,
  calibrationTitle,
  changeChoice,
  checkCalibration,
  defaultValues,
  visibleFields,
  type CalibrationValues,
} from '../lib/calibration';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { Picker } from './Picker';

/** Desktop Orca's Calibration menu: pick a test, set its range, and it replaces the plate. */
export function CalibrationDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
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
      title={t('calibration.title')}
      onClose={onClose}
      className="calib-dialog"
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="primary"
            disabled={!!problem}
            onClick={() => {
              onClose();
              void startCalibration(mode, v);
            }}
          >
            {t('calibration.create')}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{t('calibration.test')}</span>
        <Picker field label={t('calibration.testLabel')} value={mode} options={CALIBRATIONS.map((c) => ({ value: c.mode, label: calibrationTitle(c.title) }))} onChange={(m) => setMode(m as typeof mode)} />
      </label>
      <p className="muted small">{calibrationHint(test, v)}</p>
      {test.choices?.map((c) => (
        <label key={c.key} className="field">
          <span>{t(c.label)}</span>
          <Picker
            field
            label={t(c.label)}
            value={String(v[c.key])}
            options={c.options.map((o) => ({ value: String(o.value), label: t(o.label) }))}
            onChange={(next) => setValues({ ...values, [mode]: changeChoice(test, v, c.key, next) })}
          />
        </label>
      ))}
      {numbers.length > 0 && (
        <div className="calib-fields">
          {numbers.map((f) => (
            <label key={f.key} className="field">
              <span>
                {t(f.label)}
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
              {t(f.label)}
              {f.unit && ` (${f.unit})`}
            </span>
            <input
              type="text"
              placeholder={t('calibration.emptyFromSettings')}
              value={String(v[f.key])}
              onChange={(e) => change(f.key, e.target.value.replace(/[^\d,\s]/g, ''))}
            />
            {f.hint && <small className="muted">{t(f.hint)}</small>}
          </label>
        ))}
      {fields
        .filter((f) => f.kind === 'check')
        .map((f) => (
          <label key={f.key} className="chip">
            <input type="checkbox" checked={v[f.key] !== false} onChange={(e) => change(f.key, e.target.checked)} />
            {t(f.label)}
          </label>
        ))}
      {problem && <p className="hint warn">{problem}</p>}
      <p className="muted small">
        {hasProject ? `${t('calibration.replacesPlate')} ` : ''}
        {t('calibration.changesSettings')}
      </p>
    </Dialog>
  );
}

/** Shown while a calibration test is on the plate. */
export function CalibrationBanner() {
  const { t } = useTranslation();
  const calibration = useSlicer((s) => s.calibration);
  const endCalibration = useSlicer((s) => s.endCalibration);
  if (!calibration) return null;
  return (
    <section className="calib-banner" aria-label={t('calibration.testLabel')}>
      <span>
        <b>{t('calibration.bannerTest', { title: calibrationTitle(calibration.title) })}</b> {t('calibration.bannerText')}
      </span>
      <button className="secondary" onClick={() => void endCalibration()}>
        {t('calibration.endTest')}
      </button>
    </section>
  );
}
