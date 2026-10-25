// Faster uploads through the bridge. The G-code is zipped first (it shrinks 4
// to 5 times), then goes over a direct WebRTC link to the bridge when one
// connects (on the same network: home-network speed, nothing crosses the
// relay). A camera's direct link to the bridge carries it at once when one is
// open; a camera that fell back to the relay means direct links are blocked,
// so none is tried. Else streamed over the relay: raw 256 KiB pieces sent back to back,
// at most 8 MiB of them unanswered, the bar following the bridge's answers. A
// direct link that opens but then carries nothing (a VPN in the way, say) is
// given up too, and the relay carries on from what arrived. A bridge from
// before streaming gets 8 MiB pieces one at a time; an older relay that only
// passes text gets base64 pieces of 512 KiB, as its 1 MiB limit wants; an
// older bridge still gets the file the old way (bridge.upload_begin).
import { STUN, gathered } from '../webrtc';

/** A piece streamed over the relay, as raw bytes. */
export const STREAM_PIECE = 256 * 1024;
/** Bytes streamed over the relay that the bridge hasn't answered yet, at most. */
export const STREAM_WINDOW = 8 * 1024 * 1024;
/** A piece over the relay to a bridge that takes one at a time; Cloudflare allows 32 MiB per message, the relay takes 9 MiB. */
export const UPLOAD_PIECE = 8 * 1024 * 1024;
/** A piece over a relay that only passes text: under its 1 MiB limit once base64-encoded. */
export const UPLOAD_CHUNK = 512 * 1024;
/** How long the upload's own direct link may take to open before the upload goes over the relay (at home it opens in under a second). */
export const DIRECT_UPLOAD_TIMEOUT_MS = 5_000;
/** How long the open direct link may carry nothing (no bytes leave, or no answer once all have) before the relay takes over. */
export const DIRECT_STALL_MS = 15_000;
/** A data channel message: small, as every browser and the bridge take it. */
const DIRECT_PIECE = 16 * 1024;
/** Bytes queued on the data channel before waiting for them to leave. */
const DIRECT_BUFFER = 2 * 1024 * 1024;

/** The file zipped (gzip), or null when the browser can't zip or zipping doesn't make it smaller. */
export async function gzipped(blob: Blob): Promise<Blob | null> {
  if (typeof CompressionStream !== 'function' || blob.size === 0) return null;
  try {
    const zip = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return zip.size < blob.size * 0.9 ? zip : null;
  } catch {
    return null;
  }
}

/** A binary upload piece: 4 bytes (big-endian) with the JSON header's length, the header, then the bytes. */
export function encodePiece(header: unknown, bytes: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + head.length + bytes.length);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(bytes, 4 + head.length);
  return out;
}

/** The browser's half of a direct upload link, offered before the bridge knows about the upload. */
export interface DirectUpload {
  sdp: string;
  /** Sends every byte once the bridge has answered; resolves to the stored path. Rejects with the bytes it got to. */
  send(answerSdp: string, wire: Blob, onProgress?: (sent: number) => void): Promise<string>;
  close(): void;
}

/** The direct link broke after the bridge took some bytes: carry on over the relay. */
export class DirectUploadLost extends Error {}

/** The bridge said no (Moonraker refused the file, say): not worth trying again over the relay. */
export class DirectUploadRefused extends Error {}

export async function offerDirectUpload(): Promise<DirectUpload | null> {
  if (typeof RTCPeerConnection !== 'function') return null;
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const dc = pc.createDataChannel('upload');
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
  } catch {
    pc.close();
    return null;
  }
  const close = () => pc.close();
  return {
    sdp: pc.localDescription?.sdp ?? '',
    close,
    send: (answerSdp, wire, onProgress) => sendOver(pc, dc, () => pc.setRemoteDescription({ type: 'answer', sdp: answerSdp }), wire, onProgress, close),
  };
}

/**
 * An upload over a camera's direct link to the same bridge, already open: a
 * new channel named for the upload, so nothing is negotiated and nothing
 * waits. Closing it leaves the camera's link alone.
 */
export function cameraDirectUpload(pc: RTCPeerConnection, uploadId: string): DirectUpload {
  const dc = pc.createDataChannel(`upload:${uploadId}`);
  const close = () => dc.close();
  return { sdp: '', close, send: (_answerSdp, wire, onProgress) => sendOver(pc, dc, async () => {}, wire, onProgress, close) };
}

/** Sends every byte over the channel once `connect` has done its part; resolves to the stored path. */
async function sendOver(
  pc: RTCPeerConnection,
  dc: RTCDataChannel,
  connect: () => Promise<void>,
  wire: Blob,
  onProgress: ((sent: number) => void) | undefined,
  close: () => void,
): Promise<string> {
  dc.binaryType = 'arraybuffer';
  let lost: (e: Error) => void = () => {};
  let answered: (path: string) => void = () => {};
  const done = new Promise<string>((ok, fail) => {
    answered = ok;
    lost = fail;
  });
  // Nothing waits on this until the bytes are sent; a failure is still seen there.
  done.catch(() => {});
  dc.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    try {
      const a = JSON.parse(e.data) as { path?: string; error?: string };
      if (a.error) lost(new DirectUploadRefused(a.error));
      else answered(a.path ?? '');
    } catch {
      // not ours
    }
  };
  const broke = () => lost(new DirectUploadLost('The direct link to the bridge dropped.'));
  dc.onclose = broke;
  // A listener, not onconnectionstatechange: a camera's link has its own.
  const watch = () => (pc.connectionState === 'failed' || pc.connectionState === 'closed') && broke();
  pc.addEventListener('connectionstatechange', watch);
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await connect();
      if (dc.readyState !== 'open')
        await new Promise<void>((ok, fail) => {
          timer = setTimeout(() => fail(new DirectUploadLost('The direct link to the bridge did not connect.')), DIRECT_UPLOAD_TIMEOUT_MS);
          dc.onopen = () => ok();
          done.catch(fail);
        });
    } finally {
      clearTimeout(timer);
    }
    dc.bufferedAmountLowThreshold = DIRECT_BUFFER / 2;
    // What has left this browser: bytes handed to the channel less those still waiting in it.
    let queued = 0;
    let left = 0;
    let moved = Date.now();
    const tick = setInterval(() => {
      const now = queued - dc.bufferedAmount;
      if (now !== left) {
        left = now;
        moved = Date.now();
        onProgress?.(left);
      } else if (Date.now() - moved > DIRECT_STALL_MS) {
        lost(new DirectUploadLost('The direct link to the bridge stalled.'));
      }
    }, 250);
    try {
      for (let offset = 0; offset < wire.size; ) {
        const block = new Uint8Array(await wire.slice(offset, offset + UPLOAD_PIECE).arrayBuffer());
        for (let i = 0; i < block.length; i += DIRECT_PIECE) {
          if (dc.bufferedAmount > DIRECT_BUFFER) {
            await Promise.race([new Promise<void>((ok) => (dc.onbufferedamountlow = () => ok())), done]);
          }
          if (dc.readyState !== 'open') return await done;
          const piece = block.subarray(i, i + DIRECT_PIECE);
          dc.send(piece);
          queued += piece.length;
        }
        offset += block.length;
      }
      // The last bytes leave, the bridge hands the file to the printer, then answers.
      await done;
    } finally {
      clearInterval(tick);
    }
    const path = await done;
    onProgress?.(wire.size);
    close();
    return path;
  } finally {
    pc.removeEventListener('connectionstatechange', watch);
  }
}
