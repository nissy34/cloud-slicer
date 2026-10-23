// Faster uploads through the bridge. The G-code is zipped first (it shrinks 4
// to 5 times), then goes over a direct WebRTC link to the bridge when one
// connects (on the same network: home-network speed, nothing crosses the
// relay), else over the relay in 8 MiB pieces of raw bytes, each waiting for
// the bridge's "got it". An older relay that only passes text gets base64
// pieces of 512 KiB, as its 1 MiB limit wants; an older bridge gets the file
// the old way (bridge.upload_begin).
import { STUN, gathered } from '../webrtc';

/** A piece over the relay, as raw bytes; Cloudflare allows 32 MiB per message, the relay takes 9 MiB. */
export const UPLOAD_PIECE = 8 * 1024 * 1024;
/** A piece over a relay that only passes text: under its 1 MiB limit once base64-encoded. */
export const UPLOAD_CHUNK = 512 * 1024;
/** How long the direct link may take to open before the upload goes over the relay. */
export const DIRECT_UPLOAD_TIMEOUT_MS = 10_000;
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
  dc.binaryType = 'arraybuffer';
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
    async send(answerSdp, wire, onProgress) {
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
      pc.onconnectionstatechange = () => (pc.connectionState === 'failed' || pc.connectionState === 'closed') && broke();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
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
      for (let offset = 0; offset < wire.size; ) {
        const block = new Uint8Array(await wire.slice(offset, offset + UPLOAD_PIECE).arrayBuffer());
        for (let i = 0; i < block.length; i += DIRECT_PIECE) {
          if (dc.bufferedAmount > DIRECT_BUFFER) {
            await Promise.race([new Promise<void>((ok) => (dc.onbufferedamountlow = () => ok())), done]);
          }
          if (dc.readyState !== 'open') return done;
          dc.send(block.subarray(i, i + DIRECT_PIECE));
          onProgress?.(offset + i - dc.bufferedAmount);
        }
        offset += block.length;
      }
      // The last bytes leave, the bridge hands the file to the printer, then answers.
      const path = await done;
      onProgress?.(wire.size);
      close();
      return path;
    },
  };
}
