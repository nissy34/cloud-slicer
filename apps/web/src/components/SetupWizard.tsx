import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { create } from 'zustand';
import type { PresetSummary } from '../engine/protocol';
import { engineFromUrl, engineRelease, ENGINES, type EngineFlavor } from '../lib/engines';
import { shortName } from '../lib/presets';
import { coverUrl } from '../lib/printer-catalog';
import { filamentGroups, installedFilaments, installedPrinters, matchModels, SETUP_KEY, wizardBrands, type FilamentRow, type Setup } from '../lib/setup';
import { saveUserSetting, useAccount, useDevices, useUserSetting } from '../state/account';
import { useDevice } from '../state/device';
import { untouchedProject, useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { ask } from './AskDialog';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { Note } from './Note';
import { Picker } from './Picker';

/**
 * Opens the wizard from anywhere. Once setup is done, "Manage" and the pickers'
 * "Add or remove…" entries open the tabbed Printers and filaments window on
 * `step` instead; `wizard` keeps the step-by-step wizard on `step` (the first
 * visit, which comes back to a step after starting the other engine or adding
 * a printer connection).
 */
export const useSetupWizard = create<{
  open: boolean;
  step: Step;
  wizard: boolean;
  /** The engine picked on the first page, kept while the page restarts on it (see next()). */
  engine: EngineFlavor | null;
  show(step?: Step, wizard?: boolean): void;
  hide(): void;
}>((set) => ({
  open: false,
  step: 'engine',
  wizard: false,
  engine: null,
  show: (step = 'engine', wizard = false) => set({ open: true, step, wizard, engine: null }),
  hide: () => set({ open: false, wizard: false, engine: null }),
}));

// Closed this visit, or the visit started from a printer pairing link or the bridge app (the
// Device tab's add-printer dialog is waiting).
let dismissed = typeof location !== 'undefined' && (location.hash.startsWith('#pair=') || location.hash === '#device');

type Step = 'engine' | 'printers' | 'filaments' | 'connect';
const STEPS: { id: Step; label: string }[] = [
  { id: 'engine', label: 'Default engine' },
  { id: 'printers', label: 'Printers' },
  { id: 'filaments', label: 'Filaments' },
  { id: 'connect', label: 'Connect' },
];

/**
 * Desktop Orca's setup wizard: which engine new projects use, which printers
 * and filaments you have, so the pickers only offer those, and how to reach
 * each printer. Opens by itself until it has been finished once; the choices
 * follow the account. After that, changing them opens the tabbed Manage
 * window instead of walking the steps again.
 */
export function SetupWizard() {
  const { open, step, wizard, show, hide } = useSetupWizard();
  const ready = useSlicer((s) => s.engine === 'ready');
  const accountReady = useAccount((s) => s.status !== 'loading');
  const installedPrinters = useUserSetting<Setup>(SETUP_KEY)?.printers;
  // The Continue card goes first: the wizard waits until it is answered.
  const offerDone = useProjects((s) => s.offerChecked && !s.offer);
  useEffect(() => {
    if (ready && accountReady && offerDone && !installedPrinters?.length && !dismissed) show('engine', true);
  }, [ready, accountReady, offerDone, installedPrinters, show]);
  if (!open || !ready) return null;
  if (installedPrinters?.length && !wizard) return <Manage tab={step === 'filaments' || step === 'engine' ? step : 'printers'} onClose={hide} />;
  return (
    <Wizard
      onClose={() => {
        dismissed = true;
        hide();
      }}
    />
  );
}

function Wizard({ onClose }: { onClose: () => void }) {
  const allPrinters = useSlicer((s) => s.printers);
  const running = useSlicer((s) => s.flavor);
  const savedPrinters = installedPrinters(useUserSetting<Setup>(SETUP_KEY), running);
  const savedFilaments = installedFilaments(useUserSetting<Setup>(SETUP_KEY), running);
  const savedEngine = useUserSetting<Setup>(SETUP_KEY)?.engine;
  // Opened from a picker before setup was done: from the start.
  const [step, setStep] = useState<Step>(() => (useSetupWizard.getState().wizard ? useSetupWizard.getState().step : 'engine'));
  const [engine, setEngine] = useState<EngineFlavor>(useSetupWizard.getState().engine ?? savedEngine ?? running);
  // The first time nothing is picked, as on desktop: the printer the app starts on is not one you chose.
  const [printers, setPrinters] = useState<string[]>(() => savedPrinters ?? []);
  const [filaments, setFilaments] = useState<string[] | null>(savedFilaments?.length ? savedFilaments : null);
  const [saving, setSaving] = useState(false);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [error, setError] = useState('');

  const finish = async (then?: () => void) => {
    setSaving(true);
    setError('');
    try {
      // A printer you did not pick gives way to the first one you did. Selected
      // before saving: an empty first project then switches to the chosen
      // engine by itself (state/projects.ts) and takes the printer along.
      const s = useSlicer.getState();
      const mine = s.printers.some((p) => p.user && p.name === s.selection?.printer);
      if (s.selection && !mine && !printers.includes(s.selection.printer)) await s.selectPrinter(printers[0]);
      await saveUserSetting<Setup>(SETUP_KEY, { printers, printersIn: running, filaments: filaments ?? savedFilaments ?? [], filamentsIn: running, engine });
      onClose();
      then?.();
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const index = STEPS.findIndex((s) => s.id === step);
  const loadBrands = async () => {
    setLoadingBrands(true);
    try {
      await useSlicer.getState().loadVendors(printers);
      return true;
    } catch (e) {
      setError(`Could not load the printer profiles: ${(e as Error).message}`);
      return false;
    } finally {
      setLoadingBrands(false);
    }
  };
  const next = async () => {
    setError('');
    // A newly chosen default engine: the pages after this list its printers and
    // filaments. An untouched first project moves to it now (finishing would
    // move it anyway); the wizard comes back on the Printers page once it has
    // started. Keeping the default while trying the other engine moves nothing.
    if (step === 'engine' && engine !== running && engine !== savedEngine && untouchedProject() && !engineFromUrl()) {
      useSetupWizard.setState({ step: 'printers', wizard: true, engine });
      await useProjects.getState().switchEngine(engine);
      return;
    }
    // The filament page asks the engine, which loads a brand's presets only once one of its printers is picked.
    if (step === 'printers' && !(await loadBrands())) return;
    setStep(STEPS[index + 1].id);
  };
  return (
    <Dialog
      title="Set up your printers"
      onClose={onClose}
      className="wizard"
      footer={
        <>
          <button className="secondary wizard-later" onClick={onClose}>
            Not now
          </button>
          {index > 0 && (
            <button className="secondary" onClick={() => setStep(STEPS[index - 1].id)}>
              Back
            </button>
          )}
          {step === 'connect' && (
            <button
              className="secondary"
              disabled={saving}
              onClick={() =>
                void finish(() => {
                  useSlicer.getState().setTab('device');
                  void useDevice.getState().openEditor({ mode: 'add' });
                  // Back to this page once the printer is added (or not), to see it listed and finish.
                  const off = useDevice.subscribe((d, prev) => {
                    if (!prev.editor || d.editor) return;
                    off();
                    useSetupWizard.getState().show('connect', true);
                  });
                })
              }
            >
              Add a printer connection
            </button>
          )}
          {step === 'connect' ? (
            <button className="primary" disabled={saving || !printers.length} onClick={() => void finish()}>
              Finish
            </button>
          ) : (
            <button
              className="primary"
              disabled={step === 'printers' ? !printers.length || loadingBrands : step === 'filaments' && !filaments?.length}
              onClick={() => void next()}
            >
              Next
            </button>
          )}
        </>
      }
    >
      <p className="wizard-step-now">
        Step {index + 1} of {STEPS.length}: {STEPS[index].label}
      </p>
      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i === index ? 'on' : i < index ? 'done' : ''}>
            {s.label}
          </li>
        ))}
      </ol>
      <div className="wizard-body">
        {step === 'engine' && <EngineStep chosen={engine} onChange={setEngine} />}
        {step === 'printers' && <PrinterStep all={allPrinters} chosen={printers} onChange={setPrinters} />}
        {step === 'printers' && loadingBrands && <p className="muted small">Loading the printer profiles…</p>}
        {step === 'filaments' && <FilamentStep printers={printers} chosen={filaments} onLoad={setFilaments} onChange={setFilaments} />}
        {step === 'connect' && <ConnectStep />}
      </div>
      {error && <p className="hint warn">{error}</p>}
    </Dialog>
  );
}

