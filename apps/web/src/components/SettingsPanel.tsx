import { useState } from 'react';
import type { OptionDef, SettingsPage } from '../engine/protocol';
import { shortName } from '../lib/presets';
import { useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';

const visible = (def: OptionDef | undefined, advanced: boolean) =>
  def != null && (advanced ? def.mode !== 'develop' : def.mode === 'simple');

type Kind = 'print' | 'filament' | 'printer';
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'print', label: 'Process' },
  { kind: 'filament', label: 'Filament' },
  { kind: 'printer', label: 'Printer' },
];

/**
 * Process, filament and printer settings, laid out in desktop Orca's own
 * tabs, pages and groups. Changes are made on top of the selected presets and
 * saved into a preset from the preset's ⋯ menu, like desktop's save button.
 */
export function SettingsPanel() {
  const layout = useSlicer((s) => s.layout);
  const options = useSlicer((s) => s.options);
  const overrides = useSlicer((s) => s.overrides);
  const resetOverrides = useSlicer((s) => s.resetOverrides);
  const filaments = useSlicer((s) => s.selection?.filaments.length ?? 0);
  const [kind, setKind] = useState<Kind>('print');
  const [pageByKind, setPageByKind] = useState<Record<Kind, number>>({ print: 0, filament: 0, printer: 0 });
  const [advanced, setAdvanced] = useState(false);
  const [slot, setSlot] = useState(0);
  if (!layout?.print.length) return null;
  const pages: SettingsPage[] = layout[kind] ?? [];
  const page = pageByKind[kind];
  const current = pages[Math.min(page, pages.length - 1)];
  const filamentSlot = kind === 'filament' ? Math.min(slot, Math.max(0, filaments - 1)) : undefined;
  const changed = Object.keys(overrides).length;
  const hasFlowVariants = current?.groups.some((g) => g.options.some((k) => options[k]?.flow && visible(options[k], advanced)));

  return (
    <section className="group settings">
      <div className="group-head">
        <h2>Settings</h2>
        <label className="check small">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          <span>Advanced</span>
        </label>
      </div>
      <div className="settings-kinds" role="tablist" aria-label="Settings for">
        {KINDS.filter((k) => layout[k.kind]?.length).map((k) => (
          <button key={k.kind} role="tab" aria-selected={k.kind === kind} className={k.kind === kind ? 'kind active' : 'kind'} onClick={() => setKind(k.kind)}>
            {k.label}
          </button>
        ))}
      </div>
      {kind === 'filament' && filaments > 1 && <FilamentSlotPicker slot={filamentSlot ?? 0} onPick={setSlot} />}
      <div className="pages" role="tablist" aria-label="Settings pages">
        {pages.map((p, i) => (
          <button
            key={p.page}
            role="tab"
            aria-selected={p === current}
            className={p === current ? 'page active' : 'page'}
            onClick={() => setPageByKind((s) => ({ ...s, [kind]: i }))}
          >
            {p.page}
          </button>
        ))}
      </div>
      {hasFlowVariants && <FlowVariantSwitch />}
      {current?.groups.map((g) => {
        const keys = g.options.filter((k) => visible(options[k], advanced));
        if (!keys.length) return null;
        return (
          <fieldset key={g.title} className="optgroup">
            <legend>{g.title}</legend>
            {keys.map((k) => (
              <OptionField key={`${k}:${filamentSlot ?? ''}`} optKey={k} slot={filamentSlot} />
            ))}
          </fieldset>
        );
      })}
      {changed > 0 && (
        <p className="hint">
          {changed} setting{changed === 1 ? '' : 's'} changed from the presets. Save them into a preset from its ⋯ menu.{' '}
          <button className="link" onClick={() => resetOverrides()}>
            Reset all
          </button>
        </p>
      )}
    </section>
  );
}

/** Which filament the Filament settings show, like desktop's filament combo boxes. */
function FilamentSlotPicker({ slot, onPick }: { slot: number; onPick: (slot: number) => void }) {
  const selection = useSlicer((s) => s.selection);
  if (!selection) return null;
  return (
    <div className="slot-picker" role="radiogroup" aria-label="Filament to edit">
      {selection.filaments.map((name, i) => (
        <button key={i} role="radio" aria-checked={i === slot} className={i === slot ? 'active' : ''} title={name} onClick={() => onPick(i)}>
          <span className="slot-dot" style={{ background: selection.colours[i] }} />
          {i + 1}
          <span className="slot-name">{shortName(name)}</span>
        </button>
      ))}
    </div>
  );
}
