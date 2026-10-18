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

/** One command on its own line, with a button that copies exactly that command. */
function CopyCommand({ command, testId }: { command: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="dv-command">
      <pre className="dv-code" data-testid={testId}>
        {command}
      </pre>
      <button className="secondary" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** Where `install` puts the bridge on each system, as a command to type. */
const BRIDGE_COMMAND: Record<'windows' | 'mac' | 'linux', string> = {
  // "cmd /c call" makes one line work in PowerShell and in Command Prompt: cmd fills in %LOCALAPPDATA%, and "call" keeps cmd from stripping the quotes around the path.
  windows: 'cmd /c call "%LOCALAPPDATA%\\Cloud Slicer Bridge\\cloud-slicer-bridge.exe"',
  mac: '"$HOME/Library/Application Support/Cloud Slicer Bridge/cloud-slicer-bridge"',
  linux: '~/.local/bin/cloud-slicer-bridge',
};
const SHELL_NAME = { windows: 'PowerShell or Command Prompt', mac: 'Terminal', linux: 'a terminal' };
const SYSTEM_NAME = { windows: 'Windows', mac: 'Mac', linux: 'Linux or Pi' };

type BridgeOs = 'windows' | 'mac' | 'linux';

/** Which system the bridge's computer runs, starting from this browser's guess. */
function useBridgeOs(): [BridgeOs, (os: BridgeOs) => void] {
  const guess = guessSystem();
  return useState<BridgeOs>(guess === 'other' ? 'linux' : guess);
}

function OsTabs({ os, onChange }: { os: BridgeOs; onChange: (os: BridgeOs) => void }) {
  return (
    <div className="dv-segmented dv-os-tabs" role="tablist" aria-label="The bridge's computer">
      {(['windows', 'mac', 'linux'] as const).map((k) => (
        <button key={k} role="tab" aria-selected={os === k} className={os === k ? 'on' : ''} onClick={() => onChange(k)}>
          {SYSTEM_NAME[k]}
        </button>
      ))}
    </div>
  );
}

/** The add and uninstall commands for one system, with the printer address the user types filled in. */
function ManageCommands() {
  const [os, setOs] = useBridgeOs();
  const [address, setAddress] = useState('');
  const exe = BRIDGE_COMMAND[os];
  return (
    <div className="dv-about-commands">
      <OsTabs os={os} onChange={setOs} />
      <label>
        Printer address
        <input value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="for example 192.168.1.50" spellCheck={false} autoCapitalize="off" data-testid="bridge-add-address" />
      </label>
      <span className="muted">Add that printer, in {SHELL_NAME[os]}:</span>
      <CopyCommand command={`${exe} add ${address || '<printer address>'}`} testId="bridge-add-command" />
      <span className="muted">Stop the bridge and remove it from that computer, with its printers and pairing:</span>
      <CopyCommand command={`${exe} uninstall`} testId="bridge-uninstall-command" />
      <span className="muted">These need the bridge set up to start with the computer, which it does the first time you open it. If a command says the path can't be found, open the bridge app again.</span>
    </div>
  );
}

/** How to remove the bridge from its computer, for when its last printer goes. */
export function UninstallBridge() {
  const [os, setOs] = useBridgeOs();
  return (
    <div className="dv-about-commands" data-testid="bridge-uninstall">
      <OsTabs os={os} onChange={setOs} />
      <span className="muted">On the bridge's computer, in {SHELL_NAME[os]}:</span>
      <CopyCommand command={`${BRIDGE_COMMAND[os]} uninstall`} testId="bridge-uninstall-command" />
      <span className="muted">
        That stops the bridge, stops it starting with the computer, and deletes it with its printers and pairing. If it says the path can't be found, the bridge was never
        set to start with that computer: closing its window stops it.
      </span>
    </div>
  );
}

/**
 * How to set up the bridge on the computer near the printer: one app to open
 * on Windows and macOS, one command on Linux and Raspberry Pi, and the
 * Node.js script for everything else (or while the relay has no apps yet).
 */
export function BridgeSetup({ relay }: { relay: string }) {
  const [apps, setApps] = useState<BridgeApp[] | null>(null);
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
        No printer found? Add it by its address, for example <code>node cloud-slicer-bridge.mjs add 192.168.1.50</code> (use your printer's address), then run it
        again.
      </li>
    </ol>
  );

  if (apps === null) return <p className="muted">Finding the bridge downloads…</p>;
  if (!apps.length) return nodeSteps;

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
              <CopyCommand command={install} testId="bridge-install-command" />
            </>
          )}
        </li>
        <li>
          Open it (the Terminal command does this by itself). It asks nothing: it finds the printers on your network, starts by itself with the computer (so the Device tab works
          whenever that computer is on), and opens a link to this page (you can also paste the link below). Here you choose the printer, type its API key if
          it needs one, or add a printer by its address.
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
      <details className="dv-node-option" data-testid="bridge-about">
        <summary>About the bridge: keeping it running, adding printers, removing it</summary>
        <div className="dv-about">
          <p>
            <strong>Does it keep running?</strong> Yes. Once set up it starts by itself: on Windows and Mac when you log in (on Windows you'll see it minimised in the
            taskbar), on Linux and Raspberry Pi when the computer starts. The Device tab can reach your printer whenever that computer is on.
          </p>
          <p>
            <strong>Adding a printer later, or stopping it.</strong> The bridge finds your printers when it's first set up. Once it's paired, you can add more
            printers by address right in this dialog, with no terminal. Or type the address here and run the command on the bridge's computer:
          </p>
          <ManageCommands />
          <p>The bridge restarts by itself to use a printer you add. To update it, set it up again the same way (download and open the app, or run the Terminal command).</p>
          <p>
            <strong>Is it safe?</strong> The bridge only connects out to Cloud Slicer's relay, so nothing on your router is opened, and it only talks to the printers it
            found or you added. Your printer's API key is kept on that computer (one typed here goes straight to the bridge). The pairing link works like a password: anyone who has it can control your
            printers, so don't share it.
          </p>
        </div>
      </details>
      <details className="dv-node-option">
        <summary>Other computers (with Node.js)</summary>
        {nodeSteps}
      </details>
    </div>
  );
}
