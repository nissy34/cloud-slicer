import { Fragment, useEffect, useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OptionDef, OrcaConfig, SettingsPage } from '../engine/protocol';
import { splitValues, valueAt, withValueAt } from '../lib/flow-variants';
import { FLUSH_OPTIONS } from '../lib/flush';
import { GREYED_IN_BROWSER, GREYED_TIP, shownPages } from '../lib/settings-pages';
import { slotEntryIndex } from '../lib/slot-values';
import { saveUserSetting, useUserSetting } from '../state/account';
import { useOption, useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';
import { settingText } from '../i18n';
import { forgetChoice, useRememberedChoice } from './PresetChangesDialog';
import { useOptionStates } from './SettingsPrompt';

// Desktop's modes: Simple, Advanced, and Expert for Advanced plus desktop's Developer mode (its develop settings).
export type SettingsLevel = 'simple' | 'advanced' | 'expert';
const LEVELS: [SettingsLevel, string][] = [
  ['simple', 'settingsPanel.simple'],
  ['advanced', 'settingsPanel.advanced'],
  ['expert', 'settingsPanel.expert'],
];
const visible = (def: OptionDef | undefined, level: SettingsLevel) =>
  def != null && (level === 'expert' || (level === 'advanced' ? def.mode !== 'develop' : def.mode === 'simple'));

const LEVEL_KEY = 'settingsLevel';
/** Which settings show, kept with the account like desktop's preference; Simple to start with. Switches at once; the account save follows. */
export function useSettingsLevel(): SettingsLevel {
  const level = useUserSetting<SettingsLevel>(LEVEL_KEY);
  return level === 'advanced' || level === 'expert' ? level : 'simple';
}

/** Simple · Advanced · Expert: each shows more settings than the one before. */
export function SettingsLevelChips() {
  const { t } = useTranslation();
  const level = useSettingsLevel();
  return (
    <span className="chips levels" role="group" aria-label={t('settingsPanel.levelsShown')}>
      {LEVELS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className="chip"
          aria-pressed={level === id}
          title={id === 'expert' ? t('settingsPanel.expertTip') : undefined}
          onClick={() => saveUserSetting(LEVEL_KEY, id).catch(() => {})}
        >
          {t(label)}
        </button>
      ))}
    </span>
  );
}

export type SettingsKind = 'print' | 'filament' | 'printer';

/**
 * One kind of settings (process, filament or printer) in desktop Orca's own
 * pages and groups. With `slot`, the filament settings edit that filament.
 * Like desktop, the printer has one Extruder page per extruder, Motion ability
 * only for Marlin, Klipper and RepRap printers (with a Silent column when
 * silent_mode is on), and the filament a Setting Overrides page.
 */
/** The selected preset's own settings (Dependencies and other preset-only ones). */
function usePresetOwn(kind: SettingsKind, slot?: number): OrcaConfig | null {
  const name = useSlicer((s) => (kind === 'printer' ? s.selection?.printer : kind === 'print' ? s.selection?.process : s.selection?.filaments[slot ?? 0]));
  const [own, setOwn] = useState<OrcaConfig | null>(null);
  useEffect(() => {
    let live = true;
    setOwn(null);
    if (name)
      useSlicer
        .getState()
        .presetConfig(kind === 'print' ? 'process' : kind, name)
        .then((c) => live && setOwn(c), () => {});
    return () => {
      live = false;
    };
  }, [kind, name]);
  return own;
}

const SEARCH_WORDS: Record<SettingsKind, { search: string; none: string }> = {
  print: { search: 'settingsPanel.searchProcess', none: 'settingsPanel.noProcessMatch' },
  filament: { search: 'settingsPanel.searchFilament', none: 'settingsPanel.noFilamentMatch' },
  printer: { search: 'settingsPanel.searchPrinter', none: 'settingsPanel.noPrinterMatch' },
};

