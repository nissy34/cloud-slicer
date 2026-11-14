import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../state/account';
import { bridgeLabel, isPlainBridgeName, useDevice, type SavedBridge, type SavedPrinter } from '../../state/device';
import type { BridgeStatus } from '../link/types';
import type { Pairing } from '../pairing';
import { isTestRelay } from '../config';
import { UninstallBridge } from './BridgeSetup';
import { Dialog } from '../../components/Dialog';
import { removeFromBridge, SELF_REMOVING_FROM, watchBridge, type BridgeWatch } from './PrinterEditor';
import { Note } from '../../components/Note';

/** One saved printer: its name and profile, with Edit and Remove (asked once, inline). */
function PrinterRow({ p, pairing }: { p: SavedPrinter; pairing?: Pairing | null }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const { openEditor, removePrinter, openManage } = useDevice.getState();
  const others = useDevice((s) => s.printers.some((x) => x.id !== p.id && x.kind === 'bridge' && p.kind === 'bridge' && x.bridgeId === p.bridgeId && x.printer === p.printer));
  const remove = async () => {
    setBusy(true);
    // The bridge forgets it too, unless another saved printer still uses it.
    if (p.kind === 'bridge' && pairing && !others) await removeFromBridge(pairing, p.printer);
    await removePrinter(p.id);
  };
  return (
    <li className="dv-manage-printer" data-testid="manage-printer" data-name={p.name}>
      <span>
        <strong>{p.name}</strong> {p.preset && <span className="muted">{p.preset}</span>}
      </span>
      {asking ? (
        <span className="dv-row-actions">
          <span className="muted">{t('deviceManage.removeIt')}</span>
          <button className="quiet" onClick={() => setAsking(false)}>
            {t('deviceManage.no')}
          </button>
          <button className="quiet danger" disabled={busy} onClick={() => void remove()} data-testid="manage-printer-remove-yes">
            {busy ? t('deviceManage.removing') : t('deviceManage.yesRemove')}
          </button>
        </span>
      ) : (
        <span className="dv-row-actions">
          <button
            className="quiet"
            onClick={() => {
              openManage(false);
              void openEditor({ mode: 'edit', id: p.id });
            }}
          >
            {t('deviceManage.edit')}
          </button>
          <button className="quiet danger" onClick={() => setAsking(true)} data-testid="manage-printer-remove">
            {t('deviceManage.remove')}
          </button>
        </span>
      )}
    </li>
  );
}

/** A bridge removed while it couldn't remove itself: how to finish on its computer. */
interface Leftover {
  name: string;
  system?: string;
  place?: string;
  relay?: string;
}

