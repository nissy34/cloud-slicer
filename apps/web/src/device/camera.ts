// Cameras as Moonraker lists them ([webcam] sections, server.webcams.list),
// and how to show each one. A live stream (MJPEG, WebRTC, the camera's own
// player page) costs the printer one connection; polling snapshots costs one
// request per frame, so it is the fallback and runs at a modest rate.

export interface Webcam {
  /** Unique within the printer: Moonraker's uid, or the name. */
  id: string;
  name: string;
  /** Moonraker's `service`: mjpegstreamer, mjpegstreamer-adaptive, iframe, webrtc-camerastreamer, ... */
  service: string;
  streamUrl: string;
  snapshotUrl: string;
  targetFps: number;
  flipH: boolean;
  flipV: boolean;
  rotation: number;
  /** Width / height, from aspect_ratio ("16:9"). */
  aspect: number;
}

export type CameraView =
  | { kind: 'mjpeg'; url: string }
  | { kind: 'iframe'; url: string }
  | { kind: 'webrtc'; protocol: WebrtcProtocol; url: string }
  | { kind: 'snapshots'; url: string; fps: number }
  | { kind: 'direct'; camera: DirectCamera };

/** What the bridge needs to send a camera straight to this browser (bridge.camera_open). */
export interface DirectCamera {
  service: string;
  streamUrl: string;
  snapshotUrl: string;
  /** Pictures per second, for a camera with no live video of its own. */
  fps: number;
}

export type WebrtcProtocol = 'camera-streamer' | 'whep' | 'go2rtc';

/** Snapshot polling never goes faster than this, whatever the camera asks for. */
export const MAX_SNAPSHOT_FPS = 5;
/** Through the bridge every frame crosses the relay, so slower still. */
export const BRIDGE_SNAPSHOT_FPS = 1;
/** Pictures over a direct link from the bridge never touch the relay, so they can come faster. */
export const DIRECT_PICTURE_FPS = 10;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : fallback);

function parseAspect(v: unknown): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(v ?? ''));
  const a = m ? Number(m[1]) / Number(m[2]) : NaN;
  return Number.isFinite(a) && a > 0.2 && a < 5 ? a : 4 / 3;
}

/** server.webcams.list -> the enabled cameras, in Moonraker's order. */
export function parseWebcams(raw: unknown): Webcam[] {
  const list = (raw as { webcams?: unknown })?.webcams;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Webcam[] = [];
  for (const w of list as Record<string, unknown>[]) {
    if (!w || typeof w !== 'object' || w.enabled === false) continue;
    const name = String(w.name ?? '').trim() || `Camera ${out.length + 1}`;
    let id = String(w.uid ?? '').trim() || name;
    while (seen.has(id)) id += '+';
    seen.add(id);
    const streamUrl = String(w.stream_url ?? '').trim();
    const snapshotUrl = String(w.snapshot_url ?? '').trim();
    if (!streamUrl && !snapshotUrl) continue;
    out.push({
      id,
      name,
      service: String(w.service ?? 'mjpegstreamer').trim().toLowerCase(),
      streamUrl,
      snapshotUrl,
      targetFps: Math.max(1, num(w.target_fps, 15)),
      flipH: w.flip_horizontal === true,
      flipV: w.flip_vertical === true,
      rotation: num(w.rotation, 0),
      aspect: parseAspect(w.aspect_ratio),
    });
  }
  return out;
}

/** The snapshot fallback for a camera, or null when it has no snapshot address. */
export function snapshotView(cam: Pick<Webcam, 'snapshotUrl' | 'targetFps'>, viaBridge: boolean): CameraView | null {
  if (!cam.snapshotUrl) return null;
  const cap = viaBridge ? BRIDGE_SNAPSHOT_FPS : MAX_SNAPSHOT_FPS;
  return { kind: 'snapshots', url: cam.snapshotUrl, fps: Math.min(cap, cam.targetFps) };
}

/**
 * How to show a camera, best first. The UI tries them in order and moves on
 * when one fails. Through the bridge the browser cannot reach the printer's
 * network: the bridge sends the camera straight to the browser when it can
 * (live video, or pictures), and relays single frames when it can't.
 */
export function cameraViews(cam: Webcam, viaBridge: boolean): CameraView[] {
  const snap = snapshotView(cam, viaBridge);
  if (viaBridge) {
    const views: CameraView[] = [];
    if (cam.snapshotUrl || cam.streamUrl)
      views.push({ kind: 'direct', camera: { service: cam.service, streamUrl: cam.streamUrl, snapshotUrl: cam.snapshotUrl, fps: Math.min(DIRECT_PICTURE_FPS, cam.targetFps) } });
    if (snap) views.push(snap);
    return views;
  }
  const views: CameraView[] = [];
  const stream = cam.streamUrl;
  switch (cam.service) {
    case 'mjpegstreamer':
    case 'uv4l-mjpeg':
    case 'ipstream':
      if (stream) views.push({ kind: 'mjpeg', url: stream });
      break;
    case 'mjpegstreamer-adaptive':
      // "Adaptive" means: poll snapshots at the camera's target rate.
      break;
    case 'webrtc-camerastreamer':
      if (stream) views.push({ kind: 'webrtc', protocol: 'camera-streamer', url: stream });
      break;
    case 'webrtc-mediamtx':
      if (stream) views.push({ kind: 'webrtc', protocol: 'whep', url: stream });
      break;
    case 'webrtc-go2rtc':
      if (stream) views.push({ kind: 'webrtc', protocol: 'go2rtc', url: stream });
      break;
    case 'iframe':
      if (stream) views.push({ kind: 'iframe', url: stream });
      break;
    default:
      // hlsstream, jmuxer-stream and anything newer: their own page is the safest bet.
      if (stream && !snap) views.push({ kind: 'iframe', url: stream });
  }
  if (snap) views.push(snap);
  return views;
}

/** CSS transform for a camera's flip and rotation settings. */
export function cameraTransform(cam: Pick<Webcam, 'flipH' | 'flipV' | 'rotation'>): string {
  return [cam.flipH ? 'scaleX(-1)' : '', cam.flipV ? 'scaleY(-1)' : '', cam.rotation ? `rotate(${cam.rotation}deg)` : ''].filter(Boolean).join(' ');
}
