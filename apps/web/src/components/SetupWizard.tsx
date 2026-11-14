import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { create } from 'zustand';
import type { PresetSummary } from '../engine/protocol';
import { engineFromUrl, engineRelease, ENGINES, type EngineFlavor } from '../lib/engines';
import { shortName } from '../lib/presets';
import { coverUrl } from '../lib/printer-catalog';
import { filamentGroups, installedFilaments, installedPrinters, matchModels, SETUP_KEY, wizardBrands, type FilamentRow, type Setup } from '../lib/setup';
import { saveUserSetting, useAccount, useAccountSettled, useDevices, useUserSetting } from '../state/account';
import { useDevice } from '../state/device';
import { untouchedProject, useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { ask } from './AskDialog';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { Note } from './Note';
import { GoogleMark } from './GoogleMark';
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
// Device tab's add-printer dialog is waiting), or an AI app's sign-in link (#link).
let dismissed = typeof location !== 'undefined' && (location.hash.startsWith('#pair=') || location.hash === '#device' || location.hash.startsWith('#link'));

/** `welcome` comes before the numbered steps, only when signed out: sign in, or set up this browser. */
type Step = 'welcome' | 'engine' | 'printers' | 'filaments' | 'connect';
// Labels are word keys, shown with t().
const STEPS: { id: Exclude<Step, 'welcome'>; label: string }[] = [
  { id: 'engine', label: 'setupWizard.defaultEngine' },
  { id: 'printers', label: 'setupWizard.printers' },
  { id: 'filaments', label: 'setupWizard.filaments' },
  { id: 'connect', label: 'setupWizard.connect' },
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
  // Signed in, the account's printers arrive just after the status: wait for them, or the wizard flashes up.
  const accountReady = useAccountSettled();
  const installedPrinters = useUserSetting<Setup>(SETUP_KEY)?.printers;
  // The Continue card goes first: the wizard waits until it is answered.
  const offerDone = useProjects((s) => s.offerChecked && !s.offer);
  useEffect(() => {
    // (`open`: signing in on the welcome page closes the wizard, and it comes back here if the account has no printers yet.)
    if (!open && ready && accountReady && offerDone && !installedPrinters?.length && !dismissed) show('welcome', true);
  }, [open, ready, accountReady, offerDone, installedPrinters, show]);
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
  const { t } = useTranslation();
  const allPrinters = useSlicer((s) => s.printers);
  const running = useSlicer((s) => s.flavor);
  const savedPrinters = installedPrinters(useUserSetting<Setup>(SETUP_KEY), running);
  const savedFilaments = installedFilaments(useUserSetting<Setup>(SETUP_KEY), running);
  const savedEngine = useUserSetting<Setup>(SETUP_KEY)?.engine;
  // Signed out on a site with sign-in: the first page offers it, for people who already set up their printers on their account.
  const canSignIn = useAccount((s) => s.status === 'signedOut' && s.providers.google);
  // Opened from a picker before setup was done: from the start.
  const [step, setStep] = useState<Step>(() => {
    // Manage (not the first-visit wizard) opens straight at the steps, never the welcome page.
    const asked = useSetupWizard.getState().wizard ? useSetupWizard.getState().step : 'engine';
    return asked === 'welcome' && !canSignIn ? 'engine' : asked;
  });
  const [openedOnWelcome] = useState(step === 'welcome');
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
      setError(t('setupWizard.couldNotSave', { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  // Signed in from the welcome page: the wizard closes. The account's printers and settings
  // (and the Continue card for its last project) take over; with no printers on the account
  // yet, the wizard opens again without the welcome page, on Default engine.
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const accountSettled = useAccountSettled();
  useEffect(() => {
    if (step === 'welcome' && signedIn && accountSettled) useSetupWizard.getState().hide();
  }, [step, signedIn, accountSettled]);
  const signInError = useAccount((s) => s.error);

  const index = STEPS.findIndex((s) => s.id === step);
  const loadBrands = async () => {
    setLoadingBrands(true);
    try {
      await useSlicer.getState().loadVendors(printers);
      return true;
    } catch (e) {
      setError(t('setupWizard.couldNotLoad', { error: (e as Error).message }));
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
      title={t('setupWizard.title')}
      onClose={onClose}
      className={step === 'welcome' ? 'wizard welcome' : 'wizard'}
      footer={
        step === 'welcome' ? undefined : (
        <>
          <button className="secondary wizard-later" onClick={onClose}>
            {t('setupWizard.notNow')}
          </button>
          {(index > 0 || (step === 'engine' && canSignIn && openedOnWelcome)) && (
            <button className="secondary" onClick={() => setStep(index > 0 ? STEPS[index - 1].id : 'welcome')}>
              {t('setupWizard.back')}
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
              {t('setupWizard.addConnection')}
            </button>
          )}
          {step === 'connect' ? (
            <button className="primary" disabled={saving || !printers.length} onClick={() => void finish()}>
              {t('setupWizard.finish')}
            </button>
          ) : (
            <button
              className="primary"
              disabled={step === 'printers' ? !printers.length || loadingBrands : step === 'filaments' && !filaments?.length}
              onClick={() => void next()}
            >
              {t('setupWizard.next')}
            </button>
          )}
        </>
        )
      }
    >
      {step !== 'welcome' && (
        <>
          <p className="wizard-step-now">
            {t('setupWizard.stepOf', { n: index + 1, total: STEPS.length, label: t(STEPS[index].label) })}
          </p>
          <ol className="wizard-steps">
            {STEPS.map((s, i) => (
              <li key={s.id} className={i === index ? 'on' : i < index ? 'done' : ''}>
                {t(s.label)}
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="wizard-body">
        {step === 'welcome' && <WelcomeStep error={signInError} onSetup={() => setStep('engine')} />}
        {step === 'engine' && <EngineStep chosen={engine} onChange={setEngine} />}
        {step === 'printers' && <PrinterStep all={allPrinters} chosen={printers} onChange={setPrinters} />}
        {step === 'printers' && loadingBrands && <p className="muted small">{t('setupWizard.loadingProfiles')}</p>}
        {step === 'filaments' && <FilamentStep printers={printers} chosen={filaments} onLoad={setFilaments} onChange={setFilaments} />}
        {step === 'connect' && <ConnectStep />}
      </div>
      {error && <p className="hint warn">{error}</p>}
    </Dialog>
  );
}

/**
 * Before the numbered steps, signed out: someone who already has an account
 * signs in and gets their printers, filaments, presets and projects, instead of
 * picking them all again (desktop Orca and Bambu Studio offer sign-in on their
 * first page too). Choices made here while signed out move to the account later.
 */
function WelcomeStep({ error, onSetup }: { error: string; onSetup: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="welcome-page">
      <div className="welcome-art" aria-hidden>
        <img src="/welcome/devices-print.svg" alt="" />
      </div>
      <div className="welcome-side">
        <img src="/icon.svg" alt="" className="welcome-logo" />
        <h3>{t('setupWizard.welcomeTitle')}</h3>
        <p className="muted">{t('setupWizard.welcomeText')}</p>
        <button className="google-button" onClick={() => void useAccount.getState().signIn('google')}>
          <GoogleMark />
          {t('setupWizard.signInGoogle')}
        </button>
        {error && <Note tone="error">{error}</Note>}
        <div className="welcome-or">{t('setupWizard.or')}</div>
        <button className="secondary welcome-wide" onClick={onSetup}>
          {t('setupWizard.continueWithout')}
        </button>
      </div>
    </div>
  );
}

type Tab = 'printers' | 'filaments' | 'engine';
const TABS: { id: Tab; label: string; short?: string }[] = [
  { id: 'printers', label: 'setupWizard.printers' },
  { id: 'filaments', label: 'setupWizard.filaments' },
  { id: 'engine', label: 'setupWizard.defaultEngine', short: 'setupWizard.engineShort' },
];

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Changing your printers, filaments or default engine once setup is done: the
 * wizard's pages as tabs, saved together. Connect is left out (the Device tab
 * adds printer connections). Closing with changes asks first.
 */
function Manage({ tab: firstTab, onClose }: { tab: Tab; onClose: () => void }) {
  const { t } = useTranslation();
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
    if (changed && !(await ask({ title: t('setupWizard.discardTitle'), text: t('setupWizard.discardText'), action: t('setupWizard.discardAction') })))
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
      setError(t('setupWizard.couldNotSave', { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title={t('setupWizard.manageTitle')}
      onClose={() => void close()}
      className="manage"
      footer={
        <>
          {error && <Note tone="error" className="manage-error">{error}</Note>}
          <button className="secondary" onClick={() => void close()}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={saving || !changed || !printers.length || !filaments.length} onClick={() => void save()}>
            {saving ? t('setupWizard.saving') : t('setupWizard.save')}
          </button>
        </>
      }
    >
      <div className="line-tabs manage-tabs" role="tablist" aria-label={t('setupWizard.manageTitle')}>
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} aria-label={t(x.label)} onClick={() => setTab(x.id)}>
            <span className="manage-tab-long">{t(x.label)}</span>
            {x.short && <span className="manage-tab-short">{t(x.short)}</span>}
          </button>
        ))}
      </div>
      <div className="manage-body" role="tabpanel" aria-label={t(TABS.find((x) => x.id === tab)?.label ?? '')}>
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
            <p className="muted">{t('setupWizard.pickPrinterFirst')}</p>
          ))}
        {tab === 'engine' && <EngineStep chosen={engine} onChange={setEngine} heading={false} />}
      </div>
    </Dialog>
  );
}

function EngineStep({ chosen, onChange, heading = true }: { chosen: EngineFlavor; onChange: (engine: EngineFlavor) => void; heading?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {heading && <h3 className="wizard-engine-title">{t('setupWizard.defaultEngine')}</h3>}
      <p className="muted small">{t('setupWizard.engineExplain')}</p>
      <div className="wizard-engines" role="radiogroup" aria-label={t('setupWizard.slicingEngine')}>
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
  const { t } = useTranslation();
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
          <h3 className="manage-label">{t('setupWizard.yourPrinters')}</h3>
          {chosen.length ? (
            <ul className="manage-mine">
              {chosen.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                  <IconButton icon={X} label={t('setupWizard.remove', { name })} onClick={() => toggle(name)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('setupWizard.noPrinters')}</p>
          )}
          <h3 className="manage-label">{t('setupWizard.addPrinter')}</h3>
        </>
      )}
      <p className="muted small" hidden={manage}>
        {t('setupWizard.printersIntro')} <SendMark /> {t('setupWizard.printersIntroAfter')}
      </p>
      <div className="wizard-filters">
        <input type="search" placeholder={t('setupWizard.searchPrinters')} aria-label={t('setupWizard.searchPrinters')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={sendOnly} onChange={(e) => setSendOnly(e.target.checked)} />
          <span>{t('setupWizard.onlyDirect')}</span>
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
                  {picked ? t('setupWizard.nOfM', { n: picked, m: b.models.length }) : t('setupWizard.printerCount', { count: b.models.length })}
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
                      <span className="chips" role="group" aria-label={t('setupWizard.nozzles', { model: m.model })}>
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
        {!shown.length && <p className="muted">{t('setupWizard.noPrinterMatch', { query: q })}</p>}
      </div>
      {!manage && (
        <p className="muted small">
          {t('setupWizard.profilesSelected', { count: chosen.length })}
        </p>
      )}
    </>
  );
}

/** The "Direct print" mark: the app can send prints to this printer and start them (it runs Klipper, or the bridge reaches it another way: Prusa, Elegoo Centauri Carbon, Bambu Lab). */
export function SendMark() {
  const { t } = useTranslation();
  return (
    <span className="send-mark" title={t('setupWizard.directTip')}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M2 8.5 14 2l-3.5 12-2.7-4.3L2 8.5Zm5.8 1.2 1.6 2.6L11.6 5 7.8 9.7Z" fill="currentColor" />
      </svg>
      {t('setupWizard.direct')}
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
  const { t } = useTranslation();
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
  if (!list) return <p className="muted">{t('setupWizard.findingFilaments')}</p>;
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
      <p className="muted small">{t('setupWizard.pickFilaments')}</p>
      <div className="wizard-filters">
        <input type="search" placeholder={t('setupWizard.searchFilaments')} aria-label={t('setupWizard.searchFilaments')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Picker
          field
          label={t('setupWizard.material')}
          value={type}
          options={[{ value: '', label: t('setupWizard.allMaterials') }, ...types.map((m) => ({ value: m, label: m === 'Other' ? t('setupWizard.otherMaterial') : m }))]}
          onChange={setType}
        />
      </div>
      <div className="wizard-filaments">
        {groups.map((g) => {
          const names = g.rows.flatMap((r) => r.names);
          const on = (r: FilamentRow) => r.names.some((n) => picked.has(n));
          const count = g.rows.filter(on).length;
          return (
            <details key={g.vendor} open={groups.length <= 3 || count > 0 || !!q}>
              <summary>
                {g.vendor} <span className="muted small">{count ? t('setupWizard.nOfM', { n: count, m: g.rows.length }) : g.rows.length}</span>
              </summary>
              <button className="quiet" onClick={() => set(names, count < g.rows.length)}>
                {count < g.rows.length ? t('setupWizard.selectAll') : t('setupWizard.selectNone')}
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
        {t('setupWizard.filamentsSelected', { count: chosenRows })}
      </p>
    </>
  );
}

function ConnectStep() {
  const { t } = useTranslation();
  // Bridges are saved alongside printers; only the printers are listed here.
  const devices = useDevices().filter((d) => d.extra?.kind !== 'bridge-agent');
  return (
    <>
      <p className="muted small">
        {t('setupWizard.connectExplain')}
      </p>
      {devices.length > 0 ? (
        <ul className="wizard-devices">
          {devices.map((d) => (
            <li key={d.id}>
              <b>{d.name}</b> <span className="muted small">{d.preset || t('setupWizard.noProfileYet')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('setupWizard.noConnections')}</p>
      )}
    </>
  );
}
