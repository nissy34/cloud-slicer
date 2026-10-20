import { Fragment, useMemo, useState } from 'react';
import type { OptionDef, SettingsPage } from '../engine/protocol';
import { splitValues, valueAt, withValueAt } from '../lib/flow-variants';
import { shownPages } from '../lib/settings-pages';
import { slotEntryIndex } from '../lib/slot-values';
import { useOption, useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';

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
  const current = pages[Math.min(page, pages.length - 1)];
  const hasFlowVariants = current?.groups.some((g) => g.options.some((k) => options[k]?.flow && visible(options[k], advanced)));
  const limits = new Set(current?.limits);
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
      {current?.overrides && (
        <p className="hint">Tick a setting to use this filament&apos;s own value. Unticked ones use the printer&apos;s, shown greyed out.</p>
      )}
      {current?.groups.map((g) => {
        const keys = g.options.filter((k) => visible(options[k], advanced));
        if (!keys.length) return null;
        return (
          <fieldset key={g.title} className="optgroup">
            <legend>{g.title}</legend>
            {keys.map((k) =>
              current.overrides ? (
                <OverrideField key={`${k}:${slot ?? ''}`} optKey={k} slot={slot ?? 0} />
              ) : limits.has(k) ? (
                <Fragment key={k}>
                  <OptionField optKey={k} entry={0} label={silent ? `${options[k].fullLabel || options[k].label} (Normal)` : options[k].fullLabel || undefined} />
                  {silent && <OptionField optKey={k} entry={1} label={`${options[k].fullLabel || options[k].label} (Silent)`} />}
                </Fragment>
              ) : (
                <OptionField key={`${k}:${slot ?? ''}:${current.index ?? ''}`} optKey={k} slot={slot} entry={current.index} />
              ),
            )}
          </fieldset>
        );
      })}
    </>
  );
}

const NO_PAGES: SettingsPage[] = [];

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
