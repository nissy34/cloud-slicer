// WebRTC camera players for the three servers Moonraker knows about. Each
// signals differently; all of them end with a receive-only video track.
// Adapted from Mainsail's streamers (camera-streamer, MediaMTX WHEP, go2rtc).
import type { WebrtcProtocol } from './camera';

export const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
const SIGNAL_TIMEOUT_MS = 10_000;

/** Waits for ICE gathering so the SDP we send carries every candidate (no trickle needed). */
export function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== 'complete') return;
      pc.removeEventListener('icegatheringstatechange', done);
      resolve();
    };
    pc.addEventListener('icegatheringstatechange', done);
    // Don't wait forever on an unreachable STUN server: host candidates are enough on a LAN.
    setTimeout(resolve, 2000);
  });
}

async function post(url: string, body: string, contentType: string, signal: AbortSignal): Promise<Response> {
  const r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': contentType }, signal });
  if (!r.ok) throw new Error(`The camera answered HTTP ${r.status}.`);
  return r;
}

async function cameraStreamer(pc: RTCPeerConnection, url: string, signal: AbortSignal) {
  const offer = (await (await post(url, JSON.stringify({ type: 'request', iceServers: STUN, keepAlive: true }), 'application/json', signal)).json()) as RTCSessionDescriptionInit & {
    id: string;
    iceServers?: RTCIceServer[];
  };
  if (offer.iceServers?.length) pc.setConfiguration({ iceServers: offer.iceServers });
  pc.ondatachannel = (e) => {
    // camera-streamer pings over a "keepalive" channel and drops silent viewers.
    if (e.channel.label === 'keepalive') e.channel.onmessage = (m) => m.data === 'ping' && e.channel.send('pong');
  };
  await pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  await post(url, JSON.stringify({ type: 'answer', id: offer.id, sdp: pc.localDescription?.sdp }), 'application/json', signal);
}

async function whep(pc: RTCPeerConnection, url: string, signal: AbortSignal) {
  const endpoint = /\/whep\/?$/.test(url) ? url : `${url.replace(/\/?$/, '/')}whep`;
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const answer = await (await post(endpoint, pc.localDescription?.sdp ?? '', 'application/sdp', signal)).text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
}

/** go2rtc's websocket API, at <stream dir>/api/ws?src=<name>. */
export function go2rtcSocketUrl(streamUrl: string, base: string): string {
  const u = new URL(streamUrl, base);
  if (u.pathname.endsWith('/api/webrtc')) u.pathname = u.pathname.slice(0, -'webrtc'.length) + 'ws';
  else if (!u.pathname.endsWith('/api/ws')) u.pathname = u.pathname.replace(/[^/]*$/, '') + 'api/ws';
  u.searchParams.set('media', 'video');
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

function go2rtc(pc: RTCPeerConnection, url: string, signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(go2rtcSocketUrl(url, location.href));
    const fail = () => reject(new Error('The camera closed the connection.'));
    signal.addEventListener('abort', () => ws.close());
    ws.onerror = fail;
    ws.onopen = async () => {
      pc.onicecandidate = (e) => e.candidate && ws.send(JSON.stringify({ type: 'webrtc/candidate', value: e.candidate.candidate }));
      await pc.setLocalDescription(await pc.createOffer());
      ws.send(JSON.stringify({ type: 'webrtc/offer', value: pc.localDescription?.sdp }));
    };
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(String(ev.data)) as { type: string; value: string };
      if (msg.type === 'webrtc/answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: msg.value });
        resolve(() => ws.close());
      } else if (msg.type === 'webrtc/candidate') {
        await pc.addIceCandidate({ candidate: msg.value, sdpMid: '0' }).catch(() => {});
      } else if (msg.type === 'error') {
        reject(new Error(msg.value));
      }
    };
  });
}

/**
 * Plays a WebRTC camera into `video`. Resolves once signalling is done and
 * returns the function that hangs up; rejects (and cleans up) when the camera
 * cannot be reached, so the caller can fall back to snapshots. `onLost` fires
 * if a connection that was up drops later.
 */
export async function playWebrtc(protocol: WebrtcProtocol, url: string, video: HTMLVideoElement, onLost: () => void): Promise<() => void> {
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const ac = new AbortController();
  let extra = () => {};
  const stop = () => {
    ac.abort();
    extra();
    pc.close();
    video.srcObject = null;
  };
  pc.addTransceiver('video', { direction: 'recvonly' });
  const playing = new Promise<void>((resolve, reject) => {
    pc.ontrack = (e) => {
      if (e.track.kind !== 'video') return;
      video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      resolve();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') reject(new Error('The camera stream failed.'));
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') onLost();
    };
  });
  const timeout = setTimeout(() => ac.abort(), SIGNAL_TIMEOUT_MS);
  try {
    if (protocol === 'camera-streamer') await cameraStreamer(pc, url, ac.signal);
    else if (protocol === 'whep') await whep(pc, url, ac.signal);
    else extra = await go2rtc(pc, url, ac.signal);
    await Promise.race([
      playing,
      new Promise((_, reject) => ac.signal.addEventListener('abort', () => reject(new Error('The camera did not start in time.')))),
    ]);
    return stop;
  } catch (e) {
    stop();
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