type Tab = 'printers' | 'filaments' | 'engine';
const TABS: { id: Tab; label: string; short?: string }[] = [
  { id: 'printers', label: 'Printers' },
  { id: 'filaments', label: 'Filaments' },
  { id: 'engine', label: 'Default engine', short: 'Engine' },
];

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Changing your printers, filaments or default engine once setup is done: the
 * wizard's pages as tabs, saved together. Connect is left out (the Device tab
 * adds printer connections). Closing with changes asks first.
 */
function Manage({ tab: firstTab, onClose }: { tab: Tab; onClose: () => void }) {
  const allPrinters = useSlicer((s) => s.printers);
  const running = useSlicer((s) => s.flavor);
  const setup = useUserSetting<Setup>(SETUP_KEY);
  const [saved] = useState(() => ({
    printers: installedPrinters(setup, running) ?? [],
    filaments: installedFilaments(setup, running) ?? [],
    engine: setup?.engine ?? running,
  }));
  const [tab, setTab] = useState<Tab>(firstTab);
  const [printers, setPrinters] = useState(saved.printers);
  // What the Filaments tab starts with, and what you ticked there (null: nothing yet).
  const [loaded, setLoaded] = useState<string[] | null>(null);
  const [ticked, setTicked] = useState<string[] | null>(null);
  const [engine, setEngine] = useState<EngineFlavor>(saved.engine);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const printersChanged = !sameSet(printers, saved.printers);
  const changed = printersChanged || ticked !== null || engine !== saved.engine;
  const filaments = ticked ?? loaded ?? saved.filaments;

  const close = async () => {
    if (changed && !(await ask({ title: 'Discard your changes?', text: 'Your changes to printers, filaments or the default engine are not saved yet.', action: 'Discard changes' })))
      return;
    onClose();
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // The filament list and pickers need the brands of printers you added.
      if (printersChanged) await useSlicer.getState().loadVendors(printers);
      await saveUserSetting<Setup>(SETUP_KEY, { printers, printersIn: running, filaments, filamentsIn: running, engine });
      onClose();
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="Printers and filaments"
      onClose={() => void close()}
      className="manage"
      footer={
        <>
          {error && <Note tone="error" className="manage-error">{error}</Note>}
          <button className="secondary" onClick={() => void close()}>
            Cancel
          </button>
          <button className="primary" disabled={saving || !changed || !printers.length || !filaments.length} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="line-tabs manage-tabs" role="tablist" aria-label="Printers and filaments">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} aria-label={t.label} onClick={() => setTab(t.id)}>
            <span className="manage-tab-long">{t.label}</span>
            {t.short && <span className="manage-tab-short">{t.short}</span>}
          </button>
        ))}
      </div>
      <div className="manage-body" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {tab === 'printers' && <PrinterStep all={allPrinters} chosen={printers} onChange={setPrinters} manage />}
        {tab === 'filaments' &&
          (printers.length ? (
            <FilamentStep
              printers={printers}
              chosen={filaments}
              // Printers changed after ticking: the ticks carry over to the new list.
              onLoad={(names) => (ticked ? setTicked(names) : setLoaded(names))}
              onChange={setTicked}
            />
          ) : (
            <p className="muted">Pick a printer first: the filaments listed are the ones your printers have.</p>
          ))}
        {tab === 'engine' && <EngineStep chosen={engine} onChange={setEngine} heading={false} />}
      </div>
    </Dialog>
  );
}

