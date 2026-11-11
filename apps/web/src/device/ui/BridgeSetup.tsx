import { useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '../../i18n';
import { api } from '../../account/api';
import { useAccount } from '../../state/account';
import { useDevice } from '../../state/device';
import { DEFAULT_RELAY_URL, isTestRelay } from '../config';
import type { Pairing } from '../pairing';
import { InfoTip } from '../../components/InfoTip';
import { Note } from '../../components/Note';

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

/** Markup inside the words: <b>, <kbd>, <c> (code), <strong>. */
const C = { b: <b />, kbd: <kbd />, c: <code />, strong: <strong /> };

/** One command on its own line, with a button that copies exactly that command. */
export function CopyCommand({ command, testId }: { command: string; testId?: string }) {
  const { t } = useTranslation();
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
        {copied ? t('common.copied') : t('deviceBridge.copy')}
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
// Word keys, shown with t().
const SHELL_NAME = { windows: 'deviceBridge.shellWindows', mac: 'deviceBridge.shellMac', linux: 'deviceBridge.shellLinux' };
const SYSTEM_NAME = { windows: 'deviceBridge.sysWindows', mac: 'deviceBridge.sysMac', linux: 'deviceBridge.sysLinux' };

type BridgeOs = 'windows' | 'mac' | 'linux';

/** Which system the bridge's computer runs, starting from this browser's guess. */
function useBridgeOs(): [BridgeOs, (os: BridgeOs) => void] {
  const guess = guessSystem();
  return useState<BridgeOs>(guess === 'other' ? 'windows' : guess);
}

function OsTabs<K extends string>({ os, onChange, tabs = ['windows', 'mac', 'linux'] as K[], names = SYSTEM_NAME as Record<K, string> }: { os: K; onChange: (os: K) => void; tabs?: K[]; names?: Record<K, string> }) {
  const { t } = useTranslation();
  return (
    <div className="chooser dv-os-tabs" role="tablist" aria-label={t('deviceBridge.bridgeComputer')}>
      {tabs.map((k) => (
        <button key={k} role="tab" aria-selected={os === k} className={os === k ? 'on' : ''} onClick={() => onChange(k)}>
          {t(names[k])}
        </button>
      ))}
    </div>
  );
}

/** Where a bridge that never said where it runs could be: a computer, or the printer itself. */
type UninstallPlace = BridgeOs | 'printer';
const UNINSTALL_TABS: UninstallPlace[] = ['windows', 'mac', 'linux', 'printer'];
const UNINSTALL_NAMES: Record<UninstallPlace, string> = { ...SYSTEM_NAME, printer: 'deviceBridge.onPrinter' };

/** The add and uninstall commands for one system, with the printer address the user types filled in. */
function ManageCommands() {
  const { t } = useTranslation();
  const [os, setOs] = useBridgeOs();
  const [address, setAddress] = useState('');
  const exe = BRIDGE_COMMAND[os];
  return (
    <div className="dv-about-commands">
      <OsTabs os={os} onChange={setOs} />
      <label>
        {t('deviceBridge.printerAddress')}
        <input value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder={t('deviceBridge.addressExample')} spellCheck={false} autoCapitalize="off" data-testid="bridge-add-address" />
      </label>
      <span className="muted">{t('deviceBridge.addThatPrinter', { shell: t(SHELL_NAME[os]) })}</span>
      <CopyCommand command={`${exe} add ${address || '<printer address>'}`} testId="bridge-add-command" />
      <span className="muted">{t('deviceBridge.stopAndRemove')}</span>
      <CopyCommand command={`${exe} uninstall`} testId="bridge-uninstall-command" />
      <span className="muted">{t('deviceBridge.theseNeed')}</span>
    </div>
  );
}

/** How to remove the bridge from its computer, for when its last printer goes. */
export function UninstallBridge({ system, place, relay }: { system?: string; place?: string; relay?: string }) {
  const { t } = useTranslation();
  const known = system ? FROM_PLATFORM[system] : undefined;
  const [guess] = useBridgeOs();
  const [picked, setOs] = useState<UninstallPlace>(guess);
  // A bridge that never connected didn't say where it runs: the printer is one more choice.
  const os = place === 'printer' ? 'printer' : (known ?? picked);
  if (os === 'printer') {
    return (
      <div className="dv-about-commands" data-testid="bridge-uninstall">
        {!known && place !== 'printer' && <OsTabs os={os} onChange={setOs} tabs={UNINSTALL_TABS} names={UNINSTALL_NAMES} />}
        <span className="muted">{t('deviceBridge.onPrinterSsh')}</span>
        <CopyCommand command={`curl -fsSL ${relay ?? DEFAULT_RELAY_URL}/install.sh | sh -s -- --printer --uninstall`} testId="bridge-uninstall-command" />
        <span className="muted">{t('deviceBridge.stopsOnPrinter')}</span>
      </div>
    );
  }
  return (
    <div className="dv-about-commands" data-testid="bridge-uninstall">
      {!known && <OsTabs os={os} onChange={setOs} tabs={UNINSTALL_TABS} names={UNINSTALL_NAMES} />}
      <span className="muted">{t('deviceBridge.onBridgeComputer', { shell: t(SHELL_NAME[os]) })}</span>
      <CopyCommand command={`${BRIDGE_COMMAND[os]} uninstall`} testId="bridge-uninstall-command" />
      <span className="muted">
        {t('deviceBridge.uninstallExplain')}
      </span>
    </div>
  );
}

const FROM_PLATFORM: Record<string, BridgeOs> = { win32: 'windows', darwin: 'mac', linux: 'linux' };
const STARTS_WHEN = { windows: 'deviceBridge.startsWindows', mac: 'deviceBridge.startsMac', linux: 'deviceBridge.startsLinux' };
const LOG = { mac: '~/Library/Logs/cloud-slicer-bridge.log', linux: 'journalctl --user -u cloud-slicer-bridge -n 50' } as const;

/**
 * What to do when the bridge is offline, for the bridge computer's own system
 * when the bridge said which it is, else with a choice of system.
 */
export function BridgeOffline({ system, place }: { system?: string; place?: string }) {
  const { t } = useTranslation();
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
          {t('deviceBridge.offlinePrinter')}
        </span>
        <span className="muted">
          {t('deviceBridge.offlinePrinterMore')}
        </span>
      </div>
    );
  }
  return (
    <div className="dv-about-commands" data-testid="bridge-offline-help">
      <span>
        {known
          ? t('deviceBridge.notRunningOn', { computer: t(os === 'windows' ? 'deviceBridge.onWindowsPc' : os === 'mac' ? 'deviceBridge.onMac' : 'deviceBridge.onLinux') })
          : t('deviceBridge.notRunning')}{' '}
        {os === 'linux' ? t('deviceBridge.startsCheckOn', { when: t(STARTS_WHEN[os]) }) : t('deviceBridge.startsCheckSignedIn', { when: t(STARTS_WHEN[os]) })}{' '}
        {t('deviceBridge.reconnects')}
      </span>
      {!known && <OsTabs os={os} onChange={setOs} tabs={UNINSTALL_TABS} names={UNINSTALL_NAMES} />}
      <span className="muted">{t('deviceBridge.startAgain', { shell: t(SHELL_NAME[os]) })}</span>
      <CopyCommand command={`${BRIDGE_COMMAND[os]} install`} testId="bridge-offline-command" />
      <span className="muted">
        {t('deviceBridge.startsBackground')}
        {os !== 'windows' && (
          <>
            {' '}
            {t('deviceBridge.logSays')} <code>{LOG[os]}</code>.
          </>
        )}{' '}
        {t('deviceBridge.pathNotFound')}
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
  const { t } = useTranslation();
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
        {copied ? `${t('common.copied')} ✓` : t('deviceBridge.copy')}
      </button>
      <pre className="dv-code" data-testid={testId}>
        {command}
      </pre>
    </div>
  );
}

