import { shortName } from '../lib/presets';
import { installedOnly, SETUP_KEY, type Setup } from '../lib/setup';
import { useUserSetting } from '../state/account';
import { useSetupWizard } from './SetupWizard';
import { useOption, useSlicer } from '../state/store';
import { ObjectList } from './ObjectList';
import { PaintPanel } from './PaintPanel';
import { OptionField } from './OptionField';
import { SettingsPanel } from './SettingsPanel';
import { PresetMenu } from '../account/PresetMenu';
import type { PresetSummary } from '../engine/protocol';

/** The user's own presets always show, whatever the setup wizard installed. */
const withMine = (installed: string[] | undefined, list: PresetSummary[]) =>
  installed && [...installed, ...list.filter((p) => p.user).map((p) => p.name)];

function PrinterSection() {
  const allPrinters = useSlicer((s) => s.printers);
  const selection = useSlicer((s) => s.selection);
  const selectPrinter = useSlicer((s) => s.selectPrinter);
  const installed = useUserSetting<Setup>(SETUP_KEY)?.printers;
  const printers = installedOnly(allPrinters, withMine(installed, allPrinters), selection?.printer);
  const manage = useSetupWizard((s) => s.show);
  const busy = useSlicer((s) => s.engine !== 'ready');
  const group = (p: PresetSummary) => (p.user ? 'My printers' : p.vendor || 'Other');
  const vendors = [...new Set(printers.map(group))].sort((a, b) => Number(b === 'My printers') - Number(a === 'My printers'));
  return (
    <section className="group">
      <div className="group-head">
        <h2>Printer</h2>
        <div className="group-actions">
          <button className="link" onClick={manage}>
            Manage
          </button>
          <PresetMenu type="printer" />
        </div>
      </div>
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
                .filter((p) => group(p) === v)
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
  const allFilaments = useSlicer((s) => s.filaments);
  const installed = useUserSetting<Setup>(SETUP_KEY)?.filaments;
  const filaments = installedOnly(allFilaments, withMine(installed, allFilaments), selection?.filaments);
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
              <PresetOptions presets={filaments} />
            </select>
            <PresetMenu type="filament" slot={i} />
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
      <div className="group-head">
        <h2>Process</h2>
        <PresetMenu type="process" />
      </div>
      <label className="field">
        <span className="sr-only">Process preset</span>
        <select aria-label="Process preset" value={selection?.process ?? ''} onChange={(e) => void selectProcess(e.target.value)}>
          <PresetOptions presets={processes} />
        </select>
      </label>
    </section>
  );
}

/** A picker's options, the user's own presets first. */
function PresetOptions({ presets }: { presets: PresetSummary[] }) {
  const mine = presets.filter((p) => p.user);
  const options = (list: PresetSummary[]) =>
    list.map((p) => (
      <option key={p.name} value={p.name}>
        {shortName(p.name)}
      </option>
    ));
  if (!mine.length) return <>{options(presets)}</>;
  return (
    <>
      <optgroup label="My presets">{options(mine)}</optgroup>
      <optgroup label="System presets">{options(presets.filter((p) => !p.user))}</optgroup>
    </>
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
