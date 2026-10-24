import { Fragment, useMemo, useState } from 'react';
import type { OptionDef, SettingsPage } from '../engine/protocol';
import { splitValues, valueAt, withValueAt } from '../lib/flow-variants';
import { FLUSH_OPTIONS } from '../lib/flush';
import { GREYED_IN_BROWSER, GREYED_TIP, shownPages } from '../lib/settings-pages';
import { slotEntryIndex } from '../lib/slot-values';
import { useOption, useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';
import { useOptionStates } from './SettingsPrompt';

const visible = (def: OptionDef | undefined, advanced: boolean) =>
  def != null && (advanced ? def.mode !== 'develop' : def.mode === 'simple');

export type SettingsKind = 'print' | 'filament' | 'printer';

/**
 * One kind of settings (process, filament or printer) in desktop Orca's own
 * pages and groups. With `slot`, the filament settings edit that filament.
 * Like desktop, the printer has one Extruder page per extruder, Motion ability
 * only for Marlin, Klipper and RepRap printers (with a Silent column when
 * silent_mode is on), and the filament a Setting Overrides page.
 */
export function SettingsPages({ kind, advanced, slot }: { kind: SettingsKind; advanced: boolean; slot?: number }) {
  const layout = useSlicer((s) => s.layout?.[kind] ?? NO_PAGES);
  const options = useSlicer((s) => s.options);
  const extruders = splitValues(useOption('nozzle_diameter') ?? '').length || 1;
  const flavor = useOption('gcode_flavor');
  const silent = useOption('silent_mode') === '1';
  const pages = useMemo(() => shownPages(layout, extruders, flavor), [layout, extruders, flavor]);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const states = useOptionStates('global', slot);
  const current = pages[Math.min(page, pages.length - 1)];
  const found = query.trim() ? searchSettings(pages, options, query) : null;
  // A search finds settings in every page and in Advanced too; ones that don't apply show greyed out.
  // Purging between filaments only happens with one nozzle for several filaments (AMS, MMU...); a U1 has a head per filament.
  const flushes = useSlicer((s) => (s.flush?.flushes ?? false) && (s.selection?.filaments.length ?? 1) > 1);
  const noFlush = (k: string) => flushes || !FLUSH_OPTIONS.includes(k);
  const groups = (
    found ??
    current?.groups.map((g) => ({ title: g.title, page: current, keys: g.options.filter((k) => visible(options[k], advanced) && !states.hidden.has(k)) })) ??
    []
  ).map((g) => ({ ...g, keys: g.keys.filter(noFlush) }));
  const flushHidden = !flushes && kind === 'print' && !found && current?.groups.some((g) => g.options.some((k) => FLUSH_OPTIONS.includes(k)));
  const hasFlowVariants = groups.some((g) => g.keys.some((k) => options[k]?.flow));
  const label = kind === 'print' ? 'process' : kind;
  const field = (k: string, at: ShownPage) => {
    const greyed = GREYED_IN_BROWSER.has(k);
    const off = greyed || states.disabled.has(k) || states.hidden.has(k);
    const why = greyed ? GREYED_TIP : undefined;
    const choices = states.enumValues[k];
    if (at.overrides) return <OverrideField key={`${k}:${slot ?? ''}`} optKey={k} slot={slot ?? 0} />;
    if (at.limits?.includes(k))
      return (
        <Fragment key={k}>
          <OptionField optKey={k} entry={0} disabled={off} label={silent ? `${options[k].fullLabel || options[k].label} (Normal)` : options[k].fullLabel || undefined} />
          {silent && <OptionField optKey={k} entry={1} disabled={off} label={`${options[k].fullLabel || options[k].label} (Silent)`} />}
        </Fragment>
      );
    return <OptionField key={`${k}:${slot ?? ''}:${at.index ?? ''}`} optKey={k} slot={slot} entry={at.index} disabled={off} why={why} choices={choices} />;
  };
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
      {!found && current?.overrides && (
        <p className="hint">Tick a setting to use this filament&apos;s own value. Unticked ones use the printer&apos;s, shown greyed out.</p>
      )}
      {groups.map((g) => {
        if (!g.keys.length) return null;
        return (
          <fieldset key={g.title} className="optgroup">
            <legend>{g.title}</legend>
            {g.keys.map((k) => field(k, g.page))}
          </fieldset>
        );
      })}
      {flushHidden && <NoFlushHint />}
    </>
  );
}