/** Where the bridge can run: a computer, or the printer's own Klipper computer. */
type SetupOs = BridgeOs | 'printer';
const OS_LABEL: Record<SetupOs, string> = { windows: 'deviceBridge.labelWindows', mac: 'deviceBridge.labelMac', linux: 'deviceBridge.labelLinux', printer: 'deviceBridge.onPrinter' };

/** On the test relay: says so, and what it runs now (PR #113, main). */
function TestRelayNote({ relay }: { relay: string }) {
  const { t } = useTranslation();
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
    <Note tone="warn" className="dv-test-note" testId="bridge-test-relay">
      <span className="tag warn">{t('deviceBridge.test')}</span>{' '}
      {testRuns ? (
        <Trans i18nKey={'deviceBridge.testNoteRuns'} values={{ runs: testRuns }} components={C} />
      ) : (
        <Trans i18nKey={'deviceBridge.testNote'} components={C} />
      )}
    </Note>
  );
}

/** Copies this page's address, for someone reading it on a phone who sets the bridge up on a computer. */
function CopyPageLink() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const url = location.origin + location.pathname;
  return (
    <button
      className="quiet"
      onClick={() =>
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {copied ? t('deviceBridge.linkCopied') : t('deviceBridge.copyLink')}
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
  const { t } = useTranslation();
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
      <summary>{t('deviceBridge.didntOpen')}</summary>
      <p className="muted">
        {t('deviceBridge.didntOpenHelp')}
      </p>
      {pasteLink}
    </details>
  );

  if (apps === null) return <p className="muted">{t('deviceBridge.gettingReady')}</p>;
  const win = has('windows-x64');
  const mac = has('mac-arm64');
  const macIntel = has('mac-x64');
  const linux = has('linux-x64') || has('linux-arm64') || has('linux-armv7');
  const offered = (['windows', 'mac', 'linux', 'printer'] as const).filter((k) => (k === 'windows' ? win : k === 'mac' ? mac || macIntel : linux));
  const shown = offered.includes(os) ? os : offered[0];
  if (!shown) {
    return (
      <p className="muted" data-testid="bridge-not-ready">
        {t('deviceBridge.notReady')}
      </p>
    );
  }

  const lastStep = (n: number) => (
    <Step n={n} title={t('deviceBridge.pickPrinter')}>
      <span>
        <Trans i18nKey={'deviceBridge.pickPrinterHelp'} components={C} />
      </span>
    </Step>
  );

  return (
    <div className="dv-bridge-setup">
      <TestRelayNote relay={relay} />
      <p>
        <Trans i18nKey={'deviceBridge.intro'} components={C} />
        <InfoTip label={t('deviceBridge.whyBridge')}>{t('deviceBridge.whyBridgeLong')}</InfoTip>
      </p>
      {system === 'other' && (
        <Note testId="bridge-phone-note">
          {t('deviceBridge.onComputerNotPhone')} <CopyPageLink /> {t('deviceBridge.andOpenThere')}
        </Note>
      )}
      <div className="dv-setup-os">
        <span className="dv-setup-question">{t('deviceBridge.whereRun')}</span>
        <div className="chooser dv-os-tabs" role="tablist" aria-label={t('deviceBridge.bridgeComputer')}>
          {offered.map((k) => (
            <button key={k} role="tab" aria-selected={shown === k} className={shown === k ? 'on' : ''} onClick={() => setOs(k)}>
              {t(OS_LABEL[k])}
            </button>
          ))}
        </div>
      </div>

      <ol className="dv-setup-steps" data-testid={`bridge-steps-${shown}`}>
        {shown === 'windows' && win && (
          <>
            <Step n={1} title={t('deviceBridge.download')}>
              <div>
                <a className="primary dv-big" href={`${relay}/download/windows-x64`} data-testid="bridge-download-windows">
                  {t('deviceBridge.downloadWindows')}
                </a>{' '}
                <span className="muted">{mb(win.size)}</span>
              </div>
            </Step>
            <Step n={2} title={t('deviceBridge.openDownloaded')}>
              <span>{t('deviceBridge.inDownloads')}</span>
              <span className="muted">
                <Trans i18nKey={'deviceBridge.smartScreen'} components={C} />
              </span>
            </Step>
            {lastStep(3)}
          </>
        )}
        {shown === 'mac' && (
          <>
            <Step n={1} title={t('deviceBridge.copyLine')}>
              <CopyStep command={install} testId="bridge-install-command" />
            </Step>
            <Step n={2} title={t('deviceBridge.pasteTerminal')}>
              <span>
                <Trans i18nKey={'deviceBridge.openTerminal'} components={C} />
              </span>
              <span className="muted">
                <Trans i18nKey={'deviceBridge.macAllow'} components={C} />
              </span>
            </Step>
            {lastStep(3)}
          </>
        )}
        {shown === 'linux' && (
          <>
            <Step n={1} title={t('deviceBridge.copyLine')}>
              <CopyStep command={install} testId="bridge-install-command" />
            </Step>
            <Step n={2} title={t('deviceBridge.pasteLinux')}>
              <span className="muted">{t('deviceBridge.piNoScreen')}</span>
            </Step>
            {lastStep(3)}
          </>
        )}
        {shown === 'printer' && (
          <>
            <Step n={1} title={t('deviceBridge.sshStep')}>
              <span>
                <Trans i18nKey={'deviceBridge.sshHow'} values={{ addr: t('deviceBridge.addrSlot') }} components={C} />
              </span>
              <span className="muted">
                <Trans i18nKey={'deviceBridge.sshPasswords'} components={C} />
              </span>
            </Step>
            <Step n={2} title={t('deviceBridge.pasteEnter')}>
              <CopyStep command={onPrinter} testId="bridge-printer-command" />
              <span className="muted">{t('deviceBridge.printerService')}</span>
            </Step>
            <Step n={3} title={t('deviceBridge.openLink')}>
              <span>
                <Trans i18nKey={'deviceBridge.openLinkHelp'} components={C} />
              </span>
              <span className="muted">{t('deviceBridge.u1Update')}</span>
            </Step>
          </>
        )}
      </ol>

      {paste}
      {shown === 'mac' && (
        <details className="dv-node-option">
          <summary>{t('deviceBridge.ratherMacApp')}</summary>
          <div className="dv-about">
            <div className="dv-downloads">
              {mac && (
                <a className="secondary" href={`${relay}/download/mac-arm64`} data-testid="bridge-download-mac">
                  {t('deviceBridge.macApple')}
                </a>
              )}
              {macIntel && (
                <a className="secondary" href={`${relay}/download/mac-x64`}>
                  {t('deviceBridge.macIntel')}
                </a>
              )}
            </div>
            <p className="muted">
              <Trans i18nKey={'deviceBridge.macGatekeeper'} components={C} />
            </p>
          </div>
        </details>
      )}
      <details className="dv-node-option" data-testid="bridge-about">
        <summary>{t('deviceBridge.more')}</summary>
        <div className="dv-about">
          <p>
            <Trans i18nKey={'deviceBridge.keepRunning'} components={C} />
          </p>
          <p>
            <Trans i18nKey={'deviceBridge.addLater'} components={C} />
          </p>
          <ManageCommands />
          <p>{t('deviceBridge.restartsItself')}</p>
          <p>
            <Trans i18nKey={'deviceBridge.isSafe'} components={C} />
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
  const { t } = useTranslation();
  return (
    <>
      <strong>{t('deviceBridge.orDownload')}</strong>
      <span className="dv-setup-download" data-testid="setup-download">
        {children}
        <span>
          {t('deviceBridge.thenPasteCode')} <code>{code}</code>
        </span>
        <button className="quiet" onClick={() => void navigator.clipboard?.writeText(code)}>
          {t('deviceBridge.copy')}
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
  const { t } = useTranslation();
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
          if (live && pairing) return onJoined(pairing, s.name ?? i18n.t('deviceBridge.theBridge'));
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
      <Note tone="error" testId="bridge-setup-problem">
        {problem}
      </Note>
    );
  }
  if (!setup) return <p className="muted">{t('deviceBridge.makingCode')}</p>;
  const c = setupCommands(relay, setup.code);

  return (
    <div className="dv-bridge-setup" data-testid="add-bridge">
      <TestRelayNote relay={relay} />
      <p>{t('deviceBridge.runWhere')}</p>
      {system === 'other' && (
        <Note testId="bridge-phone-note">
          {t('deviceBridge.onComputerCopy')} <CopyPageLink /> {t('deviceBridge.andOpenThere')}
        </Note>
      )}
      {renewed && (
        <div className="dv-bridge-state failed" role="status" data-testid="setup-code-renewed">
          <span className="dv-bridge-state-icon" aria-hidden>
            !
          </span>
          <div>
            <strong>{t('deviceBridge.codeExpired')}</strong>
            <span className="muted">{t('deviceBridge.codeExpiredHelp')}</span>
          </div>
        </div>
      )}
      <div className="chooser dv-os-tabs" role="tablist" aria-label={t('deviceBridge.whereRuns')}>
        {(['windows', 'mac', 'linux', 'printer'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={os === k} className={os === k ? 'on' : ''} onClick={() => setOs(k)}>
            {t(k === 'printer' ? 'deviceBridge.onPrinter' : SYSTEM_NAME[k])}
          </button>
        ))}
      </div>

      <div className="dv-setup-commands" data-testid={`setup-${os}`}>
        {os === 'windows' && (
          <>
            <strong>{t('deviceBridge.inPowershell')}</strong>
            <CopyCommand command={c.powershell} testId="setup-powershell" />
            <details className="dv-node-option">
              <summary>{t('deviceBridge.howPowershell')}</summary>
              <p className="muted">
                <Trans i18nKey={'deviceBridge.openPowershell'} components={C} />
              </p>
            </details>
            <strong>{t('deviceBridge.orCmd')}</strong>
            <CopyCommand command={c.cmd} testId="setup-cmd" />
            <DownloadWithCode code={setup.code}>
              <a className="secondary" href={`${relay}/download/windows-x64`} data-testid="setup-download-windows">
                {t('deviceBridge.downloadWindows')}
              </a>
            </DownloadWithCode>
            <span className="muted">
              <Trans i18nKey={'deviceBridge.smartScreenShort'} components={C} />
            </span>
          </>
        )}
        {os === 'mac' && (
          <>
            <strong>{t('deviceBridge.inTerminal')}</strong>
            <CopyCommand command={c.unix} testId="setup-unix" />
            <span className="muted">
              <Trans i18nKey={'deviceBridge.openTerminalAllow'} components={C} />
            </span>
            <DownloadWithCode code={setup.code}>
              <a className="secondary" href={`${relay}/download/mac-arm64`} data-testid="setup-download-mac">
                {t('deviceBridge.macApple')}
              </a>
              <a className="secondary" href={`${relay}/download/mac-x64`}>
                {t('deviceBridge.macIntel')}
              </a>
            </DownloadWithCode>
            <span className="muted">
              <Trans i18nKey={'deviceBridge.macGatekeeperShort'} components={C} />
            </span>
          </>
        )}
        {os === 'linux' && (
          <>
            <strong>{t('deviceBridge.inLinuxTerminal')}</strong>
            <CopyCommand command={c.unix} testId="setup-unix" />
            <span className="muted">{t('deviceBridge.piSsh')}</span>
          </>
        )}
        {os === 'printer' && (
          <>
            <strong>{t('deviceBridge.inSsh')}</strong>
            <CopyCommand command={c.printer} testId="setup-printer" />
            <span className="muted">
              <Trans i18nKey={'deviceBridge.sshSetup'} values={{ addr: t('deviceBridge.addrSlot') }} components={C} />
            </span>
          </>
        )}
        <span className="dv-setup-code">
          {t('deviceBridge.setupCode')} <code data-testid="setup-code">{setup.code}</code>
          <button className="quiet" onClick={() => void navigator.clipboard?.writeText(setup.code)}>
            {t('deviceBridge.copy')}
          </button>
        </span>
        <span className="muted">{t('deviceBridge.setupCodeHelp')}</span>
      </div>

      <div className="dv-bridge-state connecting" role="status" data-testid="setup-waiting">
        <span className="dv-spinner" aria-hidden />
        <div>
          <strong>{t('deviceBridge.waiting')}</strong>
          <span className="muted">{t('deviceBridge.waitingHelp')}</span>
        </div>
      </div>
    </div>
  );
}

/** Signed out: bridges belong to an account, so adding one starts with signing in. */
export function SignInForBridge() {
  const { t } = useTranslation();
  const status = useAccount((s) => s.status);
  if (status === 'loading') return <p className="muted">{t('deviceBridge.checkingAccount')}</p>;
  return (
    <div className="dv-bridge-setup" data-testid="bridge-sign-in">
      <p>
        <Trans i18nKey={'deviceBridge.introAccount'} components={C} />
        <InfoTip label={t('deviceBridge.whyBridge')}>{t('deviceBridge.whyBridgeShort')}</InfoTip>
      </p>
      <button className="primary dv-big" onClick={() => void useAccount.getState().signIn('google')} data-testid="bridge-sign-in-button">
        {t('deviceScreen.signInToAddBridge')}
      </button>
    </div>
  );
}
