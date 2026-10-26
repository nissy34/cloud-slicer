import { useEffect, useState } from 'react';
import { useAccount } from '../../state/account';
import { BRIDGE_SIGN_IN, useDevice } from '../../state/device';
import '../../state/alerts';
import { takesCommands } from '../addons';
import { isTestRelay } from '../config';
import { job } from '../status';
import { DeviceCards } from './Arrange';
import { BridgeOffline } from './BridgeSetup';
import { Icon } from './icons';
import { ManageDialog } from './ManageDialog';
import { useConfirm } from './parts';
import { PrintDialog } from './PrintDialog';
import { PrinterEditor } from './PrinterEditor';
import { WorksWith } from './WorksWith';

export function DeviceScreen() {
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

  const model = addons[0]?.model ?? (facts ? 'Klipper printer' : '');
  const agentOffline = active?.kind === 'bridge' && bridge?.agent === 'offline';
  const pill =
    conn.state === 'online' && !agentOffline
      ? { cls: 'online', text: 'Connected' }
      : conn.state === 'connecting'
        ? { cls: 'connecting', text: 'Connecting' }
        : agentOffline
          ? { cls: 'offline', text: 'Bridge offline' }
          : { cls: 'offline', text: 'Offline' };

  return (
    <div className="device" data-testid="device-screen">
      {!active ? (
        <div className="dv-empty">
          <h1>Your printers</h1>
          <p className="muted">Watch your printers, control them and send prints from the slicer.</p>
          <button className="primary" onClick={() => void openEditor({ mode: 'add' })} data-testid="add-printer">
            Add a printer
          </button>
          {accountStatus !== 'unavailable' && (
            <button
              className="secondary"
              onClick={() => (accountStatus === 'signedIn' ? void openEditor({ mode: 'add', newBridge: true }) : void useAccount.getState().signIn('google'))}
              data-testid="add-bridge-button"
            >
              {accountStatus === 'signedIn' ? 'Add a bridge' : 'Sign in to add a bridge'}
            </button>
          )}
          {send && <p className="muted">Add your printer first, then send the plate again.</p>}
          <WorksWith />
          {bridges.length > 0 && (
            <button className="quiet" onClick={() => openManage(true)} data-testid="manage-open">
              Printers &amp; bridges
            </button>
          )}
        </div>
      ) : (
        <>
          <header className="dv-header">
            <div className="dv-printer">
              {/* The printer list ends with Printers & bridges, where printers and bridges are added, edited and removed. */}
              <select value={activeId ?? ''} onChange={(e) => (e.target.value === '__manage' ? openManage(true) : select(e.target.value))} aria-label="Printer" data-testid="printer-select">
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.kind === 'bridge' && isTestRelay(p.relay) ? ' (test)' : ''}
                  </option>
                ))}
                <option disabled>──────────</option>
                <option value="__manage">Printers &amp; bridges…</option>
              </select>
              <span className="muted dv-model">
                {[model, active.kind === 'bridge' ? (isTestRelay(active.relay) ? 'through the test bridge' : 'through the bridge') : facts?.hostname].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className={`dv-pill ${pill.cls}`} data-testid="connection" title={conn.message}>
              {pill.text}
            </span>
            <div className="dv-header-actions">
              {/* Only the cards' layout here; the printer itself is managed from the printer list. */}
              {arranging ? (
                <button className="primary" onClick={() => setArranging(false)} data-testid="arrange-done">
                  Done arranging
                </button>
              ) : (
                <button className="quiet" onClick={() => setArranging(true)} data-testid="arrange-open">
                  <Icon name="arrange" />
                  Arrange cards
                </button>
              )}
              {takesCommands(addons) && (
                <button
                  className="secondary danger"
                  disabled={conn.state !== 'online'}
                  onClick={() =>
                    confirm({
                      action: 'Emergency stop',
                      text: 'Stop all motors and heaters right now? The printer firmware will need a restart afterwards.',
                      danger: true,
                      run: () => void call('Emergency stop sent', (s) => s.emergencyStop()),
                    })
                  }
                >
                  Emergency stop
                </button>
              )}
            </div>
          </header>
          {conn.state !== 'online' && conn.message && (
            <div className="dv-banner" role="status">
              <span>{conn.message}</span>
              {conn.message === BRIDGE_SIGN_IN ? (
                <button className="quiet" onClick={() => void useAccount.getState().signIn('google')}>
                  Sign in
                </button>
              ) : (
                <button className="quiet" onClick={retry}>
                  Try again
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