const NO_PAGES: SettingsPage[] = [];

/** Where desktop's Flush options would be, on a printer that never purges between filaments. */
function NoFlushHint() {
  const flushes = useSlicer((s) => s.flush?.flushes ?? false);
  return (
    <p className="hint" data-testid="no-flush-hint">
      {flushes
        ? 'Flush options (purging into infill, objects or support) appear here once the project has more than one filament.'
        : 'No flush options: this printer has a nozzle for each filament, so it never purges when it changes filament. Printers with one nozzle for several filaments (an AMS, MMU or CFS) show them here and get a Flushing volumes window in the Filament section.'}
    </p>
  );
}
type ShownPage = SettingsPage & { index?: number };

/**
 * One option of the filament Setting Overrides page, like desktop's: a
 * checkbox turns this filament's own value on; unticked, the value is unset
 * (nil) and the printer's value for this filament's extruder is used, shown
 * greyed out.
 */
function OverrideField({ optKey, slot }: { optKey: string; slot: number }) {
  const def = useSlicer((s) => s.options[optKey]);
  const value = useOption(optKey);
  const base = useSlicer((s) => s.baseConfig[optKey]);
  const slots = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const flowVariant = useSlicer((s) => s.flowVariant);
  const baseConfig = useSlicer((s) => s.baseConfig);
  const setOverride = useSlicer((s) => s.setOverride);
  const printerKey = optKey.replace(/^filament_/, '');
  const printerDef = useSlicer((s) => s.options[printerKey]);
  const printerValue = useOption(printerKey);
  if (!def || value === undefined) return null;
  const index = slotEntryIndex(value, slot, slots, baseConfig, def.flow === 'filament', flowVariant) ?? 0;
  const on = valueAt(value, index) !== 'nil';
  // The printer's value for the extruder this filament prints with (filament n on extruder n).
  const fallback = printerValue === undefined ? '' : valueAt(printerValue, slot);
  const label = def.label || def.fullLabel || optKey;
  const toggle = (checked: boolean) => {
    const next = withValueAt(value, index, checked ? fallback : 'nil');
    setOverride(optKey, next === base ? null : next);
  };
  const box = (
    <input
      type="checkbox"
      className="override-check"
      aria-label={`Use this filament's own ${label}`}
      title={on ? "Use the printer's value" : "Use this filament's own value"}
      checked={on}
      onChange={(e) => toggle(e.target.checked)}
    />
  );
  if (on) return <OptionField optKey={optKey} slot={slot} before={box} />;
  const enumAt = printerDef?.enumValues?.indexOf(fallback) ?? -1;
  const shown = printerDef?.type === 'bools' ? (fallback === '1' ? 'Yes' : 'No') : enumAt >= 0 ? printerDef?.enumLabels?.[enumAt] || fallback : fallback;
  return (
    <div className="option unset" title={def.tooltip || undefined}>
      <span className="option-label">
        {box}
        {label}
      </span>
      <span className="input-unit">
        <input aria-label={label} value={shown} disabled />
        {def.sidetext && <span className="unit">{def.sidetext}</span>}
      </span>
    </div>
  );
}

/**
 * Settings whose name (or key, for people who know Orca's) has every word of
 * the query, grouped by page and group like desktop's settings search.
 */
export function searchSettings(pages: ShownPage[], options: Record<string, OptionDef>, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const groups: { title: string; page: ShownPage; keys: string[] }[] = [];
  for (const p of pages)
    for (const g of p.groups) {
      const keys = g.options.filter((k) => {
        const def = options[k];
        if (!def || def.mode === 'develop') return false;
        const text = `${def.label} ${def.fullLabel} ${k} ${k.replace(/_/g, ' ')} ${g.title}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      if (keys.length) groups.push({ title: `${p.page} › ${g.title}`, page: p, keys });
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
