import { useRef } from 'react';
import { useDevice } from '../../state/device';
import { Card, useConfirm } from './parts';

function size(bytes: number) {
  return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function when(seconds: number) {
  const d = new Date(seconds * 1000);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

export function FilesCard() {
  const files = useDevice((s) => s.files);
  const call = useDevice((s) => s.call);
  const openPrintDialog = useDevice((s) => s.openPrintDialog);
  const input = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();

  return (
    <Card
      title="Files on the printer"
      testId="files-card"
      actions={
        <>
          <button className="dv-link" onClick={() => input.current?.click()}>
            Upload G-code…
          </button>
          <input
            ref={input}
            type="file"
            accept=".gcode,.g,.gco"
            hidden
            data-testid="device-gcode-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) openPrintDialog({ kind: 'upload', blob: f, name: f.name });
            }}
          />
        </>
      }
    >
      {files == null ? (
        <p className="muted">…</p>
      ) : files.length === 0 ? (
        <p className="muted">No G-code files yet.</p>
      ) : (
        <ul className="dv-files">
          {files.slice(0, 50).map((f) => (
            <li key={f.path}>
              <span className="dv-file-name" title={f.path}>
                {f.path}
              </span>
              <span className="muted dv-file-meta">
                {size(f.size)} · {when(f.modified)}
              </span>
              <span className="dv-file-actions">
                <button className="dv-link" onClick={() => openPrintDialog({ kind: 'file', path: f.path })}>
                  Print…
                </button>
                <button
                  className="dv-link dv-danger-text"
                  aria-label={`Delete ${f.path}`}
                  onClick={() => confirm({ action: 'Delete file', text: `Delete ${f.path} from the printer?`, danger: true, run: () => void call('Deleted', (s) => s.deleteFile(f.path)) })}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Card>
  );
}
