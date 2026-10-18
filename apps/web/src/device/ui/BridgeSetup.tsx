import { useEffect, useState } from 'react';

/** A bridge app the relay has (apps/device-relay: /downloads.json). */
interface BridgeApp {
  name: string;
  size: number;
}

type System = 'windows' | 'mac' | 'linux' | 'other';

/** Best guess at this computer's system; the bridge often goes on another computer, so every choice stays offered. */
export function guessSystem(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): System {
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'other';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'other';
}

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/**
 * How to set up the bridge on the computer near the printer: one app to open
 * on Windows and macOS, one command on Linux and Raspberry Pi, and the
 * Node.js script for everything else (or while the relay has no apps yet).
 */
export function BridgeSetup({ relay }: { relay: string }) {
  const [apps, setApps] = useState<BridgeApp[] | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`${relay}/downloads.json`)
      .then((r) => (r.ok ? r.json() : { apps: [] }))
      .then((d: { apps?: BridgeApp[] }) => live && setApps(d.apps ?? []))
      .catch(() => live && setApps([]));
    return () => {
      live = false;
    };
  }, [relay]);

  // The site goes along so the Node.js bridge's pairing links come back to this same site.
  const script = `${relay}/bridge.mjs?site=${encodeURIComponent(location.origin)}`;
  const install = `curl -fsSL ${relay}/install.sh | sh`;
  const has = (name: string) => apps?.find((a) => a.name === name);
  const linux = has('linux-x64') || has('linux-arm64');
  const system = guessSystem();

  const nodeSteps = (
    <ol className="dv-steps-list">
      <li>
        <a href={script} download="cloud-slicer-bridge.mjs">
          Download the bridge
        </a>{' '}
        to that computer (it needs Node.js 22 or newer).
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
  );

  if (apps === null) return <p className="muted">Finding the bridge downloads…</p>;
  if (!apps.length) return nodeSteps;

  const copy = () => {
    void navigator.clipboard?.writeText(install).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const win = has('windows-x64');
  const mac = has('mac-arm64');
  const macIntel = has('mac-x64');
  const macDownload = mac || macIntel;
  const terminal = linux || macDownload;
  const terminalFor = [macDownload && 'Mac', linux && 'Linux or Raspberry Pi (64-bit)'].filter(Boolean).join(', ');

  return (
    <div className="dv-bridge-setup">
      <ol className="dv-steps-list">
        <li>
          On the computer near the printer, get the bridge:
          {win && (
            <div className="dv-downloads">
              <a className={system === 'windows' ? 'primary' : 'secondary'} href={`${relay}/download/windows-x64`} data-testid="bridge-download-windows">
                Windows ({mb(win.size)})
              </a>
            </div>
          )}
          {terminal && (
            <>
              <span className="muted">{terminalFor}: paste this in Terminal and press Enter.</span>
              <div className="dv-command">
                <pre className="dv-code" data-testid="bridge-install-command">{install}</pre>
                <button className="secondary" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </>
          )}
        </li>
        <li>
          Open it (the Terminal command does this by itself). It finds the printers on your network, opens a link to this page that adds them (you can also paste the link below), and
          starts by itself with the computer, so the Device tab works whenever the computer is on.
        </li>
        {(win || macDownload) && (
          <li className="muted">
            The bridge isn't signed yet, so systems warn about it.
            {win && ' Windows may say "Windows protected your PC": choose More info, then Run anyway.'}
            {macDownload && (
              <>
                {' '}On a Mac the Terminal command avoids the warning; if macOS asks whether the bridge may find devices on your local network, click Allow. To download the app instead (
                {mac && (
                  <a href={`${relay}/download/mac-arm64`} data-testid="bridge-download-mac">
                    Apple chip
                  </a>
                )}
                {mac && macIntel && ', '}
                {macIntel && <a href={`${relay}/download/mac-x64`}>Intel</a>}
                ): open the zip and the app; when macOS says it was not opened, click Done, then open System Settings, Privacy & Security, and click Open Anyway.
              </>
            )}
          </li>
        )}
      </ol>
      <details className="dv-node-option">
        <summary>Other computers (with Node.js)</summary>
        {nodeSteps}
      </details>
    </div>
  );
}
