import { useEffect, useState } from 'react';
import { installedOnly, SETUP_KEY, type Setup } from '../../lib/setup';
import { useUserSetting } from '../../state/account';
import { useDevice, type SavedPrinter } from '../../state/device';
import { useSlicer } from '../../state/store';
import { DEFAULT_RELAY_URL } from '../config';
import { BridgeLink } from '../link/bridge';
import { DirectLink, directBlockedReason, normalizePrinterUrl } from '../link/direct';
import type { BridgeStatus } from '../link/types';
import { decodePairing, type Pairing } from '../pairing';
import { BridgeSetup, CopyCommand, UninstallBridge } from './BridgeSetup';
import { Dialog } from './parts';

const newId = () => Math.random().toString(36).slice(2, 10);

/** Which printer profile this machine prints with: one of the installed printers. */
function PresetField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const all = useSlicer((s) => s.printers);
  const installed = useUserSetting<Setup>(SETUP_KEY)?.printers;
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
interface BridgeWatch {
  stop(): void;
  /** Asks the bridge itself to do something (add or remove a printer), over the watching connection. */
  manage<T>(method: `bridge.${string}`, params: unknown): Promise<T>;
}

/** Bridges from this version on can add and remove printers when the Device tab asks. */
const MANAGED_FROM = 3;