export function SettingsPages({ kind, slot }: { kind: SettingsKind; slot?: number }) {
  const { t } = useTranslation();
  const layout = useSlicer((s) => s.layout?.[kind] ?? NO_PAGES);
  const options = useSlicer((s) => s.options);
  const extruders = splitValues(useOption('nozzle_diameter') ?? '').length || 1;
  const flavor = useOption('gcode_flavor');
  const silent = useOption('silent_mode') === '1';
  const pages = useMemo(() => shownPages(layout, extruders, flavor), [layout, extruders, flavor]);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const states = useOptionStates('global', slot);
  const preset = usePresetOwn(kind, slot);
  const current = pages[Math.min(page, pages.length - 1)];
  const level = useSettingsLevel();
  const found = query.trim() ? searchSettings(pages, options, query, level === 'expert') : null;
  // A search finds settings in every page and in Advanced too; ones that don't apply show greyed out.
  // Purging between filaments only happens with one nozzle for several filaments (AMS, MMU...); a U1 has a head per filament.
  const flushes = useSlicer((s) => (s.flush?.flushes ?? false) && (s.selection?.filaments.length ?? 1) > 1);
  const noFlush = (k: string) => flushes || !FLUSH_OPTIONS.includes(k);
  const groups = (
    found ??
    current?.groups.map((g) => ({ title: g.title, page: current, keys: g.options.filter((k) => visible(options[k], level) && !states.hidden.has(k)) })) ??
    []
  ).map((g) => ({ ...g, keys: g.keys.filter(noFlush) }));
  const flushHidden = !flushes && kind === 'print' && !found && current?.groups.some((g) => g.options.some((k) => FLUSH_OPTIONS.includes(k)));
  const hasFlowVariants = groups.some((g) => g.keys.some((k) => options[k]?.flow));
  const words = SEARCH_WORDS[kind];
  const field = (k: string, at: ShownPage) => {
    const greyed = GREYED_IN_BROWSER.has(k);
    const off = greyed || states.disabled.has(k) || states.hidden.has(k);
    const why = greyed ? t(GREYED_TIP) : undefined;
    const choices = states.enumValues[k];
    // The Dependencies conditions aren't in the sliced config: shown from the preset itself.
    if (greyed && options[k]?.type === 'string' && !(k in (useSlicer.getState().baseConfig ?? {})))
      return <OptionField key={k} optKey={k} disabled why={why} value={preset?.[k] ?? ''} onChange={() => {}} />;
    if (at.overrides) return <OverrideField key={`${k}:${slot ?? ''}`} optKey={k} slot={slot ?? 0} />;
    if (at.limits?.includes(k))
      return (
        <Fragment key={k}>
          <OptionField optKey={k} entry={0} disabled={off} label={silent ? t('settingsPanel.normalMode', { label: settingText(options[k].fullLabel || options[k].label) }) : settingText(options[k].fullLabel) || undefined} />
          {silent && <OptionField optKey={k} entry={1} disabled={off} label={t('settingsPanel.silentMode', { label: settingText(options[k].fullLabel || options[k].label) })} />}
        </Fragment>
      );
    return <OptionField key={`${k}:${slot ?? ''}:${at.index ?? ''}`} optKey={k} slot={slot} entry={at.index} disabled={off} why={why} choices={choices} />;
  };
  return (
    <>
      <input
        type="search"
        className="settings-search"
        placeholder={t(words.search)}
        aria-label={t(words.search)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      {!found && (
        <div className="line-tabs" role="tablist" aria-label={t('settingsPanel.pages')}>
          {pages.map((p, i) => (
            <button key={p.page} role="tab" aria-selected={p === current} className={p === current ? 'active' : undefined} onClick={() => setPage(i)}>
              {settingText(p.page)}
            </button>
          ))}
        </div>
      )}
      {found && found.length === 0 && <p className="hint">{t(words.none, { query: query.trim() })}</p>}
      {hasFlowVariants && <FlowVariantSwitch />}
      {!found && current?.overrides && (
        <p className="hint">{t('settingsPanel.overridesHint')}</p>
      )}
      {groups.map((g) => {
        if (!g.keys.length) return null;
        return (
          <fieldset key={g.title} className="optgroup">
            <legend>{found ? g.title : settingText(g.title)}</legend>
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
  const { t } = useTranslation();
  const flushes = useSlicer((s) => s.flush?.flushes ?? false);
  return (
    <p className="hint" data-testid="no-flush-hint">
      {flushes ? t('settingsPanel.flushLater') : t('settingsPanel.noFlush')}
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
  const { t } = useTranslation();
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
  const label = settingText(def.label || def.fullLabel) || optKey;
  const toggle = (checked: boolean) => {
    const next = withValueAt(value, index, checked ? fallback : 'nil');
    setOverride(optKey, next === base ? null : next);
  };
  const box = (
    <input
      type="checkbox"
      className="override-check"
      aria-label={t('settingsPanel.useOwnNamed', { label })}
      title={on ? t('settingsPanel.usePrinters') : t('settingsPanel.useOwn')}
      checked={on}
      onChange={(e) => toggle(e.target.checked)}
    />
  );
  if (on) return <OptionField optKey={optKey} slot={slot} before={box} />;
  const enumAt = printerDef?.enumValues?.indexOf(fallback) ?? -1;
  const shown = printerDef?.type === 'bools' ? (fallback === '1' ? t('settingsPanel.yes') : t('settingsPanel.no')) : enumAt >= 0 ? settingText(printerDef?.enumLabels?.[enumAt] ?? '') || fallback : fallback;
  return (
    <div className="option unset" title={settingText(def.tooltip) || undefined}>
      <span className="option-label">
        {box}
        {label}
      </span>
      <span className="input-unit">
        <input aria-label={label} value={shown} disabled />
        {def.sidetext && <span className="unit">{settingText(def.sidetext)}</span>}
      </span>
    </div>
  );
}

/**
 * Settings whose name (or key, for people who know Orca's) has every word of
 * the query, grouped by page and group like desktop's settings search. Names match in
 * English and in the current language (desktop Orca's translation, settingText).
 */
export function searchSettings(pages: ShownPage[], options: Record<string, OptionDef>, query: string, developer = false) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const groups: { title: string; page: ShownPage; keys: string[] }[] = [];
  for (const p of pages)
    for (const g of p.groups) {
      const keys = g.options.filter((k) => {
        const def = options[k];
        if (!def || (def.mode === 'develop' && !developer)) return false;
        const shown = [def.label, def.fullLabel, g.title].map(settingText).join(' ');
        const text = `${def.label} ${def.fullLabel} ${k} ${k.replace(/_/g, ' ')} ${g.title} ${shown}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      if (keys.length) groups.push({ title: `${settingText(p.page)} › ${settingText(g.title)}`, page: p, keys });
    }
  return groups;
}

/**
 * The process settings, in the sidebar like desktop Orca's. Printer and
 * filament settings open in their own window from the edit button beside
 * their pickers. Changes are saved into a preset from the preset's ⋯ menu.
 */
export function SettingsPanel() {
  const { t } = useTranslation();
  const hasLayout = useSlicer((s) => !!s.layout?.print.length);
  const overrides = useSlicer((s) => s.overrides);
  const resetOverrides = useSlicer((s) => s.resetOverrides);
  const remembered = useRememberedChoice();
  if (!hasLayout) return null;
  const changed = Object.keys(overrides).length;

  return (
    <section className="group settings">
      <div className="group-head">
        <h2>
          <Settings2 aria-hidden />
          {t('settingsPanel.title')}
        </h2>
        <SettingsLevelChips />
      </div>
      <SettingsPages kind="print" />
      {changed > 0 && (
        <p className="hint">
          {t('settingsPanel.changed', { count: changed })}{' '}
          <button className="quiet" onClick={() => resetOverrides()}>
            {t('settingsPanel.resetAll')}
          </button>
          {remembered && (
            <>
              {' '}
              {remembered === 'keep' ? t('settingsPanel.newKeeps') : t('settingsPanel.newDiscards')}{' '}
              <button className="quiet" onClick={forgetChoice}>
                {t('settingsPanel.askAgain')}
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
