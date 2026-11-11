// "From printer" in the Filament section: loads the filaments in the printer's
// tool heads (or AMS) into the project, like desktop Snapmaker Orca's and
// Bambu Studio's Sync filament button. The printer and its filaments come from
// the Device tab's connection (state/device.ts, the printer add-on's
// `filaments`); the plan from lib/filament-sync.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Swatch } from './Swatch';
import { Dialog } from './Dialog';
import { Picker } from './Picker';
import { isLoaded, matchByColour, printerFilaments, syncPlan, syncPreset, type SyncMode } from '../lib/filament-sync';
import { shortName } from '../lib/presets';
import { installedFilaments, installedOnly, SETUP_KEY, type Setup } from '../lib/setup';
import { useUserSetting } from '../state/account';
import { useDevice } from '../state/device';
import { useSlicer } from '../state/store';

/** One of the printer's loaded filaments as a row at the top of a Filament list. */
export interface PrinterFilamentRow {
  head: number;
  /** "T1", "A3" */
  label: string;
  /** #RRGGBB */
  colour: string;
  /** The preset it becomes. */
  preset: string;
}

/**
 * The printer's loaded filaments for the top of each Filament list, like
 * desktop's "AMS filaments" (PresetComboBoxes.cpp add_ams_filaments): the
 * Device tab's printer, its loaded heads only, each with the preset "From
 * printer" would give it (a head with no preset for it is left out, as on
 * desktop). `reading` while the printer is connecting or hasn't said yet; null
 * when there is nothing to show (no printer, not connected, it doesn't say).
 */
export function usePrinterFilamentRows(): { group: string; reading: boolean; rows: PrinterFilamentRow[] } | null {
  const { t } = useTranslation();
  const printer = useDevice((s) => s.printers.find((p) => p.id === s.activeId));
  const conn = useDevice((s) => s.conn.state);
  const facts = useDevice((s) => s.facts);
  const fil = useDevice((s) => s.addons.find((a) => a.filaments)?.filaments);
  const objects = useDevice((s) => s.objects);
  const presets = useSlicer((s) => s.filaments);
  const installedList = installedFilaments(useUserSetting<Setup>(SETUP_KEY), useSlicer((s) => s.flavor));
  const installedKey = installedList?.join('\n');
  // A new array each render with the same names: kept while the names stay.
  const installedNames = useMemo(() => installedList, [installedKey]);
  const slots = useMemo(() => fil?.read(objects) ?? null, [fil, objects]);
  const rows = useMemo(() => {
    const installed = installedOnly(presets, installedNames);
    return printerFilaments(slots ?? [])
      .filter(isLoaded)
      .map((f) => ({ head: f.head, label: f.label, colour: f.colour.toUpperCase(), preset: syncPreset(presets, installed, f, '') }))
      .filter((r) => r.preset);
  }, [slots, presets, installedNames]);
  if (!printer) return null;
  const group = t('filamentSync.onPrinter', { name: printer.name });
  if (conn === 'connecting' || (conn === 'online' && (!facts || (fil && !slots)))) return { group, reading: true, rows: [] };
  if (conn !== 'online' || !rows.length) return null;
  return { group, reading: false, rows };
}

