import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Picker } from '../../components/Picker';
import { Settings } from 'lucide-react';
import { useAccount } from '../../state/account';
import { bridgeSignIn, useDevice } from '../../state/device';
import '../../state/alerts';
import { takesCommands } from '../addons';
import { isTestRelay } from '../config';
import { job } from '../status';
import { DeviceCards } from './Arrange';
import { BridgeOffline } from './BridgeSetup';
import { Printer } from 'lucide-react';
import { Icon } from './icons';
import { ManageDialog } from './ManageDialog';
import { useConfirm } from './parts';
import { PrintDialog } from './PrintDialog';
import { PrinterEditor } from './PrinterEditor';
import { WorksWith } from './WorksWith';
import { Empty } from '../../components/Empty';

export function DeviceScreen() {
  const { t } = useTranslation();
  useEffect(() => useDevice.getState().start(), []);
  const printers = useDevice((s) => s.printers);
  const activeId = useDevice((s) => s.activeId);
  const conn = useDevice((s) => s.conn);
  const facts = useDevice((s) => s.facts);
  const addons = useDevice((s) => s.addons);
  const bridge = useDevice((s) => s.bridge);
  const send = useDevice((s) => s.send);
  const editor = useDevice((s) => s.editor);
  const manageOpen = useDevice((s) => s.manageOpen);
  const bridges = useDevice((s) => s.bridges);
  // Phones, until the cards are arranged by hand: while printing or paused the print job sits under the camera, otherwise the move controls do.
  const busy = useDevice((s) => ['printing', 'paused'].includes(job(s.objects).state));
  const accountStatus = useAccount((s) => s.status);
  const { select, openEditor, openManage, call, retry } = useDevice.getState();
  const active = printers.find((p) => p.id === activeId);
  const { confirm, dialog } = useConfirm();
  const [arranging, setArranging] = useState(false);

  const model = addons[0]?.model ?? (facts ? t('deviceScreen.klipperPrinter') : '');
  const agentOffline = active?.kind === 'bridge' && bridge?.agent === 'offline';
  const pill =
    conn.state === 'online' && !agentOffline
      ? { cls: 'online', text: t('deviceScreen.connected') }
      : conn.state === 'connecting'
        ? { cls: 'connecting', text: t('deviceScreen.connecting') }
        : agentOffline
          ? { cls: 'offline', text: t('deviceScreen.bridgeOffline') }
          : { cls: 'offline', text: t('deviceScreen.offline') };

  return (
    <div className="device" data-testid="device-screen">
      {!active ? (
        <Empty
          icon={Printer}
          className="dv-empty"
          title={t('deviceScreen.yourPrinters')}
          text={t('deviceScreen.emptyText')}
          action={
            <button className="primary" onClick={() => void openEditor({ mode: 'add' })} data-testid="add-printer">
              {t('deviceScreen.addPrinter')}
            </button>
          }
        >
          {accountStatus !== 'unavailable' && (
            <button
              className="secondary"
              onClick={() => (accountStatus === 'signedIn' ? void openEditor({ mode: 'add', newBridge: true }) : void useAccount.getState().signIn('google'))}
              data-testid="add-bridge-button"
            >
              {accountStatus === 'signedIn' ? t('deviceScreen.addBridge') : t('deviceScreen.signInToAddBridge')}
            </button>
          )}
          {send && <p className="muted">{t('deviceScreen.addFirst')}</p>}
          <WorksWith />
          {bridges.length > 0 && (
            <button className="quiet" onClick={() => openManage(true)} data-testid="manage-open">
              {t('deviceScreen.printersAndBridges')}
            </button>
          )}
        </Empty>
      ) : (
        <>
          <header className="dv-header">
            <div className="dv-printer">
              {/* The printer list ends with Printers & bridges, where printers and bridges are added, edited and removed. */}
              <Picker
                label={t('deviceScreen.printer')}
                value={activeId}
                options={printers.map((p) => ({ value: p.id, label: p.name + (p.kind === 'bridge' && isTestRelay(p.relay) ? ` ${t('deviceScreen.testSuffix')}` : '') }))}
                onChange={select}
                actions={[{ id: 'manage', label: t('deviceScreen.printersAndBridgesMenu'), icon: Settings, testId: 'manage-open' }]}
                onAction={() => openManage(true)}
                className="dv-printer-picker"
                testId="printer-select"
              />
              <span className="muted dv-model">
                {[model, active.kind === 'bridge' ? (isTestRelay(active.relay) ? t('deviceScreen.throughTestBridge') : t('deviceScreen.throughBridge')) : facts?.hostname].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className={`dv-pill ${pill.cls}`} data-testid="connection" title={conn.message}>
              {pill.text}
            </span>
            <div className="dv-header-actions">
              {/* Only the cards' layout here; the printer itself is managed from the printer list. */}
              {arranging ? (
                <button className="primary" onClick={() => setArranging(false)} data-testid="arrange-done">
                  {t('deviceScreen.doneArranging')}
                </button>
              ) : (
                <button className="quiet" onClick={() => setArranging(true)} data-testid="arrange-open">
                  <Icon name="arrange" />
                  {t('deviceScreen.arrangeCards')}
                </button>
              )}
              {takesCommands(addons) && (
                <button
                  className="secondary danger"
                  disabled={conn.state !== 'online'}
                  onClick={() =>
                    confirm({
                      action: t('deviceScreen.emergencyStop'),
                      text: t('deviceScreen.emergencyStopText'),
                      danger: true,
                      run: () => void call(t('deviceScreen.emergencyStopSent'), (s) => s.emergencyStop()),
                    })
                  }
                >
                  {t('deviceScreen.emergencyStop')}
                </button>
              )}
            </div>
          </header>
          {conn.state !== 'online' && conn.message && (
            <div className="dv-banner" role="status">
              <span>{conn.message}</span>
              {conn.message === bridgeSignIn() ? (
                <button className="quiet" onClick={() => void useAccount.getState().signIn('google')}>
                  {t('deviceScreen.signIn')}
                </button>
              ) : (
                <button className="quiet" onClick={retry}>
                  {t('deviceScreen.tryAgain')}
                </button>
              )}
            </div>
          )}
          {agentOffline && (
            <div className="dv-banner dv-banner-help" role="status">
              <BridgeOffline system={bridge?.system} place={bridge?.place} />
            </div>
          )}
          <DeviceCards key={active.id} printer={active} busy={busy} arranging={arranging} />
        </>
      )}
      {send && active && <PrintDialog key={send.kind === 'upload' ? send.name : send.path} source={send} />}
      {manageOpen && <ManageDialog />}
      {editor && <PrinterEditor key={editor.mode === 'edit' ? editor.id : 'add'} />}
      {dialog}
    </div>
  );
}
