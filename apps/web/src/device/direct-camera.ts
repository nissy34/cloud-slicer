// A camera straight from the bridge to this browser, on the page's direct link
// to it (shared-link.ts): one short relay call (bridge.link_camera) starts it,
// then the picture comes over the link and never crosses the relay. The bridge
// sends the camera's own live video on one of the link's video slots when it
// has one, and otherwise pictures on channel "frames:<slot>", each cut into
// pieces whose first byte is 1 on a picture's last piece.
import { i18n } from '../i18n';
import type { DirectCamera } from './camera';
import type { SharedLink } from './shared-link';

/** How long the camera gets to show something before it falls back to the relay. */
export const DIRECT_TIMEOUT_MS = 12_000;

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
 * Starts the camera on the direct link (making the link if there is none) and
 * resolves once the first video or picture has arrived. Rejects (and cleans
 * up) when it can't, so the caller can fall back to the relay; `onLost` fires
 * if the link drops later.
 */
export async function playDirect(
  link: SharedLink,
  camera: DirectCamera,
  show: { video: HTMLVideoElement; picture(blob: Blob): void; onLost(): void },
): Promise<DirectPlayer> {
  let stopped = false;
  let slot = -1;
  let frames: RTCDataChannel | undefined;
  let undrop = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(i18n.t('deviceLink.directCameraTimeout'))), DIRECT_TIMEOUT_MS);
  });
  timeout.catch(() => {});
  const up = await Promise.race([link.ready(), timeout]).catch((e: unknown) => {
    clearTimeout(timer);
    throw e;
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    undrop();
    frames?.close();
    show.video.srcObject = null;
    if (slot >= 0) link.cameraClose(up, slot);
  };
  undrop = link.onDrop(() => {
    if (stopped) return;
    stop();
    show.onLost();
  });
  try {
    const started = await Promise.race([link.camera(up, camera), timeout]);
    slot = started.slot;
    if (stopped) throw new Error(i18n.t('deviceLink.directLinkClosed'));
    const first = new Promise<void>((resolve) => {
      if (started.mode === 'video') {
        const stream = up.video(slot);
        if (!stream) throw new Error(i18n.t('deviceLink.directNoVideo'));
        show.video.srcObject = stream;
        show.video.addEventListener('loadeddata', () => resolve(), { once: true });
        return;
      }
      const assemble = pictureAssembler();
      const dc = up.pc.createDataChannel(`frames:${slot}`);
      frames = dc;
      dc.binaryType = 'arraybuffer';
      dc.onmessage = (e) => {
        if (typeof e.data === 'string') return;
        const picture = assemble(new Uint8Array(e.data as ArrayBuffer));
        if (!picture) return;
        show.picture(new Blob([picture as BlobPart], { type: 'image/jpeg' }));
        resolve();
      };
    });
    await Promise.race([first, timeout]);
    return { mode: started.mode, stop };
  } catch (e) {
    stop();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
