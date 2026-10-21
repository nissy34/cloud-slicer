import { useEffect, useState } from 'react';
import { installedOnly, installedPrinters, SETUP_KEY, type Setup } from '../../lib/setup';
import { useUserSetting } from '../../state/account';
import { bridgeLabel, useDevice, type SavedPrinter } from '../../state/device';
import { useSlicer } from '../../state/store';
import { DEFAULT_RELAY_URL } from '../config';
import { BridgeLink } from '../link/bridge';
import { DirectLink, directBlockedReason, normalizePrinterUrl } from '../link/direct';
import type { BridgeStatus } from '../link/types';
import { decodePairing, type Pairing } from '../pairing';
import { BridgeSetup, CopyCommand } from './BridgeSetup';
import { Dialog } from './parts';

const newId = () => Math.random().toString(36).slice(2, 10);

/** Which printer profile this machine prints with: one of the installed printers. */
function PresetField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const all = useSlicer((s) => s.printers);
  const installed = installedPrinters(useUserSetting<Setup>(SETUP_KEY), useSlicer((s) => s.flavor));
  const printers = installedOnly(all, installed, value);
  return (
    <label>
      Printer profile
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Printer profile">
        {!printers.some((p) => p.name === value) && <option value={value}>{value || 'Choose a printer profile'}</option>}
        {printers.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Watches a bridge's status (which printers it serves, whether it's online)
 * until stopped, reconnecting every few seconds. The bridge app opens the
 * pairing link as it starts, so the page often asks before the bridge has
 * connected (the relay refuses browsers until then, or reports it offline).
 */
export interface BridgeWatch {
  stop(): void;
  /** Asks the bridge itself to do something (add or remove a printer), over the watching connection. */
  manage<T>(method: `bridge.${string}`, params: unknown): Promise<T>;
}

/** How many searches in a row may find nothing before the Device tab stops looking by itself. */
const AUTO_SEARCHES = 8;

/** Bridges from this version on can add and remove printers when the Device tab asks. */
export const MANAGED_FROM = 3;
/** Bridges from this version on uninstall themselves when the Device tab removes them. */
export const SELF_REMOVING_FROM = 5;

export function watchBridge(p: Pairing, onStatus: (s: BridgeStatus) => void, onError: (e: Error) => void): BridgeWatch {
  let stopped = false;
  let link: BridgeLink | null = null;
  let open: BridgeLink | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let lastError = 'The bridge did not answer.';
  // A bridge that is just starting is refused or offline for a moment: only say so if it lasts.
  const slow = setTimeout(() => !stopped && onError(new Error(lastError)), 10_000);
  const again = (reason?: string) => {
    if (reason) lastError = reason;
    if (!stopped && retry === undefined) retry = setTimeout(connect, 3000);
  };
  function connect() {
    retry = undefined;
    if (stopped) return;
    const l = new BridgeLink({ relay: p.relay, bridgeId: p.bridgeId, key: p.key, printer: '' });
    link = l;
    l.open({
      onMessage: () => {},
      onClose: (reason) => {
        if (open === l) open = null;
        again(reason);
      },
      onBridge: (status) => {
        if (status.agent === 'online') clearTimeout(slow);
        onStatus(status);
      },
    }).then(
      () => {
        if (link === l) open = l;
      },
      (e) => again((e as Error).message),
    );
  }
  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(slow);
      clearTimeout(retry);
      link?.close();
    },
    manage(method, params) {
      return open ? open.manage(method, params) : Promise.reject(new Error('The bridge is not connected right now. Check that it is running.'));
    },
  };
}

/** Removes a printer from its bridge, if the bridge is reachable; the saved printer goes either way. */
export async function removeFromBridge(p: Pairing, printer: string): Promise<void> {
  const link = new BridgeLink({ relay: p.relay, bridgeId: p.bridgeId, key: p.key, printer: '' });
  try {
    await link.open({ onMessage: () => {}, onClose: () => {} });
    await link.manage('bridge.remove_printer', { id: printer });
  } catch {
    // An offline or older bridge keeps the printer; it can be removed there with the remove command.
  } finally {
    link.close();
  }
}

interface FoundPrinter {
  url: string;
  name: string;
  needsKey: boolean;
  /** The bridge's id for it when it's already added. */
  added: string | null;
}

