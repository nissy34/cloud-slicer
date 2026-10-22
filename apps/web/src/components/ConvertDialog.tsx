import { useState } from 'react';
import { installedOnly, installedPrinters, SETUP_KEY, type Setup } from '../lib/setup';
import { loadConvertPreference } from '../lib/storage';
import { useUserSetting } from '../state/account';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';

/** Asks how to bring a 3MF made for a printer we don't have onto one we do. */
export function ConvertDialog() {
  const conversion = useSlicer((s) => s.conversion);
  const allPrinters = useSlicer((s) => s.printers);
  const installed = installedPrinters(useUserSetting<Setup>(SETUP_KEY), useSlicer((s) => s.flavor));
  const current = useSlicer((s) => s.selection?.printer ?? '');
  const { convertProject, dismissConversion } = useSlicer.getState();
  const [target, setTarget] = useState(() => loadConvertPreference()?.printer ?? '');
  const [keep, setKeep] = useState(true);
  const [remember, setRemember] = useState(false);
  if (!conversion) return null;
  const printers = installedOnly(allPrinters, installed);
  const printer = printers.some((p) => p.name === target) ? target : current;
  return (
    <Dialog
      title="Convert this project?"
      onClose={dismissConversion}
      footer={
        <>
          <button className="secondary" onClick={dismissConversion}>
            Cancel
          </button>
          <button className="primary" onClick={() => void convertProject(printer, keep, remember)}>
            Convert
          </button>
        </>
      }
    >
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
        <span>Keep the model settings the project changed: layers, walls, infill, supports, seams, brim</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Do this automatically next time</span>
      </label>
      <p className="muted small">
        Settings the project left at its old printer's defaults, and speeds, acceleration, jerk, line widths, flow calibration and the prime tower, come from {printer || 'your printer'}. Filaments are matched by material and kind (matte, silk, high flow...) and keep the project's colours.
      </p>
    </Dialog>
  );
}