export function SyncFilamentsButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Only a printer that says what it has loaded can be synced: with just one
  // printer, connected and not saying (Prusa, OctoPrint, Elegoo, plain
  // Klipper), the button is greyed. With more, the dialog picks another.
  const silent = useDevice((s) => s.printers.length === 1 && s.conn.state === 'online' && !s.addons.some((a) => a.filaments));
  return (
    <>
      <button
        className="quiet"
        onClick={() => setOpen(true)}
        disabled={silent}
        title={silent ? t('filamentSync.silentTip') : t('filamentSync.buttonTip')}
        data-testid="sync-filaments"
      >
        {t('filamentSync.fromPrinter')}
      </button>
      {open && <SyncFilamentsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SyncFilamentsDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const printers = useDevice((s) => s.printers);
  const activeId = useDevice((s) => s.activeId);
  const conn = useDevice((s) => s.conn);
  const fil = useDevice((s) => s.addons.find((a) => a.filaments)?.filaments);
  const objects = useDevice((s) => s.objects);
  const selection = useSlicer((s) => s.selection);
  const presets = useSlicer((s) => s.filaments);
  const hasObjects = useSlicer((s) => (s.project?.objects.length ?? 0) > 0);
  const mixCount = useSlicer((s) => s.mixes.filter((m) => m.enabled && !m.deleted).length);
  const installedNames = installedFilaments(useUserSetting<Setup>(SETUP_KEY), useSlicer((s) => s.flavor));
  const printer = printers.find((p) => p.id === activeId);

  // Connects the printer the Device tab shows, if it isn't already.
  useEffect(() => useDevice.getState().start(), []);

  const slots = useMemo(() => fil?.read(objects) ?? null, [fil, objects]);
  const heads = useMemo(() => printerFilaments(slots ?? []), [slots]);
  const loaded = heads.filter(isLoaded);
  const project = useMemo(
    () =>
      (selection?.filaments ?? []).map((name, i) => ({
        preset: name,
        colour: selection?.colours[i] ?? '#FFFFFF',
        type: presets.find((p) => p.name === name)?.filamentType ?? '',
      })),
    [selection, presets],
  );

  const [mode, setMode] = useState<SyncMode>(hasObjects ? 'match' : 'replace');
  // The user's picks, until the printer's filaments change.
  const headsKey = heads.map((h) => `${h.type}/${h.colour}/${h.name}`).join('|');
  const [picked, setChoice] = useState<{ key: string; picks: number[] } | null>(null);
  const choice = picked?.key === headsKey ? picked.picks : null;
  const [addRest, setAddRest] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = conn.state === 'online' && loaded.length > 0;
  const picks = choice ?? matchByColour(project, heads);
  const plan = ready ? syncPlan(mode, project.length, heads, picks, addRest) : null;
  const installed = installedOnly(presets, installedNames);
  const presetFor = (f: (typeof heads)[number], i: number) => syncPreset(presets, installed, f, project[i]?.preset ?? project[project.length - 1]?.preset ?? '');
  const unused = loaded.filter((f) => !picks.slice(0, project.length).includes(heads.indexOf(f)));

  const load = async () => {
    if (!plan?.filaments.length || !printer) return;
    setBusy(true);
    await useSlicer.getState().syncFilaments(plan, plan.filaments.map(presetFor), printer.name);
    setBusy(false);
    onClose();
  };
  const openDevice = () => {
    onClose();
    useSlicer.getState().setTab('device');
  };

  let status: ReactNode = null;
  if (!printer)
    status = (
      <p data-testid="sync-status">
        {t('filamentSync.noPrinter')}
      </p>
    );
  else if (conn.state !== 'online')
    status = (
      <p data-testid="sync-status">
        {conn.state === 'offline'
          ? conn.message
            ? t('filamentSync.offlineWhy', { name: printer.name, message: conn.message })
            : t('filamentSync.offline', { name: printer.name })
          : t('filamentSync.connecting', { name: printer.name })}
      </p>
    );
  else if (!fil)
    status = (
      <p data-testid="sync-status">
        {t('filamentSync.silent', { name: printer.name })}
      </p>
    );
  else if (!slots) status = <p data-testid="sync-status">{t('filamentSync.reading')}</p>;
  else if (!loaded.length)
    status = (
      <p data-testid="sync-status">
        {t('filamentSync.noneLoaded', { name: printer.name })} {fil.words.unset}
      </p>
    );

  return (
    <Dialog
      title={t('filamentSync.title')}
      onClose={onClose}
      wide
      footer={
        <>
          {!ready && (
            <button className="secondary dv-left" onClick={openDevice}>
              {t('filamentSync.openDevice')}
            </button>
          )}
          <button className="secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={!plan?.filaments.length || busy} onClick={() => void load()} data-testid="sync-load">
            {t('filamentSync.load')}
          </button>
        </>
      }
    >
      <div className="sync-filaments">
        <p className="muted">
          {t('filamentSync.explain', { noun: fil?.words.noun ?? t('filamentSync.toolHead') })}
        </p>
        {printers.length > 1 && (
          <label className="field">
            <span>{t('filamentSync.printer')}</span>
            <Picker field label={t('filamentSync.printer')} value={activeId} options={printers.map((p) => ({ value: p.id, label: p.name }))} onChange={(id) => useDevice.getState().select(id)} />
          </label>
        )}
        {status}
        {ready && plan && (
          <>
            <div className="chooser" role="radiogroup" aria-label={t('filamentSync.howToLoad')}>
              <button role="radio" aria-checked={mode === 'match'} className={mode === 'match' ? 'on' : ''} onClick={() => setMode('match')}>
                {t('filamentSync.match')}
              </button>
              <button role="radio" aria-checked={mode === 'replace'} className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>
                {t('filamentSync.replace')}
              </button>
            </div>
            {mode === 'match' ? (
              <>
                <p className="small muted">
                  {t('filamentSync.matchExplain', { count: project.length })}
                </p>
                <ol className="sync-rows" data-testid="sync-rows">
                  {project.map((p, i) => {
                    const f = heads[picks[i]];
                    return (
                      <li key={i}>
                        <Swatch colour={p.colour} number={i + 1} />
                        <span className="sync-from">
                          {p.type || shortName(p.preset)}
                        </span>
                        <span aria-hidden>→</span>
                        {/* The printer's filaments, its slot name in the square. */}
                        <Picker
                          field
                          label={t('filamentSync.pickFor', { n: i + 1 })}
                          value={String(picks[i])}
                          options={heads.flatMap((h, j) => (isLoaded(h) ? [{ value: String(j), label: h.name, swatch: h.colour, swatchNumber: h.label }] : []))}
                          onChange={(v) => setChoice({ key: headsKey, picks: picks.map((c, j) => (j === i ? Number(v) : c)) })}
                        />
                        {f && <span className="sync-preset small muted">{shortName(presetFor(f, i))}</span>}
                      </li>
                    );
                  })}
                </ol>
                {unused.length > 0 && (
                  <label className="switch-row">
                    <input className="switch" type="checkbox" checked={addRest} onChange={(e) => setAddRest(e.target.checked)} />
                    <span>{t('filamentSync.addRest', { noun: fil?.words.noun ?? t('filamentSync.head'), list: unused.map((f) => f.label).join(', ') })}</span>
                  </label>
                )}
                {mixCount > 0 && (
                  <p className="small warn">{t('filamentSync.mixesFollow')}</p>
                )}
              </>
            ) : (
              <>
                <p className="small muted">
                  {t('filamentSync.replaceExplain')}
                  {hasObjects && ` ${t('filamentSync.replaceObjects')}`}
                </p>
                <ol className="sync-rows" data-testid="sync-rows">
                  {plan.filaments.map((f, i) => (
                    <li key={f.head}>
                      <Swatch colour={f.colour} number={i + 1} />
                      <span>
                        {f.label} · {f.name}
                      </span>
                      <span className="sync-preset small muted">{shortName(presetFor(f, i))}</span>
                    </li>
                  ))}
                </ol>
                {hasObjects && project.length > plan.filaments.length && (
                  <p className="small muted">
                    {t('filamentSync.objectsMove', {
                      count: project.length - plan.filaments.length,
                      list: project
                        .slice(plan.filaments.length)
                        .map((_, k) => `${plan.filaments.length + k + 1} → ${plan.remap?.[plan.filaments.length + k] ?? 1}`)
                        .join(', '),
                    })}
                  </p>
                )}
                {mixCount > 0 && (
                  <p className="small warn">
                    {t('filamentSync.mixesRemoved', { count: mixCount })}
                  </p>
                )}
              </>
            )}
            <p className="small muted">{t('filamentSync.onlyMaterials')}</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
