import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { currentSession, useDevice } from '../../state/device';
import { cameraTransform, cameraViews, type CameraView, type Webcam } from '../camera';
import { cameraCardOf, type CamCardId } from '../layout';
import type { CameraHints } from '../addons/types';
import type { PrinterSession } from '../session';
import { playWebrtc } from '../webrtc';
import { playDirect } from '../direct-camera';
import type { SharedLink } from '../shared-link';
import { Card, useFolded } from './parts';
import { CameraOff } from 'lucide-react';
import { Empty } from '../../components/Empty';

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
 * camera. Nothing streams while the card is folded or the page is hidden.
 *
 * `card` is which camera card this is: the main one ('camera') shows every camera not put in an extra
 * camera card and not hidden; an extra one shows the cameras put in it (`home`, chosen with Choose).
 */
export function CameraCard({
  card = 'camera',
  home = {},
  onPlace,
}: {
  card?: 'camera' | CamCardId;
  home?: Record<string, CamCardId>;
  onPlace?(name: string, card: 'camera' | CamCardId): void;
}) {
  const online = useDevice((s) => s.conn.state === 'online');
  const reconnecting = useDevice((s) => s.conn.state === 'connecting');
  const addons = useDevice((s) => s.addons);
  const facts = useDevice((s) => s.facts);
  const visible = usePageVisible();
  const folded = useFolded();
  const [choosing, setChoosing] = useState(false);
  const hidden = useDevice((s) => s.printers.find((p) => p.id === s.activeId)?.hiddenCameras ?? NONE);
  const [cams, setCams] = useState<Webcam[] | null>(null);
  // On phones one camera is shown big and the rest small beside it; tapping a small one swaps it in.
  const [mainId, setMainId] = useState<string | null>(null);
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

  const active = !folded && visible && online && !!session;
  const main = card === 'camera';
  const here = (c: Webcam) => cameraCardOf({ cameraHome: home }, c.name) === card;
  const shown = cams?.filter((c) => here(c) && !(main && hidden.includes(c.name))) ?? null;
  const setHidden = (name: string, hide: boolean) => void useDevice.getState().setHiddenCameras(hide ? [...hidden, name] : hidden.filter((n) => n !== name));
  // Ticking a camera brings it into this card; unticking hides it (main card) or sends it back to the main card.
  const toggle = (name: string, show: boolean) => {
    if (show) {
      if (hidden.includes(name)) setHidden(name, false);
      if (onPlace && cameraCardOf({ cameraHome: home }, name) !== card) onPlace(name, card);
    } else if (main) setHidden(name, true);
    else onPlace?.(name, 'camera');
  };
  useKeepalive(active && shown?.length ? session : null, hint?.keepalive);
  const title = main ? (shown && shown.length > 1 ? 'Cameras' : 'Camera') : shown?.length === 1 ? shown[0].name : shown && shown.length > 1 ? 'Cameras' : 'Camera card';

  return (
    <Card
      title={title}
      className="dv-camera-card"
      testId={main ? 'camera-card' : `camera-card-${card.slice(4)}`}
      actions={
        <>
          {cams && (cams.length > 1 || (!main && cams.length > 0)) && (
            <button className="quiet" onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
              {choosing ? 'Done' : 'Choose'}
            </button>
          )}
        </>
      }
    >
      {choosing && cams && cams.length > 0 && (
        <fieldset className="dv-camera-pick" data-testid="camera-pick">
          <legend>{main ? 'Show these cameras' : 'Show these cameras in this card'}</legend>
          {cams.map((c) => (
            <label key={c.id}>
              <input type="checkbox" checked={shown?.includes(c) ?? false} onChange={(e) => toggle(c.name, e.target.checked)} />
              {c.name}
              {!here(c) && <span className="muted"> (in another card)</span>}
            </label>
          ))}
        </fieldset>
      )}
      {!online || !session || !shown || shown.length === 0 ? (
        <div className="dv-camera">
          <Empty
            icon={CameraOff}
            text={!online
                ? reconnecting ? 'Reconnecting…' : 'Not connected'
                : !shown
                  ? 'Looking for cameras…'
                  : !main
                    ? 'No camera in this card yet. Use Choose to pick one.'
                    : cams?.length && cams.every((c) => !here(c))
                    ? 'Your cameras are in other camera cards.'
                    : cams?.length
                    ? 'All cameras are hidden. Use Choose to show one.'
                    : (addons.map((a) => a.cameraMissing).find(Boolean) ?? `This printer has no camera set up in ${addons.map((a) => a.host?.name).find(Boolean) ?? 'Moonraker'}.`)}
          />
        </div>
      ) : (
        <div
          className={`dv-cameras${shown.length > 1 ? ' dv-cameras-many' : ''}${shown.length === 2 ? ' dv-cameras-pair' : shown.length > 3 ? ' dv-cameras-row' : ''}`} style={{ '--small-cameras': Math.max(2, shown.length - 1) } as CSSProperties}>
          {shown.map((cam) => (
            <CameraTile
              key={cam.id}
              cam={cam}
              session={session}
              active={active}
              labelled={shown.length > 1 || (main && cams!.length > 1)}
              main={cam.id === (shown.some((c) => c.id === mainId) ? mainId : shown[0].id)}
              onPick={() => setMainId(cam.id)}
            />
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

const NETWORK_BLOCKS = 'Slow camera: your network blocks a direct connection.';
/** A camera showing relay pictures checks this often whether the direct link can be made (a blocked network still waits RETRY_AFTER_MS between real tries). */
const BACK_TO_DIRECT_MS = 5_000;

function CameraTile({
  cam,
  session,
  active,
  labelled,
  main,
  onPick,
}: {
  cam: Webcam;
  session: PrinterSession;
  active: boolean;
  labelled: boolean;
  main: boolean;
  onPick(): void;
}) {
  const viaBridge = session.link.mediaUrl('/') === null;
  // Streams load straight in the browser, so their addresses resolve against the printer here.
  // Kept between renders: a new view object restarts the stream (a card folding elsewhere re-renders this one).
  const views = useMemo(
    () =>
      cameraViews(cam, viaBridge).flatMap((v): CameraView[] => {
        if (v.kind === 'snapshots') return [v];
        if (v.kind === 'direct') return directBridge(session) && typeof RTCPeerConnection !== 'undefined' ? [v] : [];
        if (v.kind === 'iframe' && !IFRAMES_ALLOWED) return [];
        const url = session.link.mediaUrl(v.url);
        return url ? [{ ...v, url }] : [];
      }),
    [cam, viaBridge, session],
  );
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState('');
  // A new camera list starts again from the best view.
  useEffect(() => {
    setIndex(0);
    setNote('');
  }, [cam, viaBridge]);
  const view = views[index];
  const shared = session.link.shared;
  const next = (why?: string) => {
    if (view?.kind === 'direct') setNote(why && /Unknown bridge call/.test(why) ? 'Slow camera: update the bridge for a smooth one.' : shared?.blocked ? NETWORK_BLOCKS : '');
    setIndex((i) => i + 1);
  };
  // Showing relay pictures although the camera can come straight from the bridge:
  // when the direct link is up again (or can be made), go back to it.
  const fellBack = views[0]?.kind === 'direct' && index > 0 && !!shared;
  useEffect(() => {
    if (!fellBack || !shared || !active) return;
    let stopped = false;
    const back = () => {
      if (stopped) return;
      setNote('');
      setIndex(0);
    };
    // Another camera, a page or a timelapse brought the link up: join it at once.
    const unUp = shared.onUp(back);
    const timer = setInterval(() => void shared.ready().then(back, () => {}), BACK_TO_DIRECT_MS);
    return () => {
      stopped = true;
      unUp();
      clearInterval(timer);
    };
  }, [fellBack, shared, active]);
  const transform = cameraTransform(cam);

  return (
    <figure
      className={`dv-camera${main ? ' dv-camera-main' : ''}`}
      style={{ aspectRatio: String(cam.aspect), '--aspect': String(cam.aspect) } as CSSProperties}
      data-testid="camera-tile"
      data-camera={cam.name}
      data-main={main || undefined}
    >
      {!active ? (
        <span className="muted">Paused</span>
      ) : !view ? (
        <span className="muted">No picture from the camera</span>
      ) : (
        <ViewFor key={`${index}`} view={view} session={session} transform={transform} onFail={next} />
      )}
      {labelled && <figcaption>{cam.name}</figcaption>}
      {/* Covers a small camera, whose player page would otherwise swallow the click. */}
      {!main && <button className="dv-camera-swap" onClick={onPick} aria-label={`Show ${cam.name} big`} />}
      {active && note && view?.kind === 'snapshots' && (
        <span className="dv-camera-note" data-testid="camera-note">
          {note}
        </span>
      )}
    </figure>
  );
}

/** The bridge link's shared direct link, or null on a link that has none. */
function directBridge(session: PrinterSession): SharedLink | null {
  return session.link.shared ?? null;
}

function ViewFor({ view, session, transform, onFail }: { view: CameraView; session: PrinterSession; transform: string; onFail(why?: string): void }) {
  const style = transform ? { transform } : undefined;
  if (view.kind === 'snapshots') return <SnapshotView url={view.url} fps={view.fps} session={session} style={style} />;
  if (view.kind === 'direct') return <DirectView view={view} session={session} style={style} onFail={onFail} />;
  const url = view.url;
  // This page is cross-origin isolated (the engine needs it), so a camera on
  // another origin only loads in CORS mode, or in a credentialless iframe.
  if (view.kind === 'mjpeg')
    return <img src={url} crossOrigin="anonymous" alt="Printer camera" style={style} onError={() => onFail()} data-testid="camera-frame" data-view="mjpeg" />;
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
 * The camera straight from the bridge: live video, or pictures as fast as the
 * camera makes them. When the link drops it starts again on a new one, still
 * showing the last picture; falls back (onFail) when a link can't be made.
 */
function DirectView({
  view,
  session,
  style,
  onFail,
}: {
  view: Extract<CameraView, { kind: 'direct' }>;
  session: PrinterSession;
  style?: CSSProperties;
  onFail(why?: string): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const fail = useRef(onFail);
  fail.current = onFail;
  const [mode, setMode] = useState<'video' | 'pictures' | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  // Counts links this camera has started on: a dropped link starts it again.
  const [attempt, setAttempt] = useState(0);
  // Live video that won't start on a working link: ask the same link for pictures instead of leaving it.
  const [picturesOnly, setPicturesOnly] = useState(false);
  useEffect(() => {
    const bridge = directBridge(session);
    if (!video.current || !bridge) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    playDirect(bridge, picturesOnly ? { ...view.camera, pictures: true } : view.camera, {
      video: video.current,
      picture: (blob) => {
        if (cancelled) return;
        setFrame(URL.createObjectURL(blob));
        setMode('pictures');
      },
      onLost: () => !cancelled && setAttempt((a) => a + 1),
    })
      .then((p) => {
        if (cancelled) return p.stop();
        stop = p.stop;
        setMode(p.mode);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // While the link is up every camera stays on it; only a link that is down falls back.
        if (!picturesOnly && bridge.current()) setPicturesOnly(true);
        else fail.current(e.message);
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [view, session, attempt, picturesOnly]);
  // Each picture's address is let go once the next one shows (or the camera goes); the last stays up while the camera starts again.
  useEffect(() => () => void (frame && URL.revokeObjectURL(frame)), [frame]);
  return (
    <>
      <video ref={video} autoPlay muted playsInline style={style} hidden={mode !== 'video'} data-testid={mode === 'video' ? 'camera-frame' : undefined} data-view="direct-video" />
      {mode === 'pictures' && frame && <img src={frame} alt="Printer camera" style={style} data-testid="camera-frame" data-view="direct-pictures" />}
      {!mode && <span className="muted">Connecting to the camera…</span>}
    </>
  );
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