function EngineStep({ chosen, onChange, heading = true }: { chosen: EngineFlavor; onChange: (engine: EngineFlavor) => void; heading?: boolean }) {
  return (
    <>
      {heading && <h3 className="wizard-engine-title">Default engine</h3>}
      <p className="muted small">
        New projects start with this engine. You can still pick the other one for any project: use Slicer engine above the printer. A project you open uses the
        engine it was made with.
      </p>
      <div className="wizard-engines" role="radiogroup" aria-label="Slicing engine">
        {ENGINES.map((e) => (
          <button key={e.id} role="radio" aria-label={e.name} aria-checked={chosen === e.id} className={chosen === e.id ? 'wizard-engine on' : 'wizard-engine'} onClick={() => onChange(e.id)}>
            <b>
              {e.name}
              {engineRelease(e.id) && <span className="picker-note">{engineRelease(e.id)}</span>}
            </b>
            <span className="muted small">{e.blurb}</span>
            <ul className="small">
              {e.examples.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </>
  );
}

/** `manage`: the Manage window's Printers tab, which lists your printers above instead of explaining the page. */
function PrinterStep({ all, chosen, onChange, manage }: { all: PresetSummary[]; chosen: string[]; onChange: (names: string[]) => void; manage?: boolean }) {
  const catalog = useSlicer((s) => s.catalog);
  const flavor = useSlicer((s) => s.flavor);
  // The brands you already have come first; the order stays put while you pick.
  const [first] = useState(chosen);
  const [query, setQuery] = useState('');
  const [sendOnly, setSendOnly] = useState(false);
  const brands = useMemo(() => wizardBrands(catalog, all, first), [catalog, all, first]);
  const toggle = (name: string) => onChange(chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name]);
  const q = query.trim();
  const shown = brands
    .map((b) => ({ ...b, models: matchModels(b.models, q).filter((m) => !sendOnly || m.send) }))
    .filter((b) => b.models.length);
  return (
    <>
      {manage && (
        <>
          <h3 className="manage-label">Your printers</h3>
          {chosen.length ? (
            <ul className="manage-mine">
              {chosen.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                  <IconButton icon={X} label={`Remove ${name}`} onClick={() => toggle(name)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No printers. Pick at least one below.</p>
          )}
          <h3 className="manage-label">Add a printer</h3>
        </>
      )}
      <p className="muted small" hidden={manage}>
        Pick each printer you have and its nozzle sizes in mm (you can change this later with Manage). Every printer slices here; <SendMark /> marks the ones this app can
        also send prints to and start (Klipper printers, Prusa printers through PrusaLink, the Elegoo Centauri Carbon, and Bambu Lab printers with Developer Mode on). For the others you download the G-code, or send it through OctoPrint if OctoPrint runs the printer.
      </p>
      <div className="wizard-filters">
        <input type="search" placeholder="Search printers" aria-label="Search printers" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={sendOnly} onChange={(e) => setSendOnly(e.target.checked)} />
          <span>Only direct print</span>
        </label>
      </div>
      <div className="wizard-brands">
        {shown.map((b) => {
          const picked = b.models.filter((m) => m.nozzles.some((n) => chosen.includes(n.name))).length;
          return (
            <details key={b.vendor} open={!!q || sendOnly || picked > 0 || shown.length === 1 || (b.vendor === 'Snapmaker' && !chosen.length)}>
              <summary>
                {b.vendor}{' '}
                <span className="muted small">
                  {picked ? `${picked} of ${b.models.length}` : `${b.models.length} printer${b.models.length === 1 ? '' : 's'}`}
                </span>
              </summary>
              <ul className="wizard-models">
                {b.models.map((m) => {
                  const on = m.nozzles.some((n) => chosen.includes(n.name));
                  return (
                    <li key={m.model} className={on ? 'on' : ''}>
                      {m.cover ? <img className="wizard-cover" src={coverUrl(flavor, m.cover)} alt="" loading="lazy" /> : <span className="wizard-cover" />}
                      <span className="wizard-model">
                        {m.model}
                        {m.send && <SendMark />}
                      </span>
                      <span className="chips" role="group" aria-label={`${m.model} nozzles`}>
                        {m.nozzles.map((n) => (
                          <button key={n.name} className="chip" aria-pressed={chosen.includes(n.name)} onClick={() => toggle(n.name)}>
                            {n.nozzle}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
        {!shown.length && <p className="muted">No printer matches “{q}”.</p>}
      </div>
      {!manage && (
        <p className="muted small">
          {chosen.length} printer profile{chosen.length === 1 ? '' : 's'} selected.
        </p>
      )}
    </>
  );
}

/** The "Direct print" mark: the app can send prints to this printer and start them (it runs Klipper, or the bridge reaches it another way: Prusa, Elegoo Centauri Carbon, Bambu Lab). */
export function SendMark() {
  return (
    <span className="send-mark" title="Direct print: this app sends prints to it and starts them from the Device tab (Klipper with Moonraker, Prusa with PrusaLink, the Elegoo Centauri Carbon, or Bambu Lab with Developer Mode on)">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M2 8.5 14 2l-3.5 12-2.7-4.3L2 8.5Zm5.8 1.2 1.6 2.6L11.6 5 7.8 9.7Z" fill="currentColor" />
      </svg>
      Direct print
    </span>
  );
}

/** `onLoad` gets the list it starts with (what you picked before, or the printers' defaults); `onChange` what you tick. */
function FilamentStep({
  printers,
  chosen,
  onLoad,
  onChange,
}: {
  printers: string[];
  chosen: string[] | null;
  onLoad: (names: string[]) => void;
  onChange: (names: string[]) => void;
}) {
  const filamentsFor = useSlicer((s) => s.filamentsFor);
  const [list, setList] = useState<PresetSummary[] | null>(null);
  const [error, setError] = useState('');
  const [type, setType] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all(printers.map((p) => filamentsFor(p)))
      .then((results) => {
        if (!live) return;
        const byName = new Map<string, PresetSummary>();
        for (const r of results) for (const f of r.filaments) byName.set(f.name, f);
        setList([...byName.values()]);
        const names = new Set(byName.keys());
        // A filament picked before covers the presets it has for printers added since (one row, see filamentGroups).
        const keptRows = new Set(chosen?.filter((n) => names.has(n)).map(shortName));
        const kept = [...names].filter((n) => keptRows.has(shortName(n)));
        // The Snapmaker profiles name no default materials for the wizard, so
        // start from the printers' default filaments plus the maker's own.
        const vendors = new Set(useSlicer.getState().printers.filter((p) => printers.includes(p.name)).map((p) => p.vendor));
        const brand = [...byName.values()].filter((f) => f.system && vendors.has(f.filamentVendor ?? '')).map((f) => f.name);
        onLoad(kept.length ? kept : [...new Set([...results.flatMap((r) => r.defaults), ...brand])]);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printers.join('\n')]);

  if (error) return <p className="hint warn">{error}</p>;
  if (!list) return <p className="muted">Finding filaments for your printers…</p>;
  const picked = new Set(chosen ?? []);
  const types = [...new Set(list.map((f) => f.filamentType || 'Other'))].sort();
  const q = query.trim().toLowerCase();
  const shown = new Set(list.filter((f) => (!type || (f.filamentType || 'Other') === type) && (!q || f.name.toLowerCase().includes(q))).map((f) => f.name));
  const groups = filamentGroups(list, shown);
  // Counted as the rows show them: one per filament, not per printer it has a preset for.
  const chosenRows = new Set(list.filter((f) => picked.has(f.name)).map((f) => shortName(f.name))).size;
  const set = (names: string[], on: boolean) => onChange(on ? [...new Set([...picked, ...names])] : [...picked].filter((n) => !names.includes(n)));
  return (
    <>
      <p className="muted small">Pick the filaments you use. The filament pickers will offer only these.</p>
      <div className="wizard-filters">
        <input type="search" placeholder="Search filaments" aria-label="Search filaments" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Picker field label="Material" value={type} options={[{ value: '', label: 'All materials' }, ...types.map((t) => ({ value: t, label: t }))]} onChange={setType} />
      </div>
      <div className="wizard-filaments">
        {groups.map((g) => {
          const names = g.rows.flatMap((r) => r.names);
          const on = (r: FilamentRow) => r.names.some((n) => picked.has(n));
          const count = g.rows.filter(on).length;
          return (
            <details key={g.vendor} open={groups.length <= 3 || count > 0 || !!q}>
              <summary>
                {g.vendor} <span className="muted small">{count ? `${count} of ${g.rows.length}` : g.rows.length}</span>
              </summary>
              <button className="quiet" onClick={() => set(names, count < g.rows.length)}>
                {count < g.rows.length ? 'Select all' : 'Select none'}
              </button>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.label}>
                    <label className="check">
                      <input type="checkbox" checked={on(r)} onChange={(e) => set(r.names, e.target.checked)} />
                      <span>{r.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      <p className="muted small">
        {chosenRows} filament{chosenRows === 1 ? '' : 's'} selected.
      </p>
    </>
  );
}

function ConnectStep() {
  // Bridges are saved alongside printers; only the printers are listed here.
  const devices = useDevices().filter((d) => d.extra?.kind !== 'bridge-agent');
  return (
    <>
      <p className="muted small">
        To send prints and watch them, add how to reach each printer: its address on your network (through a small bridge) or a public https address. You can do this now or later
        in the Device tab.
      </p>
      {devices.length > 0 ? (
        <ul className="wizard-devices">
          {devices.map((d) => (
            <li key={d.id}>
              <b>{d.name}</b> <span className="muted small">{d.preset || 'no printer profile yet'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No printer connections yet.</p>
      )}
    </>
  );
}
