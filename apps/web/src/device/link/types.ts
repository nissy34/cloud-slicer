// A link is one way of reaching a printer's Moonraker: straight from the
// browser, or through the LAN bridge. Either way the session above it speaks
// Moonraker's JSON-RPC over one socket; only file upload and camera frames,
// which Moonraker serves over plain HTTP, need their own calls.

import type { DirectCamera } from '../camera';

export type RpcMessage = {
  jsonrpc?: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** What the bridge reports about itself, alongside the printer's own messages. */
export interface BridgeStatus {
  agent: 'online' | 'offline';
  printers: { id: string; name: string }[];
  version?: string;
  /** When the bridge was built (the commit's Unix time); "0" or missing for a build that doesn't update itself. */
  build?: string;
  /** 'printer' when the bridge runs on the printer's own Klipper computer. */
  place?: 'printer';
  /** The bridge computer's system (win32, darwin, linux). */
  system?: string;
  /** The bridge computer's name (bridges from this build on). */
  host?: string;
}

export interface LinkHandlers {
  onMessage(msg: RpcMessage): void;
  /** The socket closed or failed; `reason` is shown to the user. */
  onClose(reason: string): void;
  onBridge?(status: BridgeStatus): void;
}

export interface PrinterLink {
  /** Where the link goes, for the UI ("192.168.1.20" or "via bridge"). */
  readonly label: string;
  open(handlers: LinkHandlers): Promise<void>;
  send(msg: RpcMessage): void;
  close(): void;
  /** Uploads to the gcodes root; never starts a print. Resolves to the stored path. */
  upload(blob: Blob, path: string, onProgress?: (fraction: number) => void): Promise<string>;
  /** One camera frame. `url` may be relative to the printer ("/webcam/?action=snapshot"). */
  snapshot(url: string): Promise<Blob>;
  /**
   * A camera address the browser can load itself (MJPEG stream, player page,
   * WebRTC signalling), or null when only single frames can be fetched.
   */
  mediaUrl(url: string): string | null;
  /**
   * Bridge links only: asks the bridge to send a camera straight to this
   * browser. Takes the browser's WebRTC offer, resolves to the bridge's answer
   * and whether live video or pictures will come.
   */
  cameraOpen?(camera: DirectCamera, sdp: string): Promise<DirectAnswer>;
  cameraClose?(id: string): void;
}

export interface DirectAnswer {
  id: string;
  mode: 'video' | 'pictures';
  sdp: string;
  /** With pictures: why the camera's live video isn't used, in plain words. */
  why?: string;
}

export class LinkError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'network' | 'auth' | 'http' | 'timeout' | 'bridge' = 'network',
  ) {
    super(message);
  }
}
