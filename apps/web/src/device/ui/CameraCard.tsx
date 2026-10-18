import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { currentSession, useDevice } from '../../state/device';
import { cameraTransform, cameraViews, type CameraView, type Webcam } from '../camera';
import type { CameraHints } from '../addons/types';
import type { PrinterSession } from '../session';
import { playWebrtc } from '../webrtc';
import { Card } from './parts';

/**
 * A camera's own player page can only be framed by this cross-origin isolated
 * page as a credentialless iframe, which only Chromium browsers support.
 * Elsewhere the camera falls back to snapshots.
 */
const IFRAMES_ALLOWED =
  typeof window === 'undefined' || !window.crossOriginIsolated || (typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype);

/** True while the page is in front; cameras stop streaming when it is hidden. */
function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

const NONE: string[] = [];

const builtinCamera = (hint: CameraHints): Webcam => ({
  id: 'builtin',
  name: hint.name,
  service: 'mjpegstreamer-adaptive',
  streamUrl: '',
  snapshotUrl: hint.snapshotUrl,
  targetFps: hint.fps,
  flipH: false,
  flipV: false,
  rotation: 0,
  aspect: 4 / 3,
});

/**
 * Every camera Moonraker lists, each as a live stream when it has one
 * (MJPEG, WebRTC or its own player page) and as snapshots otherwise. A
 * printer with no [webcam] sections falls back to its add-on's built-in
 * camera. Nothing streams while the card is off or the page is hidden.
 */