/** One bridge: whether it's running, its printers, and adding to or removing it. */
function BridgeCard({ b, onLeftover }: { b: SavedBridge; onLeftover: (l: Leftover) => void }) {
  const { t } = useTranslation();
  const printers = useDevice((s) => s.printers).filter((p) => p.kind === 'bridge' && p.bridgeId === b.bridgeId);
  const { bridgePairing, saveBridge, removeBridge, openEditor, openManage } = useDevice.getState();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [watch, setWatch] = useState<BridgeWatch | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [latest, setLatest] = useState(0);
  const [updating, setUpdating] = useState<'' | 'asking' | 'restarting'>('');
  const [updateProblem, setUpdateProblem] = useState('');

  useEffect(() => {
    let w: BridgeWatch | null = null;
    let live = true;
    void bridgePairing(b.id).then((p) => {
      if (!live || !p) return;
      setPairing(p);
      w = watchBridge(p, setStatus, () => setStatus((s) => s ?? { agent: 'offline', printers: [] }));
      setWatch(w);
    });
    return () => {
      live = false;
      w?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.id]);

  // A bridge saved before it said which computer it's on gets that name once it does.
  useEffect(() => {
    if (pairing && isPlainBridgeName(b.name) && (status?.host || status?.system)) void saveBridge({ ...b, key: pairing.key, name: bridgeLabel(status) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing, status?.host, status?.system]);

  // The newest bridge the relay has, to offer an update to an older one (bridges also update themselves every few hours).
  useEffect(() => {
    if (!pairing) return;
    let live = true;
    fetch(`${pairing.relay}/downloads.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { build?: number }) => live && setLatest(Number(d.build) || 0))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pairing]);

  const online = status?.agent === 'online';
  const built = Number(status?.build) || 0;
  const outdated = online && built > 0 && latest > built;
  // The bridge came back on the new version.
  useEffect(() => {
    if (updating === 'restarting' && !outdated) setUpdating('');
  }, [updating, outdated]);
  const update = async () => {
    if (!watch) return;
    setUpdating('asking');
    setUpdateProblem('');
    try {
      const r = (await watch.manage('bridge.update', {})) as { updating?: boolean };
      setUpdating(r.updating ? 'restarting' : '');
    } catch (e) {
      setUpdating('');
      setUpdateProblem((e as Error).message);
    }
  };
  const selfRemoving = online && Number(status?.version) >= SELF_REMOVING_FROM;
  const remove = async () => {
    setBusy(true);
    setProblem('');
    let gone = false;
    if (selfRemoving && watch) {
      try {
        await watch.manage('bridge.uninstall', {});
        gone = true;
      } catch (e) {
        setProblem((e as Error).message);
      }
    }
    await removeBridge(b.id);
    if (!gone) onLeftover({ name: b.name, system: status?.system, place: status?.place, relay: pairing?.relay });
  };

  return (
    <section className="card dv-manage-card" data-testid="manage-bridge" data-bridge-id={b.bridgeId}>
      <div className="dv-found-head">
        <span>
          <strong>{b.name}</strong>{' '}
          {isTestRelay(pairing?.relay) && (
            <span className="tag warn" data-testid="manage-bridge-test" title={t('deviceManage.testRelayTip')}>
              {t('deviceManage.test')}
            </span>
          )}{' '}
          <span className={`dv-pill ${online ? 'online' : status ? 'offline' : 'connecting'}`} data-testid="manage-bridge-state">
            {online ? t('deviceManage.running') : status ? t('deviceManage.notRunning') : t('deviceManage.checking')}
          </span>
        </span>
      </div>
      {online && built > 0 && (
        <span className="muted dv-manage-version" data-testid="manage-bridge-version">
          {status?.version ? `${t('deviceManage.version', { version: `${status.version}${status.change ? `.${status.change}` : ''}` })} · ` : ''}
          {t('deviceManage.from', { when: builtWhen(built) })}
          {latest > 0 && ` · ${outdated ? t('deviceManage.newestFrom', { when: builtWhen(latest) }) : t('deviceManage.upToDate')}`}
        </span>
      )}
      {(outdated || updating === 'restarting') && (
        <div className="dv-manage-update" data-testid="manage-bridge-update-row">
          <span className="muted">
            {updating === 'restarting' ? t('deviceManage.updating') : t('deviceManage.updateReady')}
          </span>
          {updating !== 'restarting' && (
            <button className="secondary" disabled={updating === 'asking'} onClick={() => void update()} data-testid="manage-bridge-update">
              {updating === 'asking' ? t('deviceManage.downloading') : t('deviceManage.updateNow')}
            </button>
          )}
          {updateProblem && (
            <Note tone="error">
              {updateProblem}
            </Note>
          )}
        </div>
      )}
      {printers.length ? (
        <ul className="dv-manage-list">
          {printers.map((p) => (
            <PrinterRow key={p.id} p={p} pairing={pairing} />
          ))}
        </ul>
      ) : (
        <p className="muted">{t('deviceManage.noPrinters')}</p>
      )}
      {asking ? (
        <div className="dv-manage-confirm">
          <p>
            {printers.length
              ? t('deviceManage.removeBridgeAndPrinters', { name: b.name, printers: printers.map((p) => p.name).join(', ') })
              : t('deviceManage.removeBridgeQ', { name: b.name })}{' '}
            {selfRemoving
              ? status?.host
                ? t('deviceManage.selfUninstallFrom', { host: status.host })
                : t('deviceManage.selfUninstall')
              : t('deviceManage.notRunningRemove')}
          </p>
          {problem && (
            <Note tone="error">
              {problem}
            </Note>
          )}
          <div className="dv-row-buttons">
            <button className="secondary" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </button>
            <button className="primary danger" disabled={busy} onClick={() => void remove()} data-testid="manage-bridge-remove-yes">
              {busy ? t('deviceManage.removing') : t('deviceManage.removeBridge')}
            </button>
          </div>
        </div>
      ) : (
        <div className="dv-row-buttons dv-manage-actions">
          <button className="secondary danger" onClick={() => setAsking(true)} data-testid="manage-bridge-remove">
            {t('deviceManage.removeBridge')}
          </button>
          <button
            className="primary"
            onClick={() => {
              openManage(false);
              void openEditor({ mode: 'add', bridge: b.id });
            }}
            data-testid="manage-bridge-add"
          >
            {t('deviceManage.addToBridge')}
          </button>
        </div>
      )}
    </section>
  );
}

/** Printers & bridges: every bridge with its printers, and the printers reached directly, each removable on its own. */
export function ManageDialog() {
  const { t } = useTranslation();
  const bridges = useDevice((s) => s.bridges);
  const direct = useDevice((s) => s.printers).filter((p) => p.kind === 'direct');
  const { openManage, openEditor } = useDevice.getState();
  const [leftovers, setLeftovers] = useState<Leftover[]>([]);
  const close = () => openManage(false);
  const accountStatus = useAccount((s) => s.status);
  const signedIn = accountStatus === 'signedIn';
  return (
    <Dialog
      title={t('deviceScreen.printersAndBridges')}
      onClose={close}
      wide
      footer={
        <>
          <button className="secondary" onClick={close}>
            {t('common.close')}
          </button>
          {accountStatus !== 'unavailable' && (
          <button
            className="secondary"
            onClick={() => {
              close();
              if (signedIn) void openEditor({ mode: 'add', newBridge: true });
              else void useAccount.getState().signIn('google');
            }}
            data-testid="add-bridge-button"
          >
            {signedIn ? t('deviceScreen.addBridge') : t('deviceScreen.signInToAddBridge')}
          </button>
          )}
          <button
            className="primary"
            onClick={() => {
              close();
              void openEditor({ mode: 'add' });
            }}
          >
            {t('deviceScreen.addPrinter')}
          </button>
        </>
      }
    >
      <div className="dv-form" data-testid="manage-dialog">
        {leftovers.map((l, i) => (
          <div key={i} className="card dv-manage-card" data-testid="manage-leftover">
            <p>
              <strong>{l.name}</strong> {t('deviceManage.leftover')}
            </p>
            <UninstallBridge system={l.system} place={l.place} relay={l.relay} />
          </div>
        ))}
        <h3 className="dv-manage-title">{t('deviceManage.bridges')}</h3>
        {bridges.length ? (
          bridges.map((b) => <BridgeCard key={b.id} b={b} onLeftover={(l) => setLeftovers((list) => [...list, l])} />)
        ) : (
          <p className="muted">{t('deviceManage.noBridges', { button: accountStatus === 'unavailable' ? t('deviceScreen.addPrinter') : t('deviceScreen.addBridge') })}</p>
        )}
        {direct.length > 0 && (
          <>
            <h3 className="dv-manage-title">{t('deviceManage.overInternet')}</h3>
            <section className="card dv-manage-card">
              <ul className="dv-manage-list">
                {direct.map((p) => (
                  <PrinterRow key={p.id} p={p} />
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** When a bridge was built (its build number is the time of its last change, in seconds), e.g. "22 Oct, 17:16". */
export function builtWhen(build: number): string {
  return new Date(build * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
