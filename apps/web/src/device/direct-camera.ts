// A camera straight from the bridge to this browser: the offer and answer go
// over the relay once (bridge.camera_open), then the picture comes over its
// own WebRTC connection and never crosses the relay. The bridge sends the
// camera's own live video when it has one, and otherwise pictures over a data
// channel, each cut into pieces whose first byte is 1 on a picture's last piece.
import type { DirectCamera } from './camera';
import type { DirectAnswer } from './link/types';
import { STUN, gathered } from './webrtc';

/** How long the direct link gets to show something before the camera falls back to the relay. */
export const DIRECT_TIMEOUT_MS = 12_000;

export interface DirectBridge {
  cameraOpen(camera: DirectCamera, sdp: string): Promise<DirectAnswer>;
  cameraClose(id: string): void;
  /** The link is up: an upload to the same bridge can ride it. Returns its undo. */
  linked?(pc: RTCPeerConnection): () => void;
}

export interface DirectPlayer {
  mode: 'video' | 'pictures';
  stop(): void;
}

/** Joins a picture's pieces back together; returns the picture when its last piece arrives. */
export function pictureAssembler(): (piece: Uint8Array) => Uint8Array | null {
  let parts: Uint8Array[] = [];
  let size = 0;
  return (piece) => {
    if (!piece.length) return null;
    const body = piece.subarray(1);
    parts.push(body);
    size += body.length;
    if (piece[0] !== 1) return null;
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    parts = [];
    size = 0;
    return out;
  };
}

/**
 * Connects and resolves once the first video or picture has arrived. Rejects
 * (and cleans up) when it can't, so the caller can fall back to the relay;
 * `onLost` fires if a link that was up drops later.
 */
export async function playDirect(
  bridge: DirectBridge,
  camera: DirectCamera,
  show: { video: HTMLVideoElement; picture(blob: Blob): void; onLost(): void },
): Promise<DirectPlayer> {
  const pc = new RTCPeerConnection({ iceServers: STUN });
  let id = '';
  let stopped = false;
  let unlink: (() => void) | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unlink?.();
    pc.close();
    show.video.srcObject = null;
    if (id) bridge.cameraClose(id);
  };
  pc.addTransceiver('video', { direction: 'recvonly' });
  const frames = pc.createDataChannel('frames');
  frames.binaryType = 'arraybuffer';
  const assemble = pictureAssembler();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('The direct camera link did not connect in time.')), DIRECT_TIMEOUT_MS);
    pc.ontrack = (e) => {
      if (e.track.kind !== 'video') return;
      show.video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      show.video.addEventListener('loadeddata', () => resolve(), { once: true });
    };
    frames.onmessage = (e) => {
      if (typeof e.data === 'string') return;
      const picture = assemble(new Uint8Array(e.data as ArrayBuffer));
      if (!picture) return;
      show.picture(new Blob([picture as BlobPart], { type: 'image/jpeg' }));
      resolve();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') reject(new Error('The direct camera link failed.'));
      if (!stopped && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) show.onLost();
    };
  });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const answer = await bridge.cameraOpen(camera, pc.localDescription?.sdp ?? '');
    id = answer.id;
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    await first;
    unlink = bridge.linked?.(pc);
    return { mode: answer.mode, stop };
  } catch (e) {
    stop();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
