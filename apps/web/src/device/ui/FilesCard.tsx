import { useEffect, useRef, useState } from 'react';
import { formatDuration, formatGrams } from '../../lib/format';
import { metaFromMoonraker, thumbnailUrl, type GcodeMeta } from '../gcode-meta';
import type { GcodeFile } from '../session';
import { currentSession, useDevice } from '../../state/device';
import { Card, useConfirm } from './parts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Swatch } from '../../components/Swatch';

function size(bytes: number) {
  return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function when(seconds: number) {
  const d = new Date(seconds * 1000);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

interface FileDetails {
  meta: GcodeMeta;
  /** Object URL of the slicer thumbnail, or null when the file has none. */
  thumb: string | null;
}

// Moonraker has already read every file's slicer comments and thumbnails, so a
// row costs one metadata call plus one small image, made only for the rows on
// screen and kept for the session (a changed file has a new mtime, a new key).
const details = new Map<string, Promise<FileDetails | null>>();

function loadDetails(f: GcodeFile): Promise<FileDetails | null> {
  const key = `${f.path}@${f.modified}`;
  let p = details.get(key);
  if (!p) {
    const s = currentSession();
    if (!s) return Promise.resolve(null);
    p = s.metadata(f.path).then(async (m) => {
      // Moonraker reads a new upload's metadata a moment after it lands: ask again next time.
      if (!m) details.delete(key);
      const url = thumbnailUrl(m, f.path);
      const blob = url ? await s.thumbnail(url).catch(() => null) : null;
      return { meta: metaFromMoonraker(m), thumb: blob ? URL.createObjectURL(blob) : null };
    });
    details.set(key, p);
  }
  return p;
}

function useDetails(f: GcodeFile) {
  const [d, setD] = useState<FileDetails | null>(null);
  useEffect(() => {
    let live = true;
    setD(null);
    void loadDetails(f).then((v) => live && setD(v));
    return () => {
      live = false;
    };
  }, [f.path, f.modified]); // eslint-disable-line react-hooks/exhaustive-deps
  return d;
}

function FileRow({ file: f, onPrint, onDelete }: { file: GcodeFile; onPrint(): void; onDelete(): void }) {
  const d = useDetails(f);
  const grams = d?.meta.filaments.reduce((t, x) => t + x.grams, 0) ?? 0;
  const materials = [...new Set(d?.meta.filaments.map((x) => x.material).filter(Boolean))].join(' + ');
  return (
    <li>
      <span className="dv-file-thumb" aria-hidden="true">
        {d?.thumb ? <img src={d.thumb} alt="" /> : null}
      </span>
      <span className="dv-file-name" title={`${f.path} · ${size(f.size)}`}>
        {f.path}
      </span>
      <span className="muted dv-file-meta" data-testid="file-meta">
        {d?.meta.estimatedSeconds ? <span>{formatDuration(d.meta.estimatedSeconds)}</span> : null}
        {d?.meta.filaments.length ? (
          <span className="dv-file-filaments" title={d.meta.filaments.map((x) => `T${x.index} ${x.material} ${formatGrams(x.grams)}`).join(', ')}>
            {d.meta.filaments.map((x) => (
              <Swatch key={x.index} colour={x.colour} size="sm" />
            ))}
            {materials}
            {grams > 0 ? ` ${formatGrams(grams)}` : ''}
          </span>
        ) : null}
        <span>{when(f.modified)}</span>
      </span>
      <span className="dv-file-actions">
        <button className="quiet" onClick={onPrint}>
          Print…
        </button>
        <button className="quiet danger" aria-label={`Delete ${f.path}`} onClick={onDelete}>
          Delete
        </button>
      </span>
    </li>
  );
}

/** Rows per page, as in Fluidd. The list is newest first (Session.listFiles). */
export const FILES_PER_PAGE = 10;

export function FilesCard() {
  const files = useDevice((s) => s.files);
  const call = useDevice((s) => s.call);
  const openPrintDialog = useDevice((s) => s.openPrintDialog);
  const addons = useDevice((s) => s.addons);
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
          <button className="quiet" onClick={() => input.current?.click()}>
            Upload G-code…
          </button>
          <input
            ref={input}
            type="file"
            accept={['.gcode', '.g', '.gco', ...addons.flatMap((a) => a.uploads ?? [])].join(',')}
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
              <FileRow
                key={f.path}
                file={f}
                onPrint={() => openPrintDialog({ kind: 'file', path: f.path })}
                onDelete={() => confirm({ action: 'Delete file', text: `Delete ${f.path} from the printer?`, danger: true, run: () => void call('Deleted', (s) => s.deleteFile(f.path)) })}
              />
            ))}
          </ul>
          {pages > 1 && (
            <nav className="dv-pager" aria-label="File pages" data-testid="files-pager">
              <button className="quiet" disabled={at === 0} onClick={() => setPage(at - 1)}>
                <ChevronLeft size={14} aria-hidden /> Newer
              </button>
              <span className="muted">
                {at * FILES_PER_PAGE + 1}–{at * FILES_PER_PAGE + rows.length} of {shown.length}
              </span>
              <button className="quiet" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>
                Older <ChevronRight size={14} aria-hidden />
              </button>
            </nav>
          )}
        </>
      )}
      {dialog}
    </Card>
  );
}
