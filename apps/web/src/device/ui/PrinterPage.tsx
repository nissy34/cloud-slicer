import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Webcam } from '../camera';
import type { PrinterLink } from '../link/types';
import { PageLimit, pageCarrier, pagePath, type PageRoute } from '../printer-page';
import { Dialog } from './parts';

/** True when this link can open a camera's page through the bridge. */
export function canOpenPages(link: PrinterLink): boolean {
  return !!link.pageHolder && !!link.pageFetch;
}

const newSid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '');

/**
 * A camera's own page (its "iframe" address in Moonraker, such as paxx12's
 * remote screen), opened through the bridge: taps and clicks in it work as on
 * the printer's network. The page lives on the relay's address in a holder;
 * this side answers its requests through the bridge (src/device/printer-page.ts).
 */
export function PrinterPageDialog({ cam, link, onClose }: { cam: Webcam; link: PrinterLink; onClose(): void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [sid] = useState(newSid);
  const [error, setError] = useState('');
  const [route, setRoute] = useState<PageRoute>('connecting');
  const [host, setHost] = useState<string | null>(null);
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
      if (d?.type === 'error') setError(d.message ?? 'The page could not be opened.');
      if (d?.type !== 'request' || !e.ports[0]) return;
      const reply = e.ports[0];
      carrier
        .fetch({ method: d.method ?? 'GET', path: d.path ?? '/', headers: d.headers ?? {}, body: d.body })
        .then((a) => reply.postMessage({ status: a.status, headers: a.headers, body: a.body }, [a.body]))
        .catch((err: Error) => {
          if (err instanceof PageLimit) setError(err.message);
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
    <Dialog title={cam.name} onClose={onClose} className="dv-page-dialog">
      <div className="dv-page" style={{ '--aspect': String(cam.aspect) } as CSSProperties} data-testid="printer-page" data-route={route}>
        {host && <iframe ref={frame} src={`${host}/page/shell.html?sid=${sid}`} title={`${cam.name} page`} allow="fullscreen" referrerPolicy="no-referrer" />}
      </div>
      {error && (
        <p className="dv-error" role="alert" data-testid="printer-page-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
