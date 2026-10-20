import { useState } from 'react';
import type { OptionDef, SettingsPage } from '../engine/protocol';
import { useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';
import { useOptionStates } from './SettingsPrompt';

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
  const [query, setQuery] = useState('');
  const states = useOptionStates('global', slot);
  const current = pages[Math.min(page, pages.length - 1)];
  const found = query.trim() ? searchSettings(pages, options, query) : null;
  // A search finds settings in every page and in Advanced too; ones that don't apply show greyed out.
  const groups = found ?? current?.groups.map((g) => ({ title: g.title, keys: g.options.filter((k) => visible(options[k], advanced) && !states.hidden.has(k)) })) ?? [];
  const hasFlowVariants = groups.some((g) => g.keys.some((k) => options[k]?.flow));
  const label = kind === 'print' ? 'process' : kind;
  return (
    <>
      <input
        type="search"
        className="settings-search"
        placeholder={`Search ${label} settings`}
        aria-label={`Search ${label} settings`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      {!found && (
        <div className="pages" role="tablist" aria-label="Settings pages">
          {pages.map((p, i) => (
            <button key={p.page} role="tab" aria-selected={p === current} className={p === current ? 'page active' : 'page'} onClick={() => setPage(i)}>
              {p.page}
            </button>
          ))}
        </div>
      )}
      {found && found.length === 0 && <p className="hint">No {label} settings match “{query.trim()}”.</p>}
      {hasFlowVariants && <FlowVariantSwitch />}
      {groups.map((g) => {
        if (!g.keys.length) return null;
        return (
          <fieldset key={g.title} className="optgroup">
            <legend>{g.title}</legend>
            {g.keys.map((k) => (
              <OptionField
                key={`${k}:${slot ?? ''}`}
                optKey={k}
                slot={slot}
                disabled={states.disabled.has(k) || states.hidden.has(k)}
                choices={states.enumValues[k]}
              />
            ))}
          </fieldset>
        );
      })}
    </>
  );
}

/**
 * Settings whose name (or key, for people who know Orca's) has every word of
 * the query, grouped by page and group like desktop's settings search.
 */
export function searchSettings(pages: SettingsPage[], options: Record<string, OptionDef>, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const groups: { title: string; keys: string[] }[] = [];
  for (const p of pages)
    for (const g of p.groups) {
      const keys = g.options.filter((k) => {
        const def = options[k];
        if (!def || def.mode === 'develop') return false;
        const text = `${def.label} ${def.fullLabel} ${k} ${k.replace(/_/g, ' ')} ${g.title}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      if (keys.length) groups.push({ title: `${p.page} › ${g.title}`, keys });
    }
  return groups;
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
