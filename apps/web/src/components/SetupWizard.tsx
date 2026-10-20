import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { PresetSummary } from '../engine/protocol';
import { ENGINES, type EngineFlavor } from '../lib/engines';
import { shortName } from '../lib/presets';
import { coverUrl } from '../lib/printer-catalog';
import { filamentGroups, matchModels, SETUP_KEY, wizardBrands, type Setup } from '../lib/setup';
import { saveUserSetting, useAccount, useDevices, useUserSetting } from '../state/account';
import { useDevice } from '../state/device';
import { useSlicer } from '../state/store';

/** Opens the wizard from anywhere (e.g. "Manage" next to the printer picker). */
export const useSetupWizard = create<{ open: boolean; show(): void; hide(): void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

// Closed this visit, or the visit started from a printer pairing link (the
// Device tab's add-printer dialog is waiting).
let dismissed = typeof location !== 'undefined' && location.hash.startsWith('#pair=');

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
 * follow the account.
 */
export function SetupWizard() {
  const { open, show, hide } = useSetupWizard();
  const ready = useSlicer((s) => s.engine === 'ready');
  const accountReady = useAccount((s) => s.status !== 'loading');
  const installedPrinters = useUserSetting<Setup>(SETUP_KEY)?.printers;
  useEffect(() => {
    if (ready && accountReady && !installedPrinters?.length && !dismissed) show();
  }, [ready, accountReady, installedPrinters, show]);
  if (!open || !ready) return null;
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
  const current = useSlicer((s) => s.selection);
  const savedPrinters = useUserSetting<Setup>(SETUP_KEY)?.printers;
  const savedFilaments = useUserSetting<Setup>(SETUP_KEY)?.filaments;
  const savedEngine = useUserSetting<Setup>(SETUP_KEY)?.engine;
  const running = useSlicer((s) => s.flavor);
  const [step, setStep] = useState<Step>('engine');
  const [engine, setEngine] = useState<EngineFlavor>(savedEngine ?? running);
  const [printers, setPrinters] = useState<string[]>(() => (savedPrinters?.length ? savedPrinters : current ? [current.printer] : []));
  const [filaments, setFilaments] = useState<string[] | null>(savedFilaments?.length ? savedFilaments : null);
  const [saving, setSaving] = useState(false);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [error, setError] = useState('');

  const finish = async (then?: () => void) => {
    setSaving(true);
    setError('');
    try {
      const before = useSlicer.getState().flavor;
      // An empty first project switches to the chosen engine by itself (state/projects.ts).
      await saveUserSetting<Setup>(SETUP_KEY, { printers, filaments: filaments ?? [], engine });
      const s = useSlicer.getState();
      if (s.flavor === before && s.selection && !printers.includes(s.selection.printer)) await s.selectPrinter(printers[0]);
      onClose();
      then?.();
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const index = STEPS.findIndex((s) => s.id === step);
  const next = async () => {
    setError('');
    // The filament page asks the engine, which loads a brand's presets only once one of its printers is picked.
    if (step === 'printers') {
      setLoadingBrands(true);
      try {
        await useSlicer.getState().loadVendors(printers);
      } catch (e) {
        setError(`Could not load the printer profiles: ${(e as Error).message}`);
        return;
      } finally {
        setLoadingBrands(false);
      }
    }
    setStep(STEPS[index + 1].id);
  };
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <h2 id="wizard-title">Set up your printers</h2>
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
          {step === 'filaments' && <FilamentStep printers={printers} chosen={filaments} onChange={setFilaments} />}
          {step === 'connect' && <ConnectStep />}
        </div>
        {error && <p className="hint warn">{error}</p>}
        <div className="dialog-actions">
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
        </div>
      </div>
    </div>
  );
}

function EngineStep({ chosen, onChange }: { chosen: EngineFlavor; onChange: (engine: EngineFlavor) => void }) {
  return (
    <>
      <h3 className="wizard-engine-title">Default engine</h3>
      <p className="muted small">
        New projects start with this engine. You can still pick the other one for any project: use Slicer engine above the printer. A project you open uses the
        engine it was made with.
      </p>
      <div className="wizard-engines" role="radiogroup" aria-label="Slicing engine">
        {ENGINES.map((e) => (
          <button key={e.id} role="radio" aria-label={e.name} aria-checked={chosen === e.id} className={chosen === e.id ? 'wizard-engine on' : 'wizard-engine'} onClick={() => onChange(e.id)}>
            <b>{e.name}</b>
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

function PrinterStep({ all, chosen, onChange }: { all: PresetSummary[]; chosen: string[]; onChange: (names: string[]) => void }) {
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
      <p className="muted small">
        Pick each printer you have and its nozzle sizes in mm (you can change this later with Manage). Every printer slices here; <SendMark /> marks the ones this app can
        also send prints to and start (Klipper printers). For the others you download the G-code.
      </p>
      <div className="wizard-filters">
        <input type="search" placeholder="Search printers" aria-label="Search printers" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check small">
          <input type="checkbox" checked={sendOnly} onChange={(e) => setSendOnly(e.target.checked)} />
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
                      <span className="segmented" role="group" aria-label={`${m.model} nozzles`}>
                        {m.nozzles.map((n) => (
                          <button key={n.name} className={chosen.includes(n.name) ? 'on' : ''} aria-pressed={chosen.includes(n.name)} onClick={() => toggle(n.name)}>
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
      <p className="muted small">
        {chosen.length} printer profile{chosen.length === 1 ? '' : 's'} selected.
      </p>
    </>
  );
}

/** The "Direct print" mark: the app can send prints to this printer and start them (it runs Klipper). */
export function SendMark() {
  return (
    <span className="send-mark" title="Direct print: this app sends prints to it and starts them from the Device tab (Klipper with Moonraker)">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M2 8.5 14 2l-3.5 12-2.7-4.3L2 8.5Zm5.8 1.2 1.6 2.6L11.6 5 7.8 9.7Z" fill="currentColor" />
      </svg>
      Direct print
    </span>
  );
}

function FilamentStep({ printers, chosen, onChange }: { printers: string[]; chosen: string[] | null; onChange: (names: string[]) => void }) {
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
        const kept = chosen?.filter((n) => names.has(n)) ?? [];
        // The Snapmaker profiles name no default materials for the wizard, so
        // start from the printers' default filaments plus the maker's own.
        const vendors = new Set(useSlicer.getState().printers.filter((p) => printers.includes(p.name)).map((p) => p.vendor));
        const brand = [...byName.values()].filter((f) => f.system && vendors.has(f.filamentVendor ?? '')).map((f) => f.name);
        onChange(kept.length ? kept : [...new Set([...results.flatMap((r) => r.defaults), ...brand])]);
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
  const set = (names: string[], on: boolean) => onChange(on ? [...new Set([...picked, ...names])] : [...picked].filter((n) => !names.includes(n)));
  return (
    <>
      <p className="muted small">Pick the filaments you use. The filament pickers will offer only these.</p>
      <div className="wizard-filters">
        <input type="search" placeholder="Search filaments" aria-label="Search filaments" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Material" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All materials</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="wizard-filaments">
        {groups.map((g) => {
          const names = g.filaments.map((f) => f.name);
          const count = names.filter((n) => picked.has(n)).length;
          return (
            <details key={g.vendor} open={groups.length <= 3 || count > 0 || !!q}>
              <summary>
                {g.vendor} <span className="muted small">{count ? `${count} of ${names.length}` : names.length}</span>
              </summary>
              <button className="link small" onClick={() => set(names, count < names.length)}>
                {count < names.length ? 'Select all' : 'Select none'}
              </button>
              <ul>
                {g.filaments.map((f) => (
                  <li key={f.name}>
                    <label className="check">
                      <input type="checkbox" checked={picked.has(f.name)} onChange={(e) => set([f.name], e.target.checked)} />
                      <span>{shortName(f.name)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      <p className="muted small">
        {picked.size} filament{picked.size === 1 ? '' : 's'} selected.
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