export function CameraCard() {
  const online = useDevice((s) => s.conn.state === 'online');
  const addons = useDevice((s) => s.addons);
  const facts = useDevice((s) => s.facts);
  const visible = usePageVisible();
  const [on, setOn] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const hidden = useDevice((s) => s.printers.find((p) => p.id === s.activeId)?.hiddenCameras ?? NONE);
  const [cams, setCams] = useState<Webcam[] | null>(null);
  const [hint, setHint] = useState<CameraHints | null>(null);
  const session = currentSession();

  useEffect(() => {
    const s = currentSession();
    setCams(null);
    setHint(null);
    if (!online || !s || !facts) return;
    let stale = false;
    void s.webcams().then((list) => {
      if (stale) return;
      const builtin = list.length ? null : (addons.map((a) => a.camera).find(Boolean) ?? null);
      setHint(builtin);
      setCams(builtin ? [builtinCamera(builtin)] : list);
    });
    return () => {
      stale = true;
    };
  }, [online, facts, addons]);

  const active = on && visible && online && !!session;
  const shown = cams?.filter((c) => !hidden.includes(c.name)) ?? null;
  const toggle = (name: string, show: boolean) => void useDevice.getState().setHiddenCameras(show ? hidden.filter((n) => n !== name) : [...hidden, name]);
  useKeepalive(active ? session : null, hint?.keepalive);

  return (
    <Card
      title={shown && shown.length > 1 ? 'Cameras' : 'Camera'}
      className="dv-camera-card"
      testId="camera-card"
      actions={
        <>
          {cams && cams.length > 1 && (
            <button className="dv-link" onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
              {choosing ? 'Done' : 'Choose'}
            </button>
          )}
          <button className="dv-link" onClick={() => setOn(!on)}>
            {on ? 'Turn off' : 'Turn on'}
          </button>
        </>
      }
    >
      {choosing && cams && cams.length > 1 && (
        <fieldset className="dv-camera-pick" data-testid="camera-pick">
          <legend>Show these cameras</legend>
          {cams.map((c) => (
            <label key={c.id}>
              <input type="checkbox" checked={!hidden.includes(c.name)} onChange={(e) => toggle(c.name, e.target.checked)} />
              {c.name}
            </label>
          ))}
        </fieldset>
      )}
      {!on || !online || !session || !shown || shown.length === 0 ? (
        <div className="dv-camera">
          <span className="muted">
            {!on
              ? 'Camera off'
              : !online
                ? 'Not connected'
                : !shown
                  ? 'Looking for cameras…'
                  : cams?.length
                    ? 'All cameras are hidden. Use Choose to show one.'
                    : 'This printer has no camera set up in Moonraker.'}
          </span>
        </div>
      ) : (
        <div className={`dv-cameras${shown.length > 1 ? ' dv-cameras-many' : ''}`}>
          {shown.map((cam) => (
            <CameraTile key={cam.id} cam={cam} session={session} active={active} labelled={cams!.length > 1} />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Sends the add-on's keep-alive one call at a time, waiting for each answer. */
function useKeepalive(session: PrinterSession | null, keepalive: CameraHints['keepalive'] | undefined) {
  useEffect(() => {
    if (!session || !keepalive) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const started = Date.now();
      await session.rpc(keepalive.method, keepalive.params, 15_000).catch(() => {});
      if (stopped) return;
      timer = setTimeout(() => void tick(), Math.max(1000, keepalive.everyMs - (Date.now() - started)));
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [session, keepalive]);
}

function CameraTile({ cam, session, active, labelled }: { cam: Webcam; session: PrinterSession; active: boolean; labelled: boolean }) {
  const viaBridge = session.link.mediaUrl('/') === null;
  // Streams load straight in the browser, so their addresses resolve against the printer here.
  const views = cameraViews(cam, viaBridge).flatMap((v): CameraView[] => {
    if (v.kind === 'snapshots') return [v];
    if (v.kind === 'iframe' && !IFRAMES_ALLOWED) return [];
    const url = session.link.mediaUrl(v.url);
    return url ? [{ ...v, url }] : [];
  });
  const [index, setIndex] = useState(0);
  // A new camera list starts again from the best view.
  useEffect(() => setIndex(0), [cam, viaBridge]);
  const view = views[index];
  const next = () => setIndex((i) => i + 1);
  const transform = cameraTransform(cam);

  return (
    <figure className="dv-camera" style={{ aspectRatio: String(cam.aspect) }} data-testid="camera-tile" data-camera={cam.name}>
      {!active ? (
        <span className="muted">Paused</span>
      ) : !view ? (
        <span className="muted">No picture from the camera</span>
      ) : (
        <ViewFor key={`${index}`} view={view} session={session} transform={transform} onFail={next} />
      )}
      {labelled && <figcaption>{cam.name}</figcaption>}
    </figure>
  );
}

function ViewFor({ view, session, transform, onFail }: { view: CameraView; session: PrinterSession; transform: string; onFail(): void }) {
  const style = transform ? { transform } : undefined;
  if (view.kind === 'snapshots') return <SnapshotView url={view.url} fps={view.fps} session={session} style={style} />;
  const url = view.url;
  // This page is cross-origin isolated (the engine needs it), so a camera on
  // another origin only loads in CORS mode, or in a credentialless iframe.
  if (view.kind === 'mjpeg')
    return <img src={url} crossOrigin="anonymous" alt="Printer camera" style={style} onError={onFail} data-testid="camera-frame" data-view="mjpeg" />;
  if (view.kind === 'iframe')
    return (
      <iframe
        {...{ credentialless: '' }}
        src={url}
        title="Printer camera"
        allow="autoplay; fullscreen"
        referrerPolicy="no-referrer"
        data-testid="camera-frame"
        data-view="iframe"
      />
    );
  return <WebrtcView protocol={view.protocol} url={url} style={style} onFail={onFail} />;
}

function WebrtcView({ protocol, url, style, onFail }: { protocol: Parameters<typeof playWebrtc>[0]; url: string; style?: CSSProperties; onFail(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const fail = useRef(onFail);
  fail.current = onFail;
  useEffect(() => {
    if (!video.current) return;
    let hangUp: (() => void) | null = null;
    let cancelled = false;
    playWebrtc(protocol, url, video.current, () => !cancelled && fail.current())
      .then((stop) => {
        if (cancelled) stop();
        else hangUp = stop;
      })
      .catch(() => !cancelled && fail.current());
    return () => {
      cancelled = true;
      hangUp?.();
    };
  }, [protocol, url]);
  return <video ref={video} autoPlay muted playsInline style={style} data-testid="camera-frame" data-view="webrtc" />;
}

/**
 * Polls single frames at `fps`, waiting for each before asking for the next,
 * so a slow camera or link slows the polling rather than piling requests up.
 * A frame that doesn't decode (caught mid-write) is skipped.
 */
function SnapshotView({ url, fps, session, style }: { url: string; fps: number; session: PrinterSession; style?: CSSProperties }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    let shown: string | null = null;
    let misses = 0;
    const loop = async () => {
      while (!stopped) {
        const started = Date.now();
        try {
          const blob = await session.link.snapshot(url);
          const next = URL.createObjectURL(blob);
          const probe = new Image();
          probe.src = next;
          try {
            await probe.decode();
          } catch {
            URL.revokeObjectURL(next);
            throw new Error('Broken frame');
          }
          if (stopped) {
            URL.revokeObjectURL(next);
            break;
          }
          if (shown) URL.revokeObjectURL(shown);
          shown = next;
          setFrame(next);
          setFailed(false);
          misses = 0;
        } catch {
          if (++misses >= 3) setFailed(true);
        }
        // After repeated misses, keep trying but slowly.
        const period = misses >= 3 ? 5000 : 1000 / fps;
        await new Promise((r) => setTimeout(r, Math.max(100, period - (Date.now() - started))));
      }
    };
    void loop();
    return () => {
      stopped = true;
      if (shown) URL.revokeObjectURL(shown);
    };
  }, [url, fps, session]);

  if (failed || !frame) return <span className="muted">{failed ? 'No picture from the camera' : 'Connecting to the camera…'}</span>;
  return <img src={frame} alt="Printer camera" style={style} data-testid="camera-frame" data-view="snapshots" />;
}
