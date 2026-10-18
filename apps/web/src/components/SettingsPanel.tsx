import { useState } from 'react';
import type { OptionDef } from '../engine/protocol';
import { useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';

const visible = (def: OptionDef | undefined, advanced: boolean) =>
  def != null && (advanced ? def.mode !== 'develop' : def.mode === 'simple');

export type SettingsKind = 'print' | 'filament' | 'printer';

/**
 * One kind of settings (process, filament or printer) in desktop Orca's own
 * pages and groups. With `slot`, the filament settings edit that filament.
 */
export function SettingsPages({ kind, advanced, slot }: { kind: SettingsKind; advanced: boolean; slot?: number }) {
  const pages = useSlicer((s) => s.layout?.[kind] ?? []);
  const options = useSlicer((s) => s.options);
  const [page, setPage] = useState(0);
  const current = pages[Math.min(page, pages.length - 1)];
  const hasFlowVariants = current?.groups.some((g) => g.options.some((k) => options[k]?.flow && visible(options[k], advanced)));
  return (
    <>
      <div className="pages" role="tablist" aria-label="Settings pages">
        {pages.map((p, i) => (
          <button key={p.page} role="tab" aria-selected={p === current} className={p === current ? 'page active' : 'page'} onClick={() => setPage(i)}>
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
              <OptionField key={`${k}:${slot ?? ''}`} optKey={k} slot={slot} />
            ))}
          </fieldset>
        );
      })}
    </>
  );
}

/**
 * The process settings, in the sidebar like desktop Orca's. Printer and
 * filament settings open in their own window from the edit button beside
 * their pickers. Changes are saved into a preset from the preset's ⋯ menu.
 */
export function SettingsPanel() {
  const hasLayout = useSlicer((s) => !!s.layout?.print.length);
  const overrides = useSlicer((s) => s.overrides);
  const resetOverrides = useSlicer((s) => s.resetOverrides);
  const [advanced, setAdvanced] = useState(false);
  if (!hasLayout) return null;
  const changed = Object.keys(overrides).length;

  return (
    <section className="group settings">
      <div className="group-head">
        <h2>Process settings</h2>
        <label className="check small">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          <span>Advanced</span>
        </label>
      </div>
      <SettingsPages kind="print" advanced={advanced} />
      {changed > 0 && (
        <p className="hint">
          {changed} setting{changed === 1 ? '' : 's'} changed from the presets. Save them into a preset from its ⋯ menu or its settings window.{' '}
          <button className="link" onClick={() => resetOverrides()}>
            Reset all
          </button>
        </p>
      )}
    </section>
  );
}
