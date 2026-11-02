// The Files card's Timelapses tab: the printer's timelapse videos, newest
// first. Tap one to watch it (fetched whole, then played, as Fluidd does),
// download it, or delete it. Row pictures come only when they can be
// fetched without the relay.
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Film, RefreshCw } from 'lucide-react';
import { currentSession, useDevice } from '../../state/device';
import { Dialog } from '../../components/Dialog';
import { Empty } from '../../components/Empty';
import { Note } from '../../components/Note';
import { forgetSource, playable, videoSource, videoType, VideoSource, type FileRoute, type Timelapse } from '../timelapse';
import { FILES_PER_PAGE, fileSize, fileWhen } from './FilesCard';

const keyOf = (printer: string | null, t: Timelapse, file: string) => `${printer}:${t.root}/${file}@${t.modified}`;
const nameOf = (path: string) => path.split('/').pop() ?? path;

/** The file's pieces, shared by the player, Download and the next visit; null when this connection can't fetch files. */
function sourceFor(printer: string | null, t: Timelapse, file: string, size: number, directOnly = false): VideoSource | null {
  const s = currentSession();
  const read = s?.fileReader(t.root, file);
  if (!read) return null;
  return videoSource(keyOf(printer, t, file), () => new VideoSource(read, size, videoType(file), directOnly));
}

function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function RowPicture({ t }: { t: Timelapse }) {
  const printer = useDevice((s) => s.activeId);
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    // Never over the relay: no picture beats spending relay data on one.
    const src = t.picture ? sourceFor(printer, t, t.picture, 0, true) : null;
    if (!src) return;
    let live = true;
    src.all().then((b) => live && setBlob(b), () => {});
    return () => {
      live = false;
    };
  }, [printer, t]);
  const url = useBlobUrl(blob);
  return (
    <span className="dv-file-thumb" aria-hidden="true">
      {url ? <img src={url} alt="" /> : <Film size={18} className="dv-file-thumb-icon" />}
    </span>
  );
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);

/** A thin bar and "3.1 of 12 MB" in the dark video box while the video arrives. */
function Arriving({ fraction, size, route }: { fraction: number; size: number; route: FileRoute | null }) {
  const via = route === 'relay' ? ' through the relay' : '';
  return (
    <div className="dv-timelapse-arriving" role="status">
      <div className="dv-timelapse-bar">
        <span style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <span>{`${mb(fraction * size)} of ${mb(size)} MB${via}`}</span>
    </div>
  );
}

function Player({ t, onClose, onDelete }: { t: Timelapse; onClose(): void; onDelete(): void }) {
  const printer = useDevice((s) => s.activeId);
  const canPlay = playable(t.path);
  const [src] = useState(() => sourceFor(printer, t, t.path, t.size));
  // The whole video, fetched before it plays (as Fluidd does); Download hands over the same copy.
  const [fraction, setFraction] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const url = useBlobUrl(blob);
  const [route, setRoute] = useState<FileRoute | null>(src?.route ?? null);
  const [error, setError] = useState(src ? '' : 'This printer connection cannot fetch videos.');

  useEffect(() => {
    if (!src) return;
    src.onRoute = setRoute;
    let live = true;
    src.all((f) => live && setFraction(f)).then(
      (b) => live && setBlob(b),
      (e: Error) => live && setError(e.message || 'The video could not be fetched.'),
    );
    return () => {
      live = false;
      src.onRoute = undefined;
    };
  }, [src]);

  return (
    <Dialog
      title={<span className="dv-timelapse-title">{nameOf(t.path)}</span>}
      onClose={onClose}
      wide
      testId="timelapse-player"
      footer={
        <>
          <button className="secondary danger" onClick={onDelete} disabled={!blob && !error}>
            Delete
          </button>
          {url ? (
            <a className="primary" href={url} download={nameOf(t.path)}>
              Download
            </a>
          ) : (
            <button className="primary" disabled>
              Download
            </button>
          )}
        </>
      }
    >
      {error ? (
        <Note tone="error">{error}</Note>
      ) : !url ? (
        <div className="dv-timelapse-stage">
          <Arriving fraction={fraction} size={t.size} route={route} />
        </div>
      ) : canPlay ? (
        <div className="dv-timelapse-stage">
          <video className="dv-timelapse-video" src={url} controls autoPlay playsInline muted data-testid="timelapse-video" />
        </div>
      ) : (
        <Note>This kind of video doesn’t play in the browser. Download it to watch it.</Note>
      )}
    </Dialog>
  );
}

export function TimelapseList({ list, onRefresh, onDeleted }: { list: Timelapse[]; onRefresh(): void; onDeleted(t: Timelapse): void }) {
  const call = useDevice((s) => s.call);
  const printer = useDevice((s) => s.activeId);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Timelapse | null>(null);
  const [deleting, setDeleting] = useState<Timelapse | null>(null);
  const pages = Math.max(1, Math.ceil(list.length / FILES_PER_PAGE));
  const at = Math.min(page, pages - 1);
  const rows = list.slice(at * FILES_PER_PAGE, (at + 1) * FILES_PER_PAGE);

  const remove = async (t: Timelapse) => {
    setDeleting(null);
    setOpen(null);
    if (await call('Deleted', (s) => s.deleteTimelapse(t))) {
      forgetSource(keyOf(printer, t, t.path));
      if (t.picture) forgetSource(keyOf(printer, t, t.picture));
      onDeleted(t);
    }
  };

  return (
    <>
      {list.length === 0 ? (
        <Empty icon={Film} text="No timelapses yet. Turn on Timelapse when you start a print." />
      ) : (
        <ul className="dv-files" data-testid="timelapse-list">
          {rows.map((t) => (
            <li key={`${t.root}/${t.path}`}>
              <RowPicture t={t} />
              <button className="dv-file-name dv-timelapse-name" title={`${t.path} · ${fileSize(t.size)}`} onClick={() => setOpen(t)}>
                {t.path}
              </button>
              <span className="muted dv-file-meta">
                <span>{fileWhen(t.modified)}</span>
                <span>{fileSize(t.size)}</span>
              </span>
              <span className="dv-file-actions">
                <button className="quiet" onClick={() => setOpen(t)}>
                  Watch
                </button>
                <button className="quiet danger" aria-label={`Delete ${t.path}`} onClick={() => setDeleting(t)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <nav className="dv-pager" aria-label="Timelapse pages">
        {pages > 1 ? (
          <>
            <button className="quiet" disabled={at === 0} onClick={() => setPage(at - 1)}>
              <ChevronLeft size={14} aria-hidden /> Newer
            </button>
            <span className="muted">
              {at * FILES_PER_PAGE + 1}–{at * FILES_PER_PAGE + rows.length} of {list.length}
            </span>
            <button className="quiet" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>
              Older <ChevronRight size={14} aria-hidden />
            </button>
          </>
        ) : (
          <span />
        )}
        <button className="quiet" onClick={onRefresh}>
          <RefreshCw size={14} aria-hidden /> Refresh
        </button>
      </nav>
      {open && <Player t={open} onClose={() => setOpen(null)} onDelete={() => setDeleting(open)} />}
      {deleting && (
        <Dialog
          title="Delete timelapse"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="secondary" onClick={() => setDeleting(null)}>
                Keep going
              </button>
              <button className="primary danger" onClick={() => void remove(deleting)}>
                Delete timelapse
              </button>
            </>
          }
        >
          <p>Delete {deleting.path} from the printer?</p>
        </Dialog>
      )}
    </>
  );
}