/** One printer the bridge found: add it, with its API key when Moonraker wants one. */
function FoundRow({ printer, watch, onAdded }: { printer: FoundPrinter; watch: BridgeWatch | null; onAdded: (p: { id: string; name: string }) => void }) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const add = async () => {
    if (!watch) return;
    setBusy(true);
    setProblem('');
    try {
      onAdded(await watch.manage<{ id: string; name: string }>('bridge.add_printer', { address: printer.url, apiKey: apiKey.trim() }));
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const host = printer.url.replace(/^https?:\/\//, '');
  return (
    <li className="dv-found" data-testid="found-printer" data-url={printer.url}>
      <div className="dv-found-head">
        <span>
          {printer.name === host.split(':')[0] ? (
            <strong>{host}</strong>
          ) : (
            <>
              <strong>{printer.name}</strong> <span className="muted">{host}</span>
            </>
          )}
        </span>
        {printer.added ? (
          <span className="dv-added">✓ Added</span>
        ) : (
          <button className="primary" disabled={busy || (printer.needsKey && !apiKey.trim())} onClick={() => void add()} data-testid="found-add">
            {busy ? 'Adding…' : 'Add this printer'}
          </button>
        )}
      </div>
      {!printer.added && printer.needsKey && (
        <label>
          <span className="muted">This printer is locked with an API key. Type it here first (Mainsail and Fluidd show it in their settings):</span>
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" spellCheck={false} autoCapitalize="off" autoComplete="off" data-testid="found-key" />
        </label>
      )}
      {problem && (
        <p className="dv-alert" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

/**
 * Searching the bridge's network. A Mac blocks the first search until its
 * "find devices on your local network" prompt is allowed, so a search that
 * finds nothing goes again by itself a few times.
 */
function useBridgeSearch(watch: BridgeWatch | null, searchNow: boolean) {
  const [found, setFound] = useState<FoundPrinter[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Searches in a row that found nothing.
  const [tries, setTries] = useState(0);
  const [problem, setProblem] = useState('');
  const search = async (again = false) => {
    if (!watch) return;
    setSearching(true);
    setProblem('');
    if (!again) setTries(0);
    try {
      const list = (await watch.manage<{ printers: FoundPrinter[] }>('bridge.discover', {})).printers;
      setFound(list);
      setTries((t) => (list.length ? 0 : t + 1));
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const keepLooking = found !== null && !found.length && !problem && tries > 0 && tries < AUTO_SEARCHES;
  useEffect(() => {
    if (!keepLooking || searching) return;
    const t = setTimeout(() => void search(true), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepLooking, searching, tries]);
  // A bridge with no printers yet: look straight away.
  useEffect(() => {
    if (searchNow && watch && found === null && !searching) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchNow, watch]);
  return { found, setFound, searching, looking: searching || keepLooking, tries, problem, search };
}

/** The heading with Search again, and what the search is doing: looking (with the Allow hint), failed, or found nothing. */
function SearchStatus({ s, watch, system, title }: { s: ReturnType<typeof useBridgeSearch>; watch: BridgeWatch | null; system?: string; title: string }) {
  const allowHint =
    system === 'darwin'
      ? 'If your Mac asks whether the bridge may find devices on your local network, click Allow there. The search carries on by itself.'
      : 'If the bridge’s computer asks whether the bridge may find devices on your network, allow it there. The search carries on by itself.';
  return (
    <>
      <div className="dv-found-head">
        <strong>{title}</strong>
        {!s.looking && (
          <button className="secondary" disabled={!watch} onClick={() => void s.search()} data-testid="bridge-search">
            {s.found ? 'Search again' : 'Search my network'}
          </button>
        )}
      </div>
      {s.looking && (
        <div className="dv-searching" role="status" data-testid="bridge-searching">
          <span className="dv-spinner" aria-hidden />
          <div>
            <strong>Looking for printers on your network…</strong>
            <span className="muted">{s.tries > 0 || system === 'darwin' ? allowHint : 'This takes a few seconds.'}</span>
          </div>
        </div>
      )}
      {s.problem && (
        <p className="dv-alert" role="alert">
          {s.problem}
        </p>
      )}
      {s.found && !s.looking && !s.found.length && (
        <p className="dv-alert">No printer found. Check that the printer is switched on and on the same network as the bridge's computer, then search again, or add it by its address below.</p>
      )}
    </>
  );
}

/** Adds a printer to the bridge by its address (any port), for when the search doesn't find it. */
function AddByAddress({ watch, onAdded }: { watch: BridgeWatch | null; onAdded: (p: { id: string; name: string }) => void }) {
  const [address, setAddress] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState('');
  const add = async () => {
    if (!watch) return;
    setAdding(true);
    setProblem('');
    try {
      onAdded(await watch.manage<{ id: string; name: string }>('bridge.add_printer', { address: address.trim(), apiKey: apiKey.trim() }));
      setAddress('');
      setApiKey('');
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setAdding(false);
    }
  };
  return (
    <details className="dv-node-option" data-testid="bridge-add-printer">
      <summary>Printer not found? Add it by its address</summary>
      <div className="dv-form">
        <label>
          Printer address
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="for example 192.168.1.50, or 192.168.1.50:7130 for another port" spellCheck={false} autoCapitalize="off" data-testid="bridge-new-address" />
        </label>
        <label>
          Moonraker API key <span className="muted">(only if the printer asks for one)</span>
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} spellCheck={false} autoCapitalize="off" autoComplete="off" data-testid="bridge-new-key" />
        </label>
        {problem && (
          <p className="dv-alert" role="alert">
            {problem}
          </p>
        )}
        <div>
          <button className="secondary" disabled={!address.trim() || adding} onClick={() => void add()} data-testid="bridge-add-submit">
            {adding ? 'Checking…' : 'Find this printer'}
          </button>
        </div>
      </div>
    </details>
  );
}

/**
 * Editing a saved bridge printer: search the bridge's network and add
 * printers to the bridge (with their API keys), or add one by its address.
 */
function BridgePrinters({ watch, onAdded, searchNow, system }: { watch: BridgeWatch | null; onAdded: (p: { id: string; name: string }) => void; searchNow: boolean; system?: string }) {
  const s = useBridgeSearch(watch, searchNow);
  const added = (p: { id: string; name: string }, url?: string) => {
    if (url) s.setFound((list) => list?.map((f) => (f.url === url ? { ...f, added: p.id } : f)) ?? null);
    onAdded(p);
  };
  return (
    <div className="dv-bridge-printers" data-testid="bridge-printers">
      <SearchStatus s={s} watch={watch} system={system} title="Printers on your network" />
      {s.found && s.found.length > 0 && !s.searching && (
        <ul className="dv-found-list">
          {s.found.map((f) => (
            <FoundRow key={f.url} printer={f} watch={watch} onAdded={(p) => added(p, f.url)} />
          ))}
        </ul>
      )}
      <AddByAddress watch={watch} onAdded={(p) => added(p)} />
      <p className="muted">API keys go to the bridge, which keeps them on its computer; Cloud Slicer doesn't store them.</p>
    </div>
  );
}

/** One printer in the add list: on the bridge already (bridgeId), or found on the network (url) and added to the bridge when saved. */
export interface AddRow {
  key: string;
  bridgeId: string | null;
  url: string | null;
  host: string;
  needsKey: boolean;
  /** Already a saved printer in Cloud Slicer. */
  saved: boolean;
  /** idle: not chosen; editing: its name, profile and key are open; ready: checked and waiting for the button below. */
  step: 'idle' | 'editing' | 'ready';
  busy: boolean;
  name: string;
  preset: string;
  apiKey: string;
  problem: string;
}

/** Merges what the bridge serves and what the search found into the add list, keeping what the user typed. */
export function mergeAddRows(
  rows: AddRow[],
  bridgePrinters: { id: string; name: string }[],
  found: FoundPrinter[] | null,
  isSaved: (bridgeId: string) => boolean,
  preset: string,
): AddRow[] {
  const next = [...rows];
  const byBridge = (id: string) => next.find((r) => r.bridgeId === id);
  const blank = (r: Pick<AddRow, 'key' | 'bridgeId' | 'url' | 'host' | 'needsKey' | 'name'>): AddRow => {
    const saved = r.bridgeId ? isSaved(r.bridgeId) : false;
    return { ...r, saved, step: 'idle', busy: false, preset, apiKey: '', problem: '' };
  };
  for (const p of bridgePrinters) {
    if (!byBridge(p.id)) next.push(blank({ key: `b:${p.id}`, bridgeId: p.id, url: null, host: '', needsKey: false, name: p.name }));
  }
  for (const f of found ?? []) {
    const host = f.url.replace(/^https?:\/\//, '');
    const name = f.name === host.split(':')[0] ? '' : f.name;
    const mine = f.added ? byBridge(f.added) : next.find((r) => r.url === f.url);
    if (mine) {
      const i = next.indexOf(mine);
      next[i] = { ...mine, url: f.url, host, needsKey: !f.added && f.needsKey, name: mine.name || name };
    } else next.push(blank({ key: f.added ? `b:${f.added}` : `u:${f.url}`, bridgeId: f.added, url: f.url, host, needsKey: !f.added && f.needsKey, name }));
  }
  return next;
}

/**
 * Adding printers from a paired bridge: one list of every printer it serves
 * or found, each with its own name, printer profile and API key, and one
 * button below that adds all the ticked ones.
 */
function BridgeAddList({
  rows,
  setRows,
  watch,
  searchNow,
  system,
  isSaved,
}: {
  rows: AddRow[];
  setRows: (f: (rows: AddRow[]) => AddRow[]) => void;
  watch: BridgeWatch | null;
  searchNow: boolean;
  system?: string;
  isSaved: (bridgeId: string) => boolean;
}) {
  const s = useBridgeSearch(watch, searchNow);
  const found = s.found;
  const preset = useSlicer((st) => st.selection?.printer ?? '');
  useEffect(() => {
    if (found) setRows((r) => mergeAddRows(r, [], found, isSaved, preset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);
  const edit = (key: string, change: Partial<AddRow>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, problem: '', ...change } : r)));
  /** Checks one printer before it joins the ones to add: a profile, and the API key (by adding it to the bridge, which tries it). */
  const confirm = async (r: AddRow) => {
    if (!r.preset && useSlicer.getState().printers.length) return edit(r.key, { problem: 'Choose its printer profile.' });
    if (r.bridgeId) return edit(r.key, { step: 'ready' });
    if (r.needsKey && !r.apiKey.trim()) return edit(r.key, { problem: 'Type its API key first.' });
    if (!watch) return;
    edit(r.key, { busy: true });
    try {
      const res = await watch.manage<{ id: string; name: string }>('bridge.add_printer', { address: r.url, apiKey: r.apiKey.trim(), ...(r.name.trim() && { name: r.name.trim() }) });
      // The bridge's status may already list it as a row of its own: keep this one.
      setRows((list) => list.filter((x) => x.key === r.key || x.bridgeId !== res.id).map((x) => (x.key === r.key ? { ...x, bridgeId: res.id, needsKey: false, busy: false, step: 'ready' } : x)));
    } catch (e) {
      edit(r.key, { busy: false, problem: (e as Error).message });
    }
  };
  const shown = rows.filter((r) => !r.saved);
  const savedRows = rows.filter((r) => r.saved);
  const title = (r: AddRow) => (
    <span>
      <strong>{r.name || r.host}</strong> {r.name && r.host && <span className="muted">{r.host}</span>}
    </span>
  );
  return (
    <div className="dv-bridge-printers" data-testid="bridge-printers">
      <SearchStatus s={s} watch={watch} system={system} title="Your printers" />
      {shown.length > 0 && (
        <>
          <span className="muted">Click Add on each printer you want. When they're ready, the button at the bottom adds them all.</span>
          <ul className="dv-found-list">
            {shown.map((r) => (
              <li key={r.key} className={`dv-found dv-add-row ${r.step}`} data-testid="add-row" data-step={r.step} data-url={r.url ?? ''} data-bridge-id={r.bridgeId ?? ''}>
                <div className="dv-found-head">
                  {r.step === 'ready' ? (
                    <span>
                      <span className="dv-added">✓</span> <strong>{r.name || r.host}</strong> <span className="muted">{r.preset}</span>
                    </span>
                  ) : (
                    title(r)
                  )}
                  {r.step === 'idle' && (
                    <button className="primary" onClick={() => edit(r.key, { step: 'editing' })} data-testid="add-row-add">
                      Add
                    </button>
                  )}
                  {r.step === 'ready' && (
                    <span className="dv-row-actions">
                      <button className="dv-link" onClick={() => edit(r.key, { step: 'editing' })}>
                        Change
                      </button>
                      <button className="dv-link" onClick={() => edit(r.key, { step: 'idle' })} data-testid="add-row-drop">
                        Don't add
                      </button>
                    </span>
                  )}
                </div>
                {r.step === 'editing' && (
                  <>
                    <div className="dv-add-fields">
                      <label>
                        Name
                        <input value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} placeholder={r.host || 'My printer'} data-testid="add-row-name" />
                      </label>
                      <PresetField value={r.preset} onChange={(p) => edit(r.key, { preset: p })} />
                      {r.needsKey && (
                        <label className="dv-add-key">
                          API key
                          <input value={r.apiKey} onChange={(e) => edit(r.key, { apiKey: e.target.value })} placeholder="This printer is locked: type its API key" spellCheck={false} autoCapitalize="off" autoComplete="off" data-testid="add-row-key" />
                          <span className="muted">Mainsail and Fluidd show it in their settings. It goes to the bridge, not to Cloud Slicer.</span>
                        </label>
                      )}
                    </div>
                    {r.problem && (
                      <p className="dv-alert" role="alert">
                        {r.problem}
                      </p>
                    )}
                    <div className="dv-row-buttons">
                      <button className="secondary" onClick={() => edit(r.key, { step: 'idle' })}>
                        Cancel
                      </button>
                      <button className="primary" disabled={r.busy} onClick={() => void confirm(r)} data-testid="add-row-done">
                        {r.busy ? 'Checking…' : 'Done'}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {savedRows.length > 0 && <span className="muted">Already in Cloud Slicer: {savedRows.map((r) => r.name || r.host).join(', ')}.</span>}
      <AddByAddress
        watch={watch}
        onAdded={(p) =>
          setRows((list) =>
            list.some((r) => r.bridgeId === p.id)
              ? list.map((r) => (r.bridgeId === p.id ? { ...r, step: 'editing', saved: false } : r))
              : [...list, { key: `b:${p.id}`, bridgeId: p.id, url: null, host: '', needsKey: false, saved: false, step: 'editing', busy: false, name: p.name, preset, apiKey: '', problem: '' }],
          )
        }
      />
    </div>
  );
}

/**
 * Where the pairing stands. Reaching a bridge that is just starting takes a few
 * seconds through the relay, so "connecting" is shown plainly until it answers;
 * a problem only shows once it has stayed away a while, and it keeps trying.
 */
function BridgeState({ bridge, problem, onDifferent }: { bridge: BridgeStatus | null; problem: string; onDifferent?: () => void }) {
  const online = bridge?.agent === 'online';
  const state = online ? 'online' : problem ? 'failed' : 'connecting';
  const different = onDifferent && (
    <button className="dv-link" onClick={onDifferent}>
      Use a different bridge
    </button>
  );
  return (
    <div className={`dv-bridge-state ${state}`} role="status" data-testid="bridge-state" data-state={state}>
      {state === 'connecting' && <span className="dv-spinner" aria-hidden />}
      {state === 'online' && (
        <span className="dv-bridge-state-icon" aria-hidden>
          ✓
        </span>
      )}
      {state === 'failed' && (
        <span className="dv-bridge-state-icon" aria-hidden>
          !
        </span>
      )}
      <div>
        {state === 'connecting' && (
          <>
            <strong>Connecting to the bridge…</strong>
            <span className="muted">This takes a few seconds, longer if the bridge has only just started.</span>
          </>
        )}
        {state === 'online' && (
          <>
            <strong>Connected to the bridge</strong>
            {bridgeLabel(bridge) !== 'Bridge' && <span className="muted">{bridgeLabel(bridge)}</span>}
          </>
        )}
        {state === 'failed' && (
          <>
            <strong>{bridge ? 'The bridge is offline' : "Can't reach the bridge"}</strong>
            <span className="muted">
              {bridge ? 'Start it on its computer.' : problem} Still trying: this changes by itself as soon as the bridge answers.
            </span>
          </>
        )}
        {different}
      </div>
    </div>
  );
}

/** Opens the printer's socket and asks Moonraker who it is. */
async function probeDirect(url: string, apiKey: string): Promise<string> {
  const link = new DirectLink(url, apiKey);
  let answer: (hostname: string) => void = () => {};
  const answered = new Promise<string>((resolve) => (answer = resolve));
  await link.open({
    onMessage: (m) => m.id === 1 && answer((m.result as { hostname?: string } | undefined)?.hostname ?? ''),
    onClose: () => {},
  });
  try {
    link.send({ jsonrpc: '2.0', id: 1, method: 'printer.info' });
    return await Promise.race([answered, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('The printer did not answer.')), 8000))]);
  } finally {
    link.close();
  }
}

export function PrinterEditor() {
  const editor = useDevice((s) => s.editor);
  const pairingFromLink = useDevice((s) => s.pairing);
  const { savePrinter, removePrinter, openEditor } = useDevice.getState();
  const existing = editor?.mode === 'edit' ? editor.printer : undefined;
  // Settings made elsewhere on the Device tab survive an edit.
  const keep = existing?.hiddenCameras?.length ? { hiddenCameras: existing.hiddenCameras } : {};
  const [kind, setKind] = useState<'bridge' | 'direct'>(existing?.kind ?? 'bridge');
  const [name, setName] = useState(existing?.name ?? '');
  const [preset, setPreset] = useState(() => existing?.preset ?? useSlicer.getState().selection?.printer ?? '');
  // bridge
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState<Pairing | null>(existing?.kind === 'bridge' ? { relay: existing.relay, bridgeId: existing.bridgeId, key: existing.key } : pairingFromLink);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [watch, setWatch] = useState<BridgeWatch | null>(null);
  const [printerId, setPrinterId] = useState(existing?.kind === 'bridge' ? existing.printer : '');
  // Why the bridge isn't reachable yet; only set once it has stayed away a while (it keeps trying).
  const [bridgeProblem, setBridgeProblem] = useState('');
  // direct
  const [url, setUrl] = useState(existing?.kind === 'direct' ? existing.url : '');
  const [apiKey, setApiKey] = useState(existing?.kind === 'direct' ? existing.apiKey : '');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const saved = useDevice((s) => s.printers);
  const savedBridges = useDevice((s) => s.bridges);
  // Adding from a paired bridge: every printer it serves or found, each with its own name and profile.
  const [rows, setRows] = useState<AddRow[]>([]);
  const [addingAll, setAddingAll] = useState(false);
  const isSaved = (printer: string) => !!pairing && saved.some((p) => p.kind === 'bridge' && p.bridgeId === pairing.bridgeId && p.printer === printer);
  const listMode = !existing && !!bridge && Number(bridge.version) >= MANAGED_FROM;
  useEffect(() => {
    if (bridge && !existing) setRows((r) => mergeAddRows(r, bridge.printers, null, isSaved, preset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  useEffect(() => {
    if (!pairing) return;
    setBridgeProblem('');
    const w = watchBridge(
      pairing,
      (b) => {
        if (b.agent === 'online') setBridgeProblem('');
        setBridge(b);
        if (b.printers[0]) {
          setPrinterId((id) => id || b.printers[0].id);
          setName((n) => n || b.printers[0].name);
        }
      },
      (e) => setBridgeProblem(e.message),
    );
    setWatch(w);
    return () => {
      w.stop();
      setWatch(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  if (!editor) return null;
  const close = () => void openEditor(null);
  const id = existing?.id ?? newId();

  const saveBridge = () => {
    if (!pairing || !printerId) return;
    void savePrinter({ id, kind: 'bridge', name: name.trim() || 'Printer', relay: pairing.relay, bridgeId: pairing.bridgeId, key: pairing.key, printer: printerId, ...(preset && { preset }), ...keep });
  };

  const chosen = rows.filter((r) => r.step === 'ready' && !r.saved && r.bridgeId);
  /** Saves every ready printer (each is on the bridge already), in the list's order, with the first one chosen on the Device tab. */
  const addAll = async () => {
    if (!pairing || !chosen.length) return;
    setAddingAll(true);
    // The bridge is saved on its own the first time, so it stays when its printers go.
    if (!savedBridges.some((b) => b.bridgeId === pairing.bridgeId)) await useDevice.getState().saveBridge({ id: newId(), name: bridgeLabel(bridge), ...pairing });
    const ids = chosen.map(() => newId());
    for (const [i, row] of chosen.entries()) {
      await savePrinter({ id: ids[i], kind: 'bridge', name: row.name.trim() || row.host || 'Printer', relay: pairing.relay, bridgeId: pairing.bridgeId, key: pairing.key, printer: row.bridgeId!, ...(row.preset && { preset: row.preset }) });
    }
    if (ids.length > 1) useDevice.getState().select(ids[0]);
  };

  const saveDirect = async () => {
    const u = normalizePrinterUrl(url);
    const blocked = directBlockedReason(u);
    if (blocked) {
      setError(blocked);
      return;
    }
    setChecking(true);
    setError('');
    try {
      const host = await probeDirect(u, apiKey.trim());
      const p: SavedPrinter = { id, kind: 'direct', name: name.trim() || host || new URL(u).host, url: u, apiKey: apiKey.trim(), ...(preset && { preset }), ...keep };
      void savePrinter(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const relayForCommand = pairing?.relay ?? DEFAULT_RELAY_URL;

  if (existing && confirmRemove) {
    return (
      <Dialog
        title={`Remove ${existing.name}?`}
        onClose={close}
        footer={
          <>
            <button className="secondary" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
            <button
              className="primary dv-danger"
              disabled={removing}
              onClick={async () => {
                setRemoving(true);
                // The bridge forgets the printer too, unless another saved printer still uses it.
                if (existing.kind === 'bridge' && !saved.some((p) => p.id !== existing.id && p.kind === 'bridge' && p.bridgeId === existing.bridgeId && p.printer === existing.printer)) {
                  await removeFromBridge({ relay: existing.relay, bridgeId: existing.bridgeId, key: existing.key }, existing.printer);
                }
                void removePrinter(existing.id);
              }}
              data-testid="confirm-remove-printer"
            >
              Remove printer
            </button>
          </>
        }
      >
        <div className="dv-form">
          <p>This removes {existing.name} from Cloud Slicer{existing.kind === 'bridge' ? ' and from its bridge' : ''}. The printer itself isn't changed.</p>
          {existing.kind === 'bridge' && <p className="muted">The bridge stays. To remove the bridge too, use Printers &amp; bridges.</p>}
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      title={existing ? `Edit ${existing.name}` : 'Add a printer'}
      onClose={close}
      wide
      footer={
        <>
          {existing && (
            <button className="secondary dv-danger-text dv-left" onClick={() => setConfirmRemove(true)} data-testid="remove-printer">
              Remove printer
            </button>
          )}
          {kind === 'bridge' && listMode && chosen.length > 0 && (
            <span className="muted dv-left dv-add-summary" data-testid="add-summary">
              {chosen.map((r) => r.name.trim() || r.host).join(', ')}
            </span>
          )}
          <button className="secondary" onClick={close}>
            Cancel
          </button>
          {kind === 'bridge' && listMode ? (
            <>
              <button className="primary" disabled={!chosen.length || addingAll} onClick={() => void addAll()} data-testid="save-printer">
                {addingAll ? 'Adding…' : chosen.length > 1 ? `Add ${chosen.length} printers` : 'Add printer'}
              </button>
            </>
          ) : kind === 'bridge' ? (
            pairing && (
              <button className="primary" disabled={!pairing || !printerId} onClick={saveBridge} data-testid="save-printer">
                {existing ? 'Save' : 'Add printer'}
              </button>
            )
          ) : (
            <button className="primary" disabled={!url.trim() || checking} onClick={() => void saveDirect()} data-testid="save-printer">
              {checking ? 'Checking…' : existing ? 'Save' : 'Add printer'}
            </button>
          )}
        </>
      }
    >
      {!existing && (
        <div className="dv-segmented" role="tablist" aria-label="How to reach the printer">
          <button role="tab" aria-selected={kind === 'bridge'} className={kind === 'bridge' ? 'on' : ''} onClick={() => setKind('bridge')}>
            At home (recommended)
          </button>
          <button role="tab" aria-selected={kind === 'direct'} className={kind === 'direct' ? 'on' : ''} onClick={() => setKind('direct')}>
            Over the internet (advanced)
          </button>
        </div>
      )}

      {kind === 'bridge' ? (
        <div className="dv-form">
          {!pairing && !existing && savedBridges.length > 0 && (
            <div className="dv-use-bridge" data-testid="use-saved-bridge">
              <strong>Add it through a bridge you already have</strong>
              {savedBridges.map((b) => (
                <button
                  key={b.id}
                  className="primary dv-big"
                  onClick={() =>
                    void useDevice
                      .getState()
                      .bridgePairing(b.id)
                      .then((p) => p && setPairing(p))
                  }
                  data-testid="use-bridge"
                >
                  Use {b.name}
                </button>
              ))}
              <span className="muted">Or set up a new bridge on another computer:</span>
            </div>
          )}
          {!pairing && (
            <BridgeSetup
              relay={relayForCommand}
              pasteLink={
                <label>
                  Pairing link
                  <input
                    value={code}
                    data-testid="pairing-code"
                    onChange={(e) => {
                      setCode(e.target.value);
                      const p = decodePairing(e.target.value);
                      setError(p || !e.target.value.trim() ? '' : "That isn't a pairing link. Copy the whole address of the page the bridge opened.");
                      if (p) setPairing(p);
                    }}
                    placeholder="https://…/#pair=…"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </label>
              }
            />
          )}
          {pairing && (
            <>
              <BridgeState
                bridge={bridge}
                problem={bridgeProblem}
                onDifferent={
                  existing
                    ? undefined
                    : () => {
                        setPairing(null);
                        setBridge(null);
                        setBridgeProblem('');
                        setRows([]);
                        setCode('');
                      }
                }
              />
              {bridge?.agent === 'online' && listMode && (
                <BridgeAddList rows={rows} setRows={setRows} watch={watch} searchNow={bridge.printers.length === 0} system={bridge.system} isSaved={isSaved} />
              )}
              {bridge?.agent === 'online' &&
                !listMode &&
                (Number(bridge.version) >= MANAGED_FROM ? (
                  <BridgePrinters
                    watch={watch}
                    searchNow={bridge.printers.length === 0}
                    system={bridge.system}
                    onAdded={(p) => {
                      setPrinterId(p.id);
                      setName((n) => n || p.name);
                    }}
                  />
                ) : (
                  <p className="muted">To find and add printers from here, update the bridge: download it again and open it (or run the Terminal command again).</p>
                ))}
              {bridge && !listMode && bridge.printers.length > 0 && (
                <label>
                  Printer
                  <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
                    {bridge.printers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {pairing && !listMode && (existing || bridge?.agent === 'online') && (
            <>
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My U1" />
              </label>
              <PresetField value={preset} onChange={setPreset} />
            </>
          )}
        </div>
      ) : (
        <div className="dv-form">
          <p>For a printer you've put on the internet yourself, behind https.</p>
          <p>
            <strong>First, let this site talk to the printer.</strong> Moonraker only answers websites it lists in <code>cors_domains</code>. On the printer, open{' '}
            <code>moonraker.conf</code> (in Mainsail or Fluidd: Machine, then moonraker.conf), add this site under <code>[authorization]</code>, save, and restart
            Moonraker:
          </p>
          <CopyCommand command={`[authorization]\ncors_domains:\n    ${location.origin}`} testId="cors-snippet" />
          <p className="muted">
            If <code>[authorization]</code> already has <code>cors_domains:</code>, add just the last line under it, indented like the others.
          </p>
          <p className="muted">
            Using <a href="https://tailscale.com/kb/1312/serve" target="_blank" rel="noreferrer">Tailscale</a> (built into the paxx12 U1 firmware)? Turn on Tailscale Serve on the printer and
            enter its https://….ts.net address. It works from your phones and computers that are signed in to Tailscale.
          </p>
          <label>
            Address
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://printer.example.com" spellCheck={false} autoCapitalize="off" data-testid="printer-url" />
          </label>
          <label>
            Moonraker API key <span className="muted">(if it asks for one)</span>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} spellCheck={false} autoCapitalize="off" />
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My printer" />
          </label>
          <PresetField value={preset} onChange={setPreset} />
        </div>
      )}
      {error && (
        <p className="dv-alert" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
