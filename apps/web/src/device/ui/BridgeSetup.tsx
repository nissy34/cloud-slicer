import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../account/api';
import { useAccount } from '../../state/account';
import { useDevice } from '../../state/device';
import { DEFAULT_RELAY_URL, isTestRelay } from '../config';
import type { Pairing } from '../pairing';

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
export function CopyCommand({ command, testId }: { command: string; testId?: string }) {
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
  return useState<BridgeOs>(guess === 'other' ? 'windows' : guess);
}

function OsTabs<K extends string>({ os, onChange, tabs = ['windows', 'mac', 'linux'] as K[], names = SYSTEM_NAME as Record<K, string> }: { os: K; onChange: (os: K) => void; tabs?: K[]; names?: Record<K, string> }) {
  return (
    <div className="dv-segmented dv-os-tabs" role="tablist" aria-label="The bridge's computer">
      {tabs.map((k) => (
        <button key={k} role="tab" aria-selected={os === k} className={os === k ? 'on' : ''} onClick={() => onChange(k)}>
          {names[k]}
        </button>
      ))}
    </div>
  );
}

/** Where a bridge that never said where it runs could be: a computer, or the printer itself. */
type UninstallPlace = BridgeOs | 'printer';
const UNINSTALL_TABS: UninstallPlace[] = ['windows', 'mac', 'linux', 'printer'];
const UNINSTALL_NAMES: Record<UninstallPlace, string> = { ...SYSTEM_NAME, printer: 'On the printer' };

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

/** Uninstall tabs: Linux, a Pi and a printer share one line (the bridge finds where it was installed). */
const UNINSTALL_SYSTEM_NAME: Record<BridgeOs, string> = { ...SYSTEM_NAME, linux: 'Linux, Pi or printer' };

/** How to remove the bridge from its computer, for when its last printer goes. */
export function UninstallBridge({ system, place, relay }: { system?: string; place?: string; relay?: string }) {
  const known = place === 'printer' ? 'linux' : system ? FROM_PLATFORM[system] : undefined;
  const [picked, setOs] = useBridgeOs();
  const os = known ?? picked;
  if (os === 'linux') {
    return (
      <div className="dv-about-commands" data-testid="bridge-uninstall">
        {!known && <OsTabs os={os} onChange={setOs} names={UNINSTALL_SYSTEM_NAME} />}
        <span className="muted">{place === 'printer' ? 'On the printer, over SSH:' : 'On the bridge\'s computer or printer (over SSH), in a terminal:'}</span>
        <CopyCommand command={`curl -fsSL ${relay ?? DEFAULT_RELAY_URL}/install.sh | sh -s -- --uninstall`} testId="bridge-uninstall-command" />
        <span className="muted">That stops the bridge, stops it starting by itself, and deletes it with its printers and pairing. On a printer it asks for root when it needs it.</span>
      </div>
    );
  }
  return (
    <div className="dv-about-commands" data-testid="bridge-uninstall">
      {!known && <OsTabs os={os} onChange={setOs} names={UNINSTALL_SYSTEM_NAME} />}
      <span className="muted">On the bridge's computer, in {SHELL_NAME[os]}:</span>
      <CopyCommand command={`${BRIDGE_COMMAND[os]} uninstall`} testId="bridge-uninstall-command" />
      <span className="muted">
        That stops the bridge, stops it starting with the computer, and deletes it with its printers and pairing. If it says the path can't be found, the bridge was never
        set to start with that computer: closing its window stops it.
      </span>
    </div>
  );
}

const FROM_PLATFORM: Record<string, BridgeOs> = { win32: 'windows', darwin: 'mac', linux: 'linux' };
const STARTS_WHEN = { windows: 'when you sign in to Windows', mac: 'when you log in to the Mac', linux: 'when the computer starts' };
const LOG = { mac: '~/Library/Logs/cloud-slicer-bridge.log', linux: 'journalctl --user -u cloud-slicer-bridge -n 50' } as const;

/**
 * What to do when the bridge is offline, for the bridge computer's own system
 * when the bridge said which it is, else with a choice of system.
 */
