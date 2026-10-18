import { useState } from 'react';
import { loadConvertPreference } from '../lib/storage';
import { useSlicer } from '../state/store';

/** Asks how to bring a 3MF made for a printer we don't have onto one we do. */
export function ConvertDialog() {
  const conversion = useSlicer((s) => s.conversion);
  const printers = useSlicer((s) => s.printers);
  const current = useSlicer((s) => s.selection?.printer ?? '');
  const { convertProject, dismissConversion } = useSlicer.getState();
  const [target, setTarget] = useState(() => loadConvertPreference()?.printer ?? '');
  const [keep, setKeep] = useState(true);
  const [remember, setRemember] = useState(false);
  if (!conversion) return null;
  const printer = printers.some((p) => p.name === target) ? target : current;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="convert-title">
        <h2 id="convert-title">Convert this project?</h2>
        <p>
          It was set up for <b>{conversion.from}</b>. Pick one of your printers to print it on.
        </p>
        <label className="field">
          <span>Printer</span>
          <select aria-label="Convert to printer" value={printer} onChange={(e) => setTarget(e.target.value)}>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>Keep the project's model settings: layers, walls, infill, supports, seams, brim</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Do this automatically next time</span>
        </label>
        <p className="muted small">
          Speeds, acceleration, jerk, line widths, flow calibration and the prime tower come from {printer || 'your printer'}. Filaments are matched by material and keep the project's colours.
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={dismissConversion}>
            Not now
          </button>
          <button className="primary" onClick={() => void convertProject(printer, keep, remember)}>
            Convert
          </button>
        </div>
      </div>
    </div>
  );
}
