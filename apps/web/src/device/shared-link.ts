// The direct link: one WebRTC connection from this page to a bridge, shared by
// everything that goes straight between them without crossing the relay:
// cameras (live video on one of a few video slots, or pictures on a channel),
// printer pages and timelapses (channel "page") and uploads (channel
// "upload:<id>"). It is made once with one relay call (bridge.link_open); a
// camera or page that comes later only adds a channel or a short call. A short
// "disconnected" blip gets time to mend (watchLink); when the link really
// drops, everyone on it hears so at once and the next ask makes a new one.
import type { DirectCamera } from './camera';
import { STUN, gathered, watchLink } from './webrtc';

/** How long a new link gets to connect before the asker falls back to the relay. */
export const LINK_TIMEOUT_MS = 12_000;
/** Video slots the link carries: the most cameras with live video at once (the bridge's maxDirectCameras). */
export const VIDEO_SLOTS = 4;
/** After a link that never connected, the next try waits at least this long. */
export const RETRY_AFTER_MS = 20_000;

/** The bridge calls the link needs, over the relay. */
export interface LinkCalls {
  linkOpen(sdp: string): Promise<{ id: string; sdp: string; videoSlots?: number }>;
  linkClose(id: string): void;
  linkCamera(id: string, camera: DirectCamera): Promise<{ slot: number; mode: 'video' | 'pictures' }>;
  linkCameraClose(id: string, slot: number): void;
}

/** A link that is up. */
export interface LinkUp {
  id: string;
  pc: RTCPeerConnection;
  /** The live video on each slot (once the browser has it). */
  video(slot: number): MediaStream | undefined;
}

export class LinkNotUp extends Error {}

export class SharedLink {
  private up: LinkUp | null = null;
  private opening: Promise<LinkUp> | null = null;
  private dropped = new Set<() => void>();
  private failedAt = 0;

  constructor(
    private calls: LinkCalls,
    private now: () => number = Date.now,
  ) {}

  /** The link when it is up now, else null. */
  current(): LinkUp | null {
    return this.up && this.up.pc.connectionState === 'connected' ? this.up : null;
  }

  /** The last try never connected: this network seems to block direct links. */
  get blocked(): boolean {
    return !this.up && this.failedAt > 0;
  }

  /** The link, made now if there is none. Rejects when it can't connect. */
  ready(): Promise<LinkUp> {
    if (this.up) return Promise.resolve(this.up);
    if (this.opening) return this.opening;
    if (typeof RTCPeerConnection === 'undefined') return Promise.reject(new LinkNotUp('This browser has no direct links.'));
    if (this.failedAt && this.now() - this.failedAt < RETRY_AFTER_MS) return Promise.reject(new LinkNotUp('The direct link did not connect.'));
    const opening = this.open().then(
      (up) => {
        this.opening = null;
        this.failedAt = 0;
        this.up = up;
        return up;
      },
      (e: unknown) => {
        this.opening = null;
        this.failedAt = this.now();
        throw e;
      },
    );
    this.opening = opening;
    return opening;
  }

  /** Calls `f` once when the link that is up now (or the one being made) drops. Returns its undo. */
  onDrop(f: () => void): () => void {
    this.dropped.add(f);
    return () => void this.dropped.delete(f);
  }

  camera(up: LinkUp, camera: DirectCamera) {
    return this.calls.linkCamera(up.id, camera);
  }

  cameraClose(up: LinkUp, slot: number) {
    if (this.up === up) this.calls.linkCameraClose(up.id, slot);
  }

  /** Drops the link (the page's connection to the bridge closed); a later ask makes a new one. */
  close() {
    if (this.up) this.drop(this.up);
  }

  private drop(up: LinkUp) {
    if (this.up !== up) return;
    this.up = null;
    up.pc.close();
    this.calls.linkClose(up.id);
    const told = [...this.dropped];
    this.dropped.clear();
    for (const f of told) f();
  }

  private async open(): Promise<LinkUp> {
    const pc = new RTCPeerConnection({ iceServers: STUN });
    for (let i = 0; i < VIDEO_SLOTS; i++) pc.addTransceiver('video', { direction: 'recvonly' });
    // Every link starts with a channel: later ones open on it without asking the bridge again.
    pc.createDataChannel('link');
    const videos = new Map<number, MediaStream>();
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      const slot = /^slot(\d+)$/.exec(stream?.id ?? '');
      if (stream && slot) videos.set(Number(slot[1]), stream);
    };
    let id = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connected = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new LinkNotUp('The direct link did not connect in time.')), LINK_TIMEOUT_MS);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') resolve();
        if (pc.connectionState === 'failed') reject(new LinkNotUp('The direct link failed.'));
      };
    });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const answer = await this.calls.linkOpen(pc.localDescription?.sdp ?? '');
      id = answer.id;
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      await connected;
    } catch (e) {
      pc.close();
      if (id) this.calls.linkClose(id);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const up: LinkUp = { id, pc, video: (slot) => videos.get(slot) };
    watchLink(pc, () => this.drop(up));
    return up;
  }
}
