import { useState } from 'react';
import type { OptionDef } from '../engine/protocol';
import { useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';

const visible = (def: OptionDef | undefined, advanced: boolean) =>
  def != null && (advanced ? def.mode !== 'develop' : def.mode === 'simple');

/** Process settings, laid out in desktop Orca's own pages and groups. */
export function SettingsPanel() {
  const layout = useSlicer((s) => s.layout);
  const options = useSlicer((s) => s.options);
  const overrides = useSlicer((s) => s.overrides);
  const resetOverrides = useSlicer((s) => s.resetOverrides);
  const [page, setPage] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  if (!layout?.print.length) return null;
  const pages = layout.print;
  const current = pages[Math.min(page, pages.length - 1)];
  const changed = Object.keys(overrides).length;
  const hasFlowVariants = current.groups.some((g) => g.options.some((k) => options[k]?.flow === 'process' && visible(options[k], advanced)));

  return (
    <section className="group settings">
      <div className="group-head">
        <h2>Settings</h2>
        <label className="check small">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          <span>Advanced</span>
        </label>
      </div>
      <div className="pages" role="tablist" aria-label="Settings pages">
        {pages.map((p, i) => (
          <button key={p.page} role="tab" aria-selected={p === current} className={p === current ? 'page active' : 'page'} onClick={() => setPage(i)}>
            {p.page}
          </button>
        ))}
      </div>
      {hasFlowVariants && <FlowVariantSwitch />}
      {current.groups.map((g) => {
        const keys = g.options.filter((k) => visible(options[k], advanced));
        if (!keys.length) return null;
        return (
          <fieldset key={g.title} className="optgroup">
            <legend>{g.title}</legend>
            {keys.map((k) => (
              <OptionField key={k} optKey={k} />
            ))}
          </fieldset>
        );
      })}
      {changed > 0 && (
        <p className="hint">
          {changed} setting{changed === 1 ? '' : 's'} changed from the presets.{' '}
          <button className="link" onClick={() => resetOverrides()}>
            Reset all
          </button>
        </p>
      )}
    </section>
  );
}
