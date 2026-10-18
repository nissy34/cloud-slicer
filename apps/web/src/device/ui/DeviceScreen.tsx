import { useEffect } from 'react';
import { useDevice } from '../../state/device';
import { BridgeOffline } from './BridgeSetup';
import { CameraCard } from './CameraCard';
import { ClimateCard } from './ClimateCard';
import { ConsoleCard } from './ConsoleCard';
import { FilesCard } from './FilesCard';
import { JobCard } from './JobCard';
import { ManageDialog } from './ManageDialog';
import { MotionCard } from './MotionCard';
import { useConfirm } from './parts';
import { PrintDialog } from './PrintDialog';
import { PrinterEditor } from './PrinterEditor';
import { ToolheadsCard } from './ToolheadsCard';

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
  const toast = useDevice((s) => s.toast);
  const { select, openEditor, openManage, call, retry } = useDevice.getState();
  const active = printers.find((p) => p.id === activeId);
  const { confirm, dialog } = useConfirm();

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
          <p className="muted">Add a Snapmaker U1, or any Klipper printer with Moonraker, to watch the camera, control it and send prints from the slicer.</p>
          <button className="primary" onClick={() => void openEditor({ mode: 'add' })} data-testid="add-printer">
            Add a printer
          </button>
          {send && <p className="muted">Add your printer first, then send the plate again.</p>}
          {bridges.length > 0 && (
            <button className="dv-link" onClick={() => openManage(true)} data-testid="manage-open">
              Printers &amp; bridges
            </button>
          )}
        </div>
      ) : (
        <>
          <header className="dv-header">
            <div className="dv-printer">
              <select value={activeId ?? ''} onChange={(e) => (e.target.value === '__add' ? void openEditor({ mode: 'add' }) : select(e.target.value))} aria-label="Printer" data-testid="printer-select">
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="__add">Add a printer…</option>
              </select>
              <span className="muted dv-model">{[model, active.kind === 'bridge' ? 'through the bridge' : facts?.hostname].filter(Boolean).join(' · ')}</span>
            </div>
            <span className={`dv-pill ${pill.cls}`} data-testid="connection" title={conn.message}>
              {pill.text}
            </span>
            <div className="dv-header-actions">
              <button className="dv-link" onClick={() => void openEditor({ mode: 'edit', id: active.id })}>
                Edit
              </button>
              <button className="dv-link" onClick={() => openManage(true)} data-testid="manage-open">
                Printers &amp; bridges
              </button>
              <button
                className="secondary dv-danger-text"
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
            </div>
          </header>
          {conn.state !== 'online' && conn.message && (
            <div className="dv-banner" role="status">
              <span>{conn.message}</span>
              <button className="dv-link" onClick={retry}>
                Try again
              </button>
            </div>
          )}
          {agentOffline && (
            <div className="dv-banner dv-banner-help" role="status">
              <BridgeOffline system={bridge?.system} app={bridge?.app} />
            </div>
          )}
          {/* Two columns on wide screens; one on phones, where CSS order interleaves them. */}
          <div className="dv-cols">
            <div className="dv-col dv-col-main">
              <CameraCard />
              <div className="dv-pair">
                <ClimateCard />
                <MotionCard />
              </div>
              <ConsoleCard />
            </div>
            <div className="dv-col dv-col-side">
              <JobCard />
              <ToolheadsCard />
              <FilesCard />
            </div>
          </div>
        </>
      )}
      {send && active && <PrintDialog key={send.kind === 'upload' ? send.name : send.path} source={send} />}
      {manageOpen && <ManageDialog />}
      {editor && <PrinterEditor key={editor.mode === 'edit' ? editor.id : 'add'} />}
      {dialog}
      {toast && (
        <div className={`dv-toast${toast.error ? ' error' : ''}`} role={toast.error ? 'alert' : 'status'} data-testid="device-toast">
          {toast.text}
        </div>
      )}
    </div>
  );
}