export function BridgeOffline({ system, place }: { system?: string; place?: string }) {
  const known = system ? FROM_PLATFORM[system] : undefined;
  const [guess] = useBridgeOs();
  const [picked, setOs] = useState<UninstallPlace>(guess);
  // A bridge that never connected didn't say where it runs: the printer is one more choice.
  const os = place === 'printer' ? 'printer' : (known ?? picked);
  if (os === 'printer') {
    return (
      <div className="dv-about-commands" data-testid="bridge-offline-help">
        {!known && place !== 'printer' && <OsTabs os={os} onChange={setOs} tabs={UNINSTALL_TABS} names={UNINSTALL_NAMES} />}
        <span>
          The bridge runs on the printer itself and isn't answering. Check the printer is on and online; the bridge starts with it. This page reconnects by itself.
        </span>
        <span className="muted">
          Still offline? Restart the printer. A Snapmaker U1 loses the bridge with a firmware update: connect to it over SSH and paste the install line from Add a printer,
          On the printer, again.
        </span>
      </div>
    );
  }
  return (
    <div className="dv-about-commands" data-testid="bridge-offline-help">
      <span>
        The bridge isn't running{known ? ` on its ${os === 'windows' ? 'Windows PC' : os === 'mac' ? 'Mac' : 'Linux computer'}` : ''}. It starts by itself{' '}
        {STARTS_WHEN[os]}, so first check that computer is on{os === 'linux' ? '' : ', signed in'} and online. This page reconnects by itself.
      </span>
      {!known && <OsTabs os={os} onChange={setOs} tabs={UNINSTALL_TABS} names={UNINSTALL_NAMES} />}
      <span className="muted">Still offline? Start it again on that computer, in {SHELL_NAME[os]}:</span>
      <CopyCommand command={`${BRIDGE_COMMAND[os]} install`} testId="bridge-offline-command" />
      <span className="muted">
        That starts it in the background and sets it to start with the computer again (it also opens the pairing page there, which you can close).
        {os !== 'windows' && <> If it keeps stopping, its log says why: <code>{LOG[os]}</code>.</>} If the command says the path can't be found, download
        the bridge again from Add a printer and open it.
      </span>
    </div>
  );
}

/** A numbered step: a short bold heading saying what to do, and anything under it. */
function Step({ n, title, children }: { n: number; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="dv-setup-step">
      <span className="dv-step-n" aria-hidden>
        {n}
      </span>
      <div className="dv-step-body">
        <strong>{title}</strong>
        {children}
      </div>
    </li>
  );
}

/** One command to paste, with a big Copy button first: copying it is the whole step. */
function CopyStep({ command, testId }: { command: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="dv-copy-step">
      <button className="primary dv-big" onClick={copy}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      <pre className="dv-code" data-testid={testId}>
        {command}
      </pre>
    </div>
  );
}

/** Where the bridge can run: a computer, or the printer's own Klipper computer. */
type SetupOs = BridgeOs | 'printer';
const OS_LABEL: Record<SetupOs, string> = { windows: 'Windows PC', mac: 'Mac', linux: 'Raspberry Pi or Linux', printer: 'On the printer' };

/** On the test relay: says so, and what it runs now (PR #113, main). */
function TestRelayNote({ relay }: { relay: string }) {
  const [testRuns, setTestRuns] = useState('');
  useEffect(() => {
    if (!isTestRelay(relay)) return;
    let live = true;
    fetch(`${relay}/v1/info`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { test?: string }) => live && setTestRuns(d.test || ''))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [relay]);
  if (!isTestRelay(relay)) return null;
  return (
    <p className="dv-note dv-test-note" data-testid="bridge-test-relay">
      <span className="dv-test-tag">Test</span> This test site sets up a <b>test bridge</b>
      {testRuns ? (
        <>
          {' '}
          on the test relay, which runs <b>{testRuns}</b>
        </>
      ) : (
        ' on the test relay'
      )}
      . It installs next to your everyday bridge without touching it, and only ever updates from the test relay. Remove it with the same steps, or with Remove bridge.
    </p>
  );
}

