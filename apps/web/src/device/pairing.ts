// A bridge pairing code carries everything the browser needs to reach a
// bridge: the relay, the bridge id and its secret key. The agent prints it as
// a link (https://<site>/#pair=<code>) and as a bare code to paste.

import { currentRelay } from './config';

export interface Pairing {
  relay: string;
  bridgeId: string;
  key: string;
}

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

export function encodePairing(p: Pairing): string {
  return b64url(JSON.stringify({ r: p.relay, i: p.bridgeId, k: p.key }));
}

/** Accepts the bare code, or a whole pairing link. Null when it isn't one. */
export function decodePairing(text: string): Pairing | null {
  const raw = text.trim();
  const m = /[#&?]pair=([\w-]+)/.exec(raw);
  const code = m ? m[1] : raw;
  if (!/^[\w-]+$/.test(code)) return null;
  try {
    const o = JSON.parse(unb64url(code)) as { r?: unknown; i?: unknown; k?: unknown };
    if (typeof o.r !== 'string' || typeof o.i !== 'string' || typeof o.k !== 'string') return null;
    if (!/^https?:\/\//.test(o.r) || !/^[\w-]{8,64}$/.test(o.i) || o.k.length < 16) return null;
    return { relay: currentRelay(o.r), bridgeId: o.i, key: o.k };
  } catch {
    return null;
  }
}
