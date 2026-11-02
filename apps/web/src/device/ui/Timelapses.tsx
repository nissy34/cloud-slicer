// The Files card's Timelapses tab: the printer's timelapse videos, newest
// first. Tap one to watch it (fetched whole, then played), save it, or delete
// it. Row pictures come only when they can be fetched without the relay.
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Film, RefreshCw } from 'lucide-react';
import { currentSession, useDevice } from '../../state/device';
import { Dialog } from '../../components/Dialog';
import { Empty } from '../../components/Empty';
import { Note } from '../../components/Note';
import { PrintLoader } from '../../components/PrintLoader';
import { forgetDownload, keptDownload, playable, videoType, type FileRoute, type Timelapse } from '../timelapse';
import { FILES_PER_PAGE, fileSize, fileWhen } from './FilesCard';

const keyOf = (printer: string | null, t: Timelapse, file: string) => `${printer}:${t.root}/${file}@${t.modified}`;

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
    const s = currentSession();
    const pic = t.picture;
    if (!s || !pic) return;
    let live = true;
    // Never over the relay: no picture beats spending relay data on one.
    const p = keptDownload(keyOf(printer, t, pic), () => s.downloadFile(t.root, pic, 0, { directOnly: true, type: videoType(pic) }) ?? Promise.reject(new Error('no files')));
    p.then((b) => live && setBlob(b)).catch(() => {});
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

function Player({ t, onClose, onDelete }: { t: Timelapse; onClose(): void; onDelete(): void }) {
  const printer = useDevice((s) => s.activeId);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [progress, setProgress] = useState(0);
  const [route, setRoute] = useState<FileRoute | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const s = currentSession();
    if (!s) return setError('Not connected to the printer.');
    let live = true;
    keptDownload(
      keyOf(printer, t, t.path),
      () =>
        s.downloadFile(t.root, t.path, t.size, {
          type: videoType(t.path),
          onProgress: (f) => live && setProgress(f),
          onRoute: (r) => live && setRoute(r),
        }) ?? Promise.reject(new Error('This printer connection cannot fetch videos.')),
    )
      .then((b) => live && setBlob(b))
      .catch((e: Error) => live && setError(e.message || 'The video could not be fetched.'));
    return () => {
      live = false;
    };
  }, [printer, t]);
  const url = useBlobUrl(blob);
  const canPlay = playable(t.path);
  return (
    <Dialog
      title={t.path}
      onClose={onClose}
      wide
      testId="timelapse-player"
      footer={
        <>
          <button className="secondary danger" onClick={onDelete}>
            Delete
          </button>
          {url ? (
            <a className="primary" href={url} download={t.path.split('/').pop()}>
              Save
            </a>
          ) : (
            <button className="primary" disabled>
              Save
            </button>
          )}
        </>
      }
    >
      {error ? (
        <Note tone="error">{error}</Note>
      ) : !url ? (
        <PrintLoader
          loading={{
            label: route === 'relay' ? 'Fetching the video through the relay…' : 'Fetching the video…',
            loaded: progress * t.size,
            total: t.size,
            progress,
          }}
        />
      ) : canPlay ? (
        <video className="dv-timelapse-video" src={url} controls autoPlay playsInline muted data-testid="timelapse-video" />
      ) : (
        <Note>This kind of video doesn’t play in the browser. Save it to watch it.</Note>
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
      forgetDownload(keyOf(printer, t, t.path));
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