/** Copies this page's address, for someone reading it on a phone who sets the bridge up on a computer. */
function CopyPageLink() {
  const [copied, setCopied] = useState(false);
  const url = location.origin + location.pathname;
  return (
    <button
      className="dv-link"
      onClick={() =>
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {copied ? 'Link copied ✓' : 'Copy the link to this page'}
    </button>
  );
}

/**
 * How to set up the bridge on the computer near the printer, one system at a
 * time (guessed from this browser, switchable): Windows downloads and opens
 * the app, Mac and Linux paste one Terminal command. Every path ends with the
 * bridge opening this page with its pairing link, so the last step is just
 * picking the printer. `pasteLink` is the field for that link, for when the
 * page opened on another computer or not at all.
 */
export function BridgeSetup({ relay, pasteLink }: { relay: string; pasteLink?: ReactNode }) {
  const [apps, setApps] = useState<BridgeApp[] | null>(null);
  const system = guessSystem();
  const [guess] = useBridgeOs();
  const [os, setOs] = useState<SetupOs>(guess);
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

  const install = `curl -fsSL ${relay}/install.sh | sh`;
  const onPrinter = `curl -fsSL ${relay}/install.sh | sh -s -- --printer`;
  const has = (name: string) => apps?.find((a) => a.name === name);

  const paste = pasteLink && (
    <details className="dv-node-option dv-paste-link" data-testid="bridge-paste-link">
      <summary>This page didn't open by itself?</summary>
      <p className="muted">
        The bridge opens this page on its own computer. If that is a different computer, you can carry on there. Or copy the address of the page it opened (it ends with a long
        code after #pair=) and paste it here:
      </p>
      {pasteLink}
    </details>
  );

  if (apps === null) return <p className="muted">Getting the bridge ready…</p>;
  const win = has('windows-x64');
  const mac = has('mac-arm64');
  const macIntel = has('mac-x64');
  const linux = has('linux-x64') || has('linux-arm64') || has('linux-armv7');
  const offered = (['windows', 'mac', 'linux', 'printer'] as const).filter((k) => (k === 'windows' ? win : k === 'mac' ? mac || macIntel : linux));
  const shown = offered.includes(os) ? os : offered[0];
  if (!shown) {
    return (
      <p className="muted" data-testid="bridge-not-ready">
        The bridge app isn't available to download yet. Try again in a few minutes.
      </p>
    );
  }

  const lastStep = (n: number) => (
    <Step n={n} title="Pick your printer">
      <span>
        The bridge opens this page by itself and looks for printers on your network. Choose yours, then click <b>Add printer</b>. That's it: from now on the bridge starts
        by itself whenever that computer is on.
      </span>
    </Step>
  );

  return (
    <div className="dv-bridge-setup">
      <TestRelayNote relay={relay} />
      <p>
        Your printer is on your home network, which websites can't reach on their own. A small free app called the <b>bridge</b> connects the two. It runs on the printer
        itself or on a computer in your home that is usually switched on, and you only set it up once.
      </p>
      {system === 'other' && (
        <p className="dv-note" data-testid="bridge-phone-note">
          Do this on that computer, not on this phone. <CopyPageLink /> and open it there.
        </p>
      )}
      <div className="dv-setup-os">
        <span className="dv-setup-question">Where will the bridge run?</span>
        <div className="dv-segmented dv-os-tabs" role="tablist" aria-label="The bridge's computer">
          {offered.map((k) => (
            <button key={k} role="tab" aria-selected={shown === k} className={shown === k ? 'on' : ''} onClick={() => setOs(k)}>
              {OS_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <ol className="dv-setup-steps" data-testid={`bridge-steps-${shown}`}>
        {shown === 'windows' && win && (
          <>
            <Step n={1} title="Download the bridge">
              <div>
                <a className="primary dv-big" href={`${relay}/download/windows-x64`} data-testid="bridge-download-windows">
                  Download for Windows
                </a>{' '}
                <span className="muted">{mb(win.size)}</span>
              </div>
            </Step>
            <Step n={2} title="Open the file you downloaded">
              <span>You'll find it in your Downloads folder.</span>
              <span className="muted">
                If a blue box says "Windows protected your PC", click <b>More info</b>, then <b>Run anyway</b>. Windows says this about new apps it doesn't know yet.
              </span>
            </Step>
            {lastStep(3)}
          </>
        )}
        {shown === 'mac' && (
          <>
            <Step n={1} title="Copy this line">
              <CopyStep command={install} testId="bridge-install-command" />
            </Step>
            <Step n={2} title="Paste it into Terminal and press Return">
              <span>
                To open Terminal, press <kbd>⌘ Command</kbd> + <kbd>Space</kbd>, type <b>Terminal</b> and press <kbd>Return</kbd>. Paste with <kbd>⌘ Command</kbd> +{' '}
                <kbd>V</kbd>.
              </span>
              <span className="muted">
                If your Mac asks whether the bridge may find devices on your local network, click <b>Allow</b>.
              </span>
            </Step>
            {lastStep(3)}
          </>
        )}
        {shown === 'linux' && (
          <>
            <Step n={1} title="Copy this line">
              <CopyStep command={install} testId="bridge-install-command" />
            </Step>
            <Step n={2} title="Paste it into a terminal on that computer and press Enter">
              <span className="muted">
                On a Raspberry Pi without a screen, connect to it over SSH first. With no screen, the bridge prints a link instead of opening
                this page: open that link on any computer or phone.
              </span>
            </Step>
            {lastStep(3)}
          </>
        )}
        {shown === 'printer' && (
          <>
            <Step n={1} title="Connect to the printer over SSH">
              <span>
                From a terminal on your computer: <code>ssh root@&lt;printer address&gt;</code>. Klipper printers on a Raspberry Pi use the Pi's own user instead of
                root.
              </span>
              <span className="muted">
                Snapmaker U1: first turn on <b>Settings, Maintenance, Root Access</b> on the printer; the password is <b>snapmaker</b>. Creality K1: the password is{' '}
                <b>creality_2023</b>.
              </span>
            </Step>
            <Step n={2} title="Paste this line and press Enter">
              <CopyStep command={onPrinter} testId="bridge-printer-command" />
              <span className="muted">
                It installs the bridge on the printer as a service that starts with it and serves that printer. It updates itself, and it needs no computer left on.
              </span>
            </Step>
            <Step n={3} title="Open the link shown in the terminal">
              <span>
                Open it on this phone or computer; the printer is already on its list, so pick it and click <b>Add printer</b>. The link is also saved in Mainsail and
                Fluidd, in the config folder, as <code>cloud-slicer-bridge-pairing.txt</code>.
              </span>
              <span className="muted">On a Snapmaker U1 a firmware update removes the bridge: paste the line again afterwards.</span>
            </Step>
          </>
        )}
      </ol>

      {paste}
      {shown === 'mac' && (
        <details className="dv-node-option">
          <summary>Rather download the Mac app?</summary>
          <div className="dv-about">
            <div className="dv-downloads">
              {mac && (
                <a className="secondary" href={`${relay}/download/mac-arm64`} data-testid="bridge-download-mac">
                  Mac with Apple chip
                </a>
              )}
              {macIntel && (
                <a className="secondary" href={`${relay}/download/mac-x64`}>
                  Mac with Intel chip
                </a>
              )}
            </div>
            <p className="muted">
              Open the zip, then the app. The app isn't signed by Apple yet, so macOS stops it the first time: click <b>Done</b>, open <b>System Settings</b>, then{' '}
              <b>Privacy &amp; Security</b>, scroll down and click <b>Open Anyway</b>. The Terminal line above avoids all of this.
            </p>
          </div>
        </details>
      )}
      <details className="dv-node-option" data-testid="bridge-about">
        <summary>More about the bridge: is it safe, keeping it running, removing it</summary>
        <div className="dv-about">
          <p>
            <strong>Does it keep running?</strong> Yes. Once set up it starts by itself: on Windows and Mac when you log in (with no window: it
            runs in the background, out of the taskbar), on Linux and Raspberry Pi when the computer starts. The Device tab can reach your printer whenever that computer is on.
          </p>
          <p>
            <strong>Adding a printer later, or stopping it.</strong> Once the bridge is paired, add printers right in this dialog: search the network, or
            type an address. Or type the address here and run the command on the bridge's computer:
          </p>
          <ManageCommands />
          <p>The bridge restarts by itself to use a printer you add. It updates itself, and Printers &amp; bridges offers an update when one is out.</p>
          <p>
            <strong>Is it safe?</strong> The bridge only connects out to Cloud Slicer's relay, so nothing on your router is opened, and it only talks to the printers it
            found or you added. Your printer's API key is kept on that computer (one typed here goes straight to the bridge). The pairing link works like a password: anyone who has it can control your
            printers, so don't share it.
          </p>
        </div>
      </details>
    </div>
  );
}

/** The install command for a setup code, for each place a bridge can run. */
export function setupCommands(relay: string, code: string) {
  const q = `?code=${encodeURIComponent(code)}`;
  return {
    powershell: `irm "${relay}/install.ps1${q}" | iex`,
    cmd: `curl -fsSL "${relay}/install.cmd${q}" -o "%TEMP%\\cloud-slicer-bridge.cmd" && "%TEMP%\\cloud-slicer-bridge.cmd"`,
    unix: `curl -fsSL "${relay}/install.sh${q}" | sh`,
    printer: `curl -fsSL "${relay}/install.sh${q}" | sh -s -- --printer`,
  };
}

/** The download, which has no setup code inside: the app asks for it when opened. */
function DownloadWithCode({ code, children }: { code: string; children: ReactNode }) {
  return (
    <>
      <strong>Or download it</strong>
      <span className="dv-setup-download" data-testid="setup-download">
        {children}
        <span>
          then paste this setup code when it asks: <code>{code}</code>
        </span>
        <button className="dv-link" onClick={() => void navigator.clipboard?.writeText(code)}>
          Copy
        </button>
      </span>
    </>
  );
}

/** How often the dialog asks whether the bridge has used the setup code. */
const POLL_MS = 2000;

/**
 * Setting up a new bridge, signed in: a one-use setup code (one hour) inside
 * one command per system. The bridge spends the code as it installs, which
 * saves it to the account; this then calls `onJoined` with its pairing. A
 * code that runs out is replaced by a new one, with a note saying so.
 */
export function AddBridge({ relay, onJoined }: { relay: string; onJoined: (p: Pairing, name: string) => void }) {
  const [guess] = useBridgeOs();
  const [os, setOs] = useState<SetupOs>(guess);
  const [setup, setSetup] = useState<{ code: string; expiresAt: number } | null>(null);
  const [renewed, setRenewed] = useState(false);
  const [problem, setProblem] = useState('');
  const system = guessSystem();

  // A first code, and a new one whenever the last one runs out.
  useEffect(() => {
    if (setup) return;
    let live = true;
    api.bridgeSetup(relay).then(
      (s) => live && setSetup(s),
      (e: Error) => live && setProblem(e.message),
    );
    return () => {
      live = false;
    };
  }, [relay, setup]);

  useEffect(() => {
    if (!setup) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const s = Date.now() > setup.expiresAt ? { state: 'expired' as const } : await api.bridgeSetupState(setup.code);
        if (!live) return;
        if (s.state === 'used' && s.bridgeId) {
          const pairing = await useDevice.getState().adoptBridge(s.bridgeId);
          if (live && pairing) return onJoined(pairing, s.name ?? 'The bridge');
        }
        if (s.state === 'expired') {
          setRenewed(true);
          return setSetup(null);
        }
      } catch {
        // Offline for a moment: ask again next time.
      }
      if (live) timer = setTimeout(() => void check(), POLL_MS);
    };
    timer = setTimeout(() => void check(), POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  if (problem) {
    return (
      <p className="dv-alert" role="alert" data-testid="bridge-setup-problem">
        {problem}
      </p>
    );
  }
  if (!setup) return <p className="muted">Making a setup code…</p>;
  const c = setupCommands(relay, setup.code);

  return (
    <div className="dv-bridge-setup" data-testid="add-bridge">
      <TestRelayNote relay={relay} />
      <p>Run the bridge on a computer that stays on at home, on the same network as the printer, or on the printer itself.</p>
      {system === 'other' && (
        <p className="dv-note" data-testid="bridge-phone-note">
          Do this on that computer, not on this phone: copy the command and run it there, or <CopyPageLink /> and open it there.
        </p>
      )}
      {renewed && (
        <div className="dv-bridge-state failed" role="status" data-testid="setup-code-renewed">
          <span className="dv-bridge-state-icon" aria-hidden>
            !
          </span>
          <div>
            <strong>That setup code expired</strong>
            <span className="muted">A setup code works for one hour. Here is a new one. If you already ran the command, paste this code where it asks; otherwise copy the new command.</span>
          </div>
        </div>
      )}
      <div className="dv-segmented dv-os-tabs" role="tablist" aria-label="Where the bridge runs">
        {(['windows', 'mac', 'linux', 'printer'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={os === k} className={os === k ? 'on' : ''} onClick={() => setOs(k)}>
            {k === 'printer' ? 'On the printer' : SYSTEM_NAME[k]}
          </button>
        ))}
      </div>

      <div className="dv-setup-commands" data-testid={`setup-${os}`}>
        {os === 'windows' && (
          <>
            <strong>In PowerShell</strong>
            <CopyCommand command={c.powershell} testId="setup-powershell" />
            <details className="dv-node-option">
              <summary>How do I open PowerShell?</summary>
              <p className="muted">
                Press the <kbd>Windows</kbd> key, type <b>PowerShell</b> and press <kbd>Enter</kbd>. Paste the line with <kbd>Ctrl</kbd> + <kbd>V</kbd> (or a right-click) and
                press <kbd>Enter</kbd>.
              </p>
            </details>
            <strong>Or in Command Prompt</strong>
            <CopyCommand command={c.cmd} testId="setup-cmd" />
            <DownloadWithCode code={setup.code}>
              <a className="secondary" href={`${relay}/download/windows-x64`} data-testid="setup-download-windows">
                Download for Windows
              </a>
            </DownloadWithCode>
            <span className="muted">
              If a blue box says "Windows protected your PC" when you open it, click <b>More info</b>, then <b>Run anyway</b>.
            </span>
          </>
        )}
        {os === 'mac' && (
          <>
            <strong>In Terminal</strong>
            <CopyCommand command={c.unix} testId="setup-unix" />
            <span className="muted">
              To open Terminal, press <kbd>⌘ Command</kbd> + <kbd>Space</kbd>, type <b>Terminal</b> and press <kbd>Return</kbd>. If your Mac asks whether the bridge may find
              devices on your local network, click <b>Allow</b>.
            </span>
            <DownloadWithCode code={setup.code}>
              <a className="secondary" href={`${relay}/download/mac-arm64`} data-testid="setup-download-mac">
                Mac with Apple chip
              </a>
              <a className="secondary" href={`${relay}/download/mac-x64`}>
                Mac with Intel chip
              </a>
            </DownloadWithCode>
            <span className="muted">
              Open the zip, then the app. It isn't signed by Apple yet, so the first time macOS stops it: click <b>Done</b>, open <b>System Settings</b>, then{' '}
              <b>Privacy &amp; Security</b>, scroll down and click <b>Open Anyway</b>. The Terminal line avoids this.
            </span>
          </>
        )}
        {os === 'linux' && (
          <>
            <strong>In a terminal on that computer</strong>
            <CopyCommand command={c.unix} testId="setup-unix" />
            <span className="muted">On a Raspberry Pi without a screen, connect to it over SSH first.</span>
          </>
        )}
        {os === 'printer' && (
          <>
            <strong>In an SSH window on the printer (Klipper printers)</strong>
            <CopyCommand command={c.printer} testId="setup-printer" />
            <span className="muted">
              Connect first with <code>ssh root@&lt;printer address&gt;</code>; Klipper printers on a Raspberry Pi use the Pi's own user instead of root. Snapmaker U1: turn on{' '}
              <b>Settings, Maintenance, Root Access</b> on the printer first; the password is <b>snapmaker</b>. Creality K1: the password is <b>creality_2023</b>. On a U1 a
              firmware update removes the bridge: make a new setup code and run the command again afterwards.
            </span>
          </>
        )}
        <span className="dv-setup-code">
          Setup code <code data-testid="setup-code">{setup.code}</code>
          <button className="dv-link" onClick={() => void navigator.clipboard?.writeText(setup.code)}>
            Copy
          </button>
        </span>
        <span className="muted">The setup code (also inside the commands) works once, for the next hour, and adds the bridge to your account.</span>
      </div>

      <div className="dv-bridge-state connecting" role="status" data-testid="setup-waiting">
        <span className="dv-spinner" aria-hidden />
        <div>
          <strong>Waiting for your bridge…</strong>
          <span className="muted">This turns green by itself once the command has run.</span>
        </div>
      </div>
    </div>
  );
}

/** Signed out: bridges belong to an account, so adding one starts with signing in. */
export function SignInForBridge() {
  const status = useAccount((s) => s.status);
  if (status === 'loading') return <p className="muted">Checking your account…</p>;
  return (
    <div className="dv-bridge-setup" data-testid="bridge-sign-in">
      <p>
        Your printer is on your home network, which websites can't reach on their own. A small free app called the <b>bridge</b> connects the two, and it joins your Cloud
        Slicer account when you set it up.
      </p>
      <button className="primary dv-big" onClick={() => void useAccount.getState().signIn('google')} data-testid="bridge-sign-in-button">
        Sign in to add a bridge
      </button>
    </div>
  );
}
