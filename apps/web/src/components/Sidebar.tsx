import { shortName } from '../lib/presets';
import { useOption, useSlicer } from '../state/store';
import { ObjectList } from './ObjectList';
import { PaintPanel } from './PaintPanel';
import { OptionField } from './OptionField';
import { SettingsPanel } from './SettingsPanel';

function PrinterSection() {
  const printers = useSlicer((s) => s.printers);
  const selection = useSlicer((s) => s.selection);
  const selectPrinter = useSlicer((s) => s.selectPrinter);
  const busy = useSlicer((s) => s.engine !== 'ready');
  const vendors = [...new Set(printers.map((p) => p.vendor || 'Other'))];
  return (
    <section className="group">
      <h2>Printer</h2>
      <label className="field">
        <span className="sr-only">Printer preset</span>
        <select
          aria-label="Printer preset"
          value={selection?.printer ?? ''}
          disabled={busy}
          onChange={(e) => void selectPrinter(e.target.value)}
        >
          {vendors.map((v) => (
            <optgroup key={v} label={v}>
              {printers
                .filter((p) => (p.vendor || 'Other') === v)
                .map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <OptionField optKey="curr_bed_type" label="Plate type" />
    </section>
  );
}

function FilamentSection() {
  const selection = useSlicer((s) => s.selection);
  const filaments = useSlicer((s) => s.filaments);
  const { setFilament, setColour, addFilament, removeFilament } = useSlicer.getState();
  const extruders = (useOption('nozzle_diameter') ?? '').split(',').filter(Boolean).length;
  if (!selection) return null;
  return (
    <section className="group">
      <div className="group-head">
        <h2>Filament</h2>
        <button className="link" onClick={() => void addFilament()} aria-label="Add filament">
          + Add
        </button>
      </div>
      <ol className="slots">
        {selection.filaments.map((name, i) => (
          <li key={i} className="slot">
            <label className="swatch" style={{ background: selection.colours[i] }} title="Filament colour">
              <span className="slot-number">{i + 1}</span>
              <input
                type="color"
                aria-label={`Filament ${i + 1} colour`}
                value={toHex6(selection.colours[i])}
                onChange={(e) => void setColour(i, e.target.value.toUpperCase())}
              />
            </label>
            <select aria-label={`Filament ${i + 1} preset`} value={name} onChange={(e) => void setFilament(i, e.target.value)}>
              {!filaments.some((f) => f.name === name) && <option value={name}>{shortName(name)}</option>}
              {filaments.map((f) => (
                <option key={f.name} value={f.name}>
                  {shortName(f.name)}
                </option>
              ))}
            </select>
            <button
              className="icon"
              aria-label={`Remove filament ${i + 1}`}
              disabled={selection.filaments.length <= 1}
              onClick={() => void removeFilament(i)}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      {extruders > 0 && selection.filaments.length > extruders && (
        <p className="hint warn">
          {selection.filaments.length} filaments on a printer with {extruders} extruders.
        </p>
      )}
    </section>
  );
}

function ProcessSection() {
  const processes = useSlicer((s) => s.processes);
  const selection = useSlicer((s) => s.selection);
  const selectProcess = useSlicer((s) => s.selectProcess);
  return (
    <section className="group">
      <h2>Process</h2>
      <label className="field">
        <span className="sr-only">Process preset</span>
        <select aria-label="Process preset" value={selection?.process ?? ''} onChange={(e) => void selectProcess(e.target.value)}>
          {processes.map((p) => (
            <option key={p.name} value={p.name}>
              {shortName(p.name)}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

export function Sidebar() {
  return (
    <aside className="panel">
      <PaintPanel />
      <PrinterSection />
      <FilamentSection />
      <ObjectList />
      <ProcessSection />
      <SettingsPanel />
    </aside>
  );
}

/** "#RGB", "#RRGGBBAA" -> "#RRGGBB" for <input type=color>. */
function toHex6(colour: string | undefined): string {
  const c = (colour ?? '#FFFFFF').trim();
  if (/^#[0-9a-f]{6}/i.test(c)) return c.slice(0, 7);
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return '#FFFFFF';
}
