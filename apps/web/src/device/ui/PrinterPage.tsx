import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { currentSession, useDevice } from '../../state/device';
import type { Webcam } from '../camera';
import { cameraCardOf, type CamCardId } from '../layout';
import type { PrinterLink } from '../link/types';
import { PageLimit, pageCarrier, pagePath, type PageRoute } from '../printer-page';
import { Card, useFolded } from './parts';

/** True when this link can open a camera's page through the bridge. */
export function canOpenPages(link: PrinterLink): boolean {
  return !!link.pageHolder && !!link.pageFetch;
}

const newSid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '');

/** A camera that is a page on the printer (Moonraker's "iframe", such as paxx12's remote screen). */
export const isPageCamera = (cam: Webcam) => cam.service === 'iframe' && !!cam.streamUrl;

/**
 * A camera's own page (its "iframe" address in Moonraker, such as paxx12's
 * remote screen), through the bridge: taps and clicks in it work as on the
 * printer's network. The page lives on the relay's address in a holder; this
 * side answers its requests through the bridge (src/device/printer-page.ts).
 */
function PageView({ cam, link, onError }: { cam: Webcam; link: PrinterLink; onError(message: string): void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [sid] = useState(newSid);
  const [route, setRoute] = useState<PageRoute>('connecting');
  const [host, setHost] = useState<string | null>(null);
  const error = useRef(onError);
  error.current = onError;
  const path = pagePath(cam.streamUrl);

  useEffect(() => {
    let stale = false;
    void link.pageHolder!().then((h) => !stale && setHost(h));
    return () => {
      stale = true;
    };
  }, [link]);

  useEffect(() => {
    if (!host) return;
    const carrier = pageCarrier(
      { pageFetch: (r) => link.pageFetch!(r), pageOpen: link.pageOpen && ((sdp) => link.pageOpen!(sdp)), pageClose: link.pageClose && ((id) => link.pageClose!(id)) },
      setRoute,
    );
    const channel = new MessageChannel();
    channel.port1.onmessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; message?: string; method?: string; path?: string; headers?: Record<string, string>; body?: ArrayBuffer };
      if (d?.type === 'error') error.current(d.message ?? 'The page could not be opened.');
      if (d?.type !== 'request' || !e.ports[0]) return;
      const reply = e.ports[0];
      carrier
        .fetch({ method: d.method ?? 'GET', path: d.path ?? '/', headers: d.headers ?? {}, body: d.body })
        .then((a) => reply.postMessage({ status: a.status, headers: a.headers, body: a.body }, [a.body]))
        .catch((err: Error) => {
          if (err instanceof PageLimit) error.current(err.message);
          reply.postMessage({ error: err.message });
        })
        .finally(() => reply.close());
    };
    const el = frame.current;
    const hello = () => el?.contentWindow?.postMessage({ type: 'cloud-slicer-page', path }, new URL(host).origin, [channel.port2]);
    el?.addEventListener('load', hello, { once: true });
    return () => {
      el?.removeEventListener('load', hello);
      channel.port1.close();
      carrier.close();
    };
  }, [link, host, path]);

  return (
    <div className="dv-page" style={{ '--aspect': String(cam.aspect) } as CSSProperties} data-testid="printer-page" data-route={route}>
      {host && <iframe ref={frame} src={`${host}/page/shell.html?sid=${sid}`} title={`${cam.name} page`} allow="fullscreen" referrerPolicy="no-referrer" />}
    </div>
  );
}

/** True while the browser tab is in front; a page card stops while it is hidden. */
function useTabVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * A page card: one camera's own page, live on the Device tab and tappable.
 * Choose picks which page; that camera then leaves the camera cards.
 * Through the bridge the page runs in the relay's holder (PageView); on a direct
 * printer it is framed straight from the printer.
 */
export function PageCard({ card, home, onPick }: { card: CamCardId; home: Record<string, CamCardId>; onPick(name: string): void }) {
  const online = useDevice((s) => s.conn.state === 'online');
  const facts = useDevice((s) => s.facts);
  const visible = useTabVisible();
  const folded = useFolded();
  const [choosing, setChoosing] = useState(false);
  const [pages, setPages] = useState<Webcam[] | null>(null);
  const [error, setError] = useState('');
  // A new try (after the relay's data limit) starts a fresh page.
  const [round, setRound] = useState(0);
  const session = currentSession();

  useEffect(() => {
    const s = currentSession();
    setPages(null);
    if (!online || !s || !facts) return;
    let stale = false;
    void s.webcams().then((list) => !stale && setPages(list.filter(isPageCamera)));
    return () => {
      stale = true;
    };
  }, [online, facts]);

  const cam = pages?.find((c) => cameraCardOf({ cameraHome: home }, c.name) === card) ?? null;
  const pick = (name: string) => {
    onPick(name);
    setChoosing(false);
    setError('');
  };
  const link = session?.link;
  const viaBridge = !!link && link.mediaUrl('/') === null;
  const direct = cam && link && !viaBridge ? link.mediaUrl(cam.streamUrl) : null;
  const running = !folded && visible && online && !!cam && !error;

  return (
    <Card
      title={cam?.name ?? 'Page card'}
      className="dv-page-card"
      testId={`page-card-${card.slice(card.indexOf(':') + 1)}`}
      actions={
        <>
          {pages && pages.length > 0 && (cam ? pages.length > 1 : true) && (
            <button className="dv-link" onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
              {choosing ? 'Done' : 'Choose'}
            </button>
          )}
        </>
      }
    >
      {(choosing || (!cam && pages && pages.length > 0)) && (
        <fieldset className="dv-camera-pick" data-testid="page-pick">
          <legend>Show this page</legend>
          {pages!.map((c) => (
            <label key={c.id}>
              <input type="radio" name={`page-${card}`} checked={cam?.name === c.name} onChange={() => pick(c.name)} />
              {c.name}
              {cameraCardOf({ cameraHome: home }, c.name) !== 'camera' && cameraCardOf({ cameraHome: home }, c.name) !== card && <span className="muted"> (in another card)</span>}
            </label>
          ))}
        </fieldset>
      )}
      {cam && running && link ? (
        viaBridge ? (
          canOpenPages(link) ? (
            <PageView key={`${cam.id}-${round}`} cam={cam} link={link} onError={setError} />
          ) : (
            <div className="dv-camera">
              <span className="muted">Update the bridge to show printer pages.</span>
            </div>
          )
        ) : direct ? (
          <div className="dv-page" style={{ '--aspect': String(cam.aspect) } as CSSProperties} data-testid="printer-page" data-route="printer">
            <iframe src={direct} title={`${cam.name} page`} allow="fullscreen" referrerPolicy="no-referrer" {...{ credentialless: '' }} />
          </div>
        ) : null
      ) : (
        <div className="dv-camera">
          <span className="muted">
            {!online
              ? 'Not connected'
              : !pages
                ? 'Looking for pages…'
                : !pages.length
                  ? 'This printer has no page set up in Moonraker. A page is a camera with the "iframe" service, such as a printer screen.'
                  : !cam
                    ? 'Pick the page to show here.'
                    : error
                        ? error
                        : 'Paused'}
          </span>
          {error && (
            <button
              className="dv-link"
              onClick={() => {
                setError('');
                setRound(round + 1);
              }}
              data-testid="page-again"
            >
              Keep going
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
