import { useRef, useState } from 'react';
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

/** Rows per page, as in Fluidd. The list is newest first (Session.listFiles). */
export const FILES_PER_PAGE = 10;

export function FilesCard() {
  const files = useDevice((s) => s.files);
  const call = useDevice((s) => s.call);
  const openPrintDialog = useDevice((s) => s.openPrintDialog);
  const input = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const shown = files && q ? files.filter((f) => f.path.toLowerCase().includes(q)) : (files ?? []);
  const pages = Math.max(1, Math.ceil(shown.length / FILES_PER_PAGE));
  const at = Math.min(page, pages - 1); // a delete can empty the last page
  const rows = shown.slice(at * FILES_PER_PAGE, (at + 1) * FILES_PER_PAGE);

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
        <>
          {files.length > FILES_PER_PAGE && (
            <input
              className="dv-files-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={`Search ${files.length} files`}
              aria-label="Search files"
              spellCheck={false}
              autoCapitalize="off"
            />
          )}
          {rows.length === 0 && <p className="muted">No file matches “{query.trim()}”.</p>}
          <ul className="dv-files">
            {rows.map((f) => (
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
                    onClick={() =>
                      confirm({
                        action: 'Delete file',
                        text: `Delete ${f.path} from the printer?`,
                        danger: true,
                        run: () => void call('Deleted', (s) => s.deleteFile(f.path)),
                      })
                    }
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav className="dv-pager" aria-label="File pages" data-testid="files-pager">
              <button className="dv-link" disabled={at === 0} onClick={() => setPage(at - 1)}>
                ‹ Newer
              </button>
              <span className="muted">
                {at * FILES_PER_PAGE + 1}–{at * FILES_PER_PAGE + rows.length} of {shown.length}
              </span>
              <button className="dv-link" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>
                Older ›
              </button>
            </nav>
          )}
        </>
      )}
      {dialog}
    </Card>
  );
}