function watchBridge(p: Pairing, onStatus: (s: BridgeStatus) => void, onError: (e: Error) => void): BridgeWatch {
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
async function removeFromBridge(p: Pairing, printer: string): Promise<void> {
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
          <span className="muted">Added</span>
        ) : (
          <button className="secondary" disabled={busy || (printer.needsKey && !apiKey.trim())} onClick={() => void add()} data-testid="found-add">
            {busy ? 'Adding…' : 'Add'}
          </button>
        )}
      </div>
      {!printer.added && printer.needsKey && (
        <label>
          <span className="muted">It needs its Moonraker API key (Mainsail and Fluidd show it in their settings):</span>
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
 * The bridge's printers come from here: search the bridge's network and pick
 * which printers to add (with their API keys), or add one by its address.
 */
function BridgePrinters({ watch, onAdded, searchNow }: { watch: BridgeWatch | null; onAdded: (p: { id: string; name: string }) => void; searchNow: boolean }) {
  const [found, setFound] = useState<FoundPrinter[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState('');
  const [address, setAddress] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [addProblem, setAddProblem] = useState('');
  const search = async () => {
    if (!watch) return;
    setSearching(true);
    setProblem('');
    try {
      setFound((await watch.manage<{ printers: FoundPrinter[] }>('bridge.discover', {})).printers);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  // A bridge with no printers yet: look straight away.
  useEffect(() => {
    if (searchNow && watch && found === null && !searching) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchNow, watch]);
  const added = (p: { id: string; name: string }, url?: string) => {
    if (url) setFound((list) => list?.map((f) => (f.url === url ? { ...f, added: p.id } : f)) ?? null);
    onAdded(p);
  };
  const addByAddress = async () => {
    if (!watch) return;
    setAdding(true);
    setAddProblem('');
    try {
      added(await watch.manage<{ id: string; name: string }>('bridge.add_printer', { address: address.trim(), apiKey: apiKey.trim() }));
      setAddress('');
      setApiKey('');
    } catch (e) {
      setAddProblem((e as Error).message);
    } finally {
      setAdding(false);
    }
  };
  return (
    <div className="dv-bridge-printers" data-testid="bridge-printers">
      <div className="dv-found-head">
        <strong>Printers on the bridge's network</strong>
        <button className="secondary" disabled={!watch || searching} onClick={() => void search()} data-testid="bridge-search">
          {searching ? 'Searching…' : found ? 'Search again' : 'Search my network'}
        </button>
      </div>
      {searching && <p className="muted">Looking for printers (Moonraker) on the network, this takes a few seconds…</p>}
      {problem && (
        <p className="dv-alert" role="alert">
          {problem}
        </p>
      )}
      {found && !searching && !found.length && <p className="muted">No printer answered on the network. Add yours by its address below.</p>}
      {found && found.length > 0 && (
        <ul className="dv-found-list">
          {found.map((f) => (
            <FoundRow key={f.url} printer={f} watch={watch} onAdded={(p) => added(p, f.url)} />
          ))}
        </ul>
      )}
      <details className="dv-node-option" data-testid="bridge-add-printer">
        <summary>Add a printer by its address</summary>
        <div className="dv-form">
          <label>
            Printer address
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="for example 192.168.1.50, or 192.168.1.50:7130 for another port" spellCheck={false} autoCapitalize="off" data-testid="bridge-new-address" />
          </label>
          <label>
            Moonraker API key <span className="muted">(only if the printer asks for one)</span>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} spellCheck={false} autoCapitalize="off" autoComplete="off" data-testid="bridge-new-key" />
          </label>
          {addProblem && (
            <p className="dv-alert" role="alert">
              {addProblem}
            </p>
          )}
          <div>
            <button className="secondary" disabled={!address.trim() || adding} onClick={() => void addByAddress()} data-testid="bridge-add-submit">
              {adding ? 'Adding…' : 'Add to bridge'}
            </button>
          </div>
        </div>
      </details>
      <p className="muted">API keys go to the bridge, which keeps them on its computer; Cloud Slicer doesn't store them.</p>
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
  // direct
  const [url, setUrl] = useState(existing?.kind === 'direct' ? existing.url : '');
  const [apiKey, setApiKey] = useState(existing?.kind === 'direct' ? existing.apiKey : '');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const saved = useDevice((s) => s.printers);

  useEffect(() => {
    if (!pairing) return;
    setChecking(true);
    setError('');
    const w = watchBridge(
      pairing,
      (b) => {
        setChecking(false);
        setError('');
        setBridge(b);
        if (b.printers[0]) {
          setPrinterId((id) => id || b.printers[0].id);
          setName((n) => n || b.printers[0].name);
        }
      },
      (e) => {
        setChecking(false);
        setError(e.message);
      },
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
    // A bridge printer: the bridge keeps running on its computer, so say how to remove it too (unless other printers still use it).
    const sharing = existing.kind === 'bridge' ? saved.filter((p) => p.id !== existing.id && p.kind === 'bridge' && p.bridgeId === existing.bridgeId) : [];
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
          {existing.kind === 'bridge' &&
            (sharing.length ? (
              <p className="muted">Keep the bridge on its computer: {sharing.map((p) => p.name).join(', ')} still use it.</p>
            ) : (
              <>
                <p>The bridge keeps running on the computer near the printer. If you don't need it any more, remove it from that computer too:</p>
                <UninstallBridge />
              </>
            ))}
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
          <button className="secondary" onClick={close}>
            Cancel
          </button>
          {kind === 'bridge' ? (
            <button className="primary" disabled={!pairing || !printerId || checking} onClick={saveBridge} data-testid="save-printer">
              {existing ? 'Save' : 'Add printer'}
            </button>
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
            On my home network
          </button>
          <button role="tab" aria-selected={kind === 'direct'} className={kind === 'direct' ? 'on' : ''} onClick={() => setKind('direct')}>
            Public https address
          </button>
        </div>
      )}

      {kind === 'bridge' ? (
        <div className="dv-form">
          {!pairing && (
            <>
              <p>
                Browsers can't reach a printer on your home network from a website, so a small bridge runs on any computer that stays on near the printer (a PC, a Mac or a Raspberry
                Pi). It connects out to the relay, so nothing on your router needs opening.
              </p>
              <BridgeSetup relay={relayForCommand} />
              <label>
                Pairing link or code
                <input
                  value={code}
                  data-testid="pairing-code"
                  onChange={(e) => {
                    setCode(e.target.value);
                    const p = decodePairing(e.target.value);
                    setError(p || !e.target.value.trim() ? '' : 'That is not a pairing code.');
                    if (p) setPairing(p);
                  }}
                  spellCheck={false}
                  autoCapitalize="off"
                />
              </label>
            </>
          )}
          {pairing && (
            <>
              <p className="muted">
                Bridge {pairing.bridgeId.slice(0, 8)} ·{' '}
                {checking ? 'checking…' : bridge ? (bridge.agent === 'online' ? 'online' : 'offline, start the bridge to use it') : 'not reachable'}
                {!existing && (
                  <>
                    {' '}
                    ·{' '}
                    <button
                      className="dv-link"
                      onClick={() => {
                        setPairing(null);
                        setBridge(null);
                        setCode('');
                      }}
                    >
                      Use a different bridge
                    </button>
                  </>
                )}
              </p>
              {bridge && bridge.printers.length === 0 && <p className="dv-alert">This bridge has no printers yet: add them below.</p>}
              {bridge?.agent === 'online' &&
                (Number(bridge.version) >= MANAGED_FROM ? (
                  <BridgePrinters
                    watch={watch}
                    searchNow={bridge.printers.length === 0}
                    onAdded={(p) => {
                      setPrinterId(p.id);
                      setName((n) => n || p.name);
                    }}
                  />
                ) : (
                  <p className="muted">To find and add printers from here, update the bridge: download it again and open it (or run the Terminal command again).</p>
                ))}
              {bridge && bridge.printers.length > 0 && (
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
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My U1" />
          </label>
          <PresetField value={preset} onChange={setPreset} />
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
