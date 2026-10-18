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

/** Asks a bridge which printers it serves. */
function probeBridge(p: Pairing): Promise<BridgeStatus> {
  const link = new BridgeLink({ relay: p.relay, bridgeId: p.bridgeId, key: p.key, printer: '' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      link.close();
      reject(new Error('The bridge did not answer.'));
    }, 10_000);
    link
      .open({
        onMessage: () => {},
        onClose: () => {},
        onBridge: (status) => {
          clearTimeout(timer);
          link.close();
          resolve(status);
        },
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
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
  const [printerId, setPrinterId] = useState(existing?.kind === 'bridge' ? existing.printer : '');
  // direct
  const [url, setUrl] = useState(existing?.kind === 'direct' ? existing.url : '');
  const [apiKey, setApiKey] = useState(existing?.kind === 'direct' ? existing.apiKey : '');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pairing) return;
    let live = true;
    setChecking(true);
    setError('');
    probeBridge(pairing)
      .then((b) => {
        if (!live) return;
        setBridge(b);
        if (!printerId && b.printers[0]) setPrinterId(b.printers[0].id);
        if (!name && b.printers[0]) setName(b.printers[0].name);
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
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
  // The site goes along so the bridge's pairing links come back to this same site.
  const bridgeDownload = `${relayForCommand}/bridge.mjs?site=${encodeURIComponent(location.origin)}`;
  return (
    <Dialog
      title={existing ? `Edit ${existing.name}` : 'Add a printer'}
      onClose={close}
      wide
      footer={
        <>
          {existing && (
            <button className="secondary dv-danger-text dv-left" onClick={() => void removePrinter(existing.id)}>
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
                Browsers can't reach a printer on your home network from a website, so a small bridge runs on any computer that stays on near the printer (a PC, a Raspberry Pi or a NAS with
                Node.js 22). It connects out to the relay, so nothing on your router needs opening.
              </p>
              <ol className="dv-steps-list">
                <li>
                  <a href={bridgeDownload} download="cloud-slicer-bridge.mjs">
                    Download the bridge
                  </a>{' '}
                  to that computer.
                </li>
                <li>
                  Run it, and keep it running:
                  <pre className="dv-code">node cloud-slicer-bridge.mjs</pre>
                  It finds the printers on your network by itself.
                </li>
                <li>It opens a link to this page that adds your printer (or prints the link; you can also paste it below).</li>
                <li>
                  No printer found? Add it by its address: <code>node cloud-slicer-bridge.mjs add 192.168.1.50</code>, then run it again.
                </li>
              </ol>
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
              {bridge && bridge.printers.length === 0 && <p className="dv-alert">This bridge has no printers yet. Add one with: node cloud-slicer-bridge.mjs add &lt;address&gt;</p>}
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
          <p>For a printer you've put on the internet yourself, behind https. Add this site to Moonraker's cors_domains so the browser may talk to it.</p>
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
