// Print alerts: browsers that turned alerts on leave their push subscription
// and choices with the bridge's Durable Object; the bridge agent watches its
// printers and sends {ctl:'alert'} when something happens; the relay turns that
// into Web Push messages, encrypted for each browser (RFC 8291, done by the
// web-push library) and signed with the relay's VAPID key, so the push services
// (Google, Apple, Mozilla, Microsoft) see only that a message arrived.
//
// Nothing about an alert is logged or kept, except a camera picture, which
// waits in R2 under alerts/ until the bucket's lifecycle rule deletes it a day later.
import webpush from 'web-push';
import { cameraKey, cleanPrefs, cleanPrinterPrefs, ENDS_PRINT, PICTURE_EVENTS, watchFor, wants, type AlertEvent, type AlertPrefs, type FiredAlert, type PrintDetails } from '../../web/src/device/alerts';
import { alertText, type AlertPush, type Clock } from '../../web/src/device/alert-text';
import { describeU1Error, type Words } from '../../web/src/device/addons/u1-errors';
import u1Words from '../../web/src/device/addons/u1-errors.json';
import { describeBambuErrors, type BambuWords } from '../../web/src/device/addons/bambu-errors';
import bambuWords from '../../web/src/device/addons/bambu-errors.json';

export interface PushEnv {
  /** The relay's push key (an ES256 private JWK), made once by CI (.github/workflows/device.yml). Unset: no alerts. */
  VAPID_KEY?: string;
  /** Who runs this relay, for the push services; defaults to the site. */
  PUSH_SUBJECT?: string;
  /** Tests only: lets push go to a pretend push service on 127.0.0.1. */
  PUSH_TEST_ENDPOINTS?: string;
  DOWNLOADS?: R2Bucket;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** One browser, as the bridge's Durable Object keeps it: where to push, and its choices per printer. */
export interface StoredSub extends PushSubscriptionJSON {
  /** The account that turned it on (signed-in relays), so blocking the account drops it. */
  user?: string;
  printers: Record<string, AlertPrefs>;
  /** How that browser shows times, for "done about 14:35". */
  clock?: Clock;
}

/** The time zone and 12/24 h a browser sent, if this runtime knows the zone. */
export function cleanClock(raw: unknown): Clock | undefined {
  const r = raw as { timeZone?: unknown; hour12?: unknown } | null;
  if (!r || typeof r !== 'object') return undefined;
  const hour12 = r.hour12 === true;
  if (typeof r.timeZone !== 'string' || r.timeZone.length > 64) return { hour12 };
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: r.timeZone });
    return { timeZone: r.timeZone, hour12 };
  } catch {
    return { hour12 };
  }
}

/** Browsers per bridge that can have alerts on. */
export const MAX_SUBS = 20;
/** At most this many alerts per bridge per hour, and this many pictures. */
export const MAX_ALERTS_PER_HOUR = 120;
export const MAX_PICTURES_PER_HOUR = 30;
/** A picture bigger than this is not kept. */
export const MAX_PICTURE = 600 * 1024;
/** How long after the bridge drops before the "bridge offline" alert. */
export const OFFLINE_AFTER_MS = 10 * 60_000;

const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const SITE = 'https://slicer.awesomestuff.qzz.io';

/** Only the browsers' real push services; never an address someone typed (the relay would post to it). */
export function pushEndpointOk(env: PushEnv, endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (env.PUSH_TEST_ENDPOINTS === '1' && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;
  return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

export async function subKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return `push:${[...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The public half of the push key, as browsers pass it to pushManager.subscribe (base64url, uncompressed point). */
export function vapidPublicKey(env: PushEnv): string | null {
  const k = vapidKeys(env);
  return k?.publicKey ?? null;
}

function vapidKeys(env: PushEnv): { publicKey: string; privateKey: string } | null {
  if (!env.VAPID_KEY) return null;
  try {
    const jwk = JSON.parse(env.VAPID_KEY) as { x: string; y: string; d: string };
    const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
    return { publicKey: point.toString('base64url'), privateKey: jwk.d };
  } catch {
    return null;
  }
}

export function cleanSubscription(raw: unknown): PushSubscriptionJSON | null {
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!r || typeof r.endpoint !== 'string' || r.endpoint.length > 1024) return null;
  const { p256dh, auth } = r.keys ?? {};
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint: r.endpoint, keys: { p256dh, auth } };
}

/** Sends one push message. 'gone' means the browser dropped the subscription and it should be forgotten. */
export async function sendPush(env: PushEnv, sub: PushSubscriptionJSON, push: AlertPush, urgent: boolean): Promise<'ok' | 'gone' | 'failed'> {
  const keys = vapidKeys(env);
  if (!keys) return 'failed';
  try {
    const d = webpush.generateRequestDetails(sub, JSON.stringify(push), {
      vapidDetails: { subject: env.PUSH_SUBJECT || SITE, ...keys },
      TTL: 24 * 3600,
      urgency: urgent ? 'high' : 'normal',
      contentEncoding: 'aes128gcm',
    });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.headers)) if (k.toLowerCase() !== 'content-length') headers[k] = String(v);
    const res = await fetch(d.endpoint, { method: 'POST', headers, body: d.body });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

/** A stored subscription with every printer's choices up to date (see cleanPrinterPrefs). */
export function readSub<T extends StoredSub | undefined>(s: T): T {
  return s && { ...s, printers: cleanPrinterPrefs(s.printers) };
}

/**
 * What each printer's watcher on the bridge should look for, over every browser with alerts on.
 * `cameras`: for each alert, every different choice of cameras asked for; the bridge sends one
 * picture per choice. `pictures` is for bridges from before cameras could be chosen (the first
 * camera on the key alerts).
 */
export function agentConfig(
  subs: StoredSub[],
): Record<string, { events: AlertEvent[]; layers: number[]; percents: number[]; hours: boolean; pictures: boolean; cameras: Partial<Record<AlertEvent, string[][]>> }> {
  const by = new Map<string, AlertPrefs[]>();
  for (const s of subs) for (const [printer, prefs] of Object.entries(s.printers)) by.set(printer, [...(by.get(printer) ?? []), prefs]);
  const out: ReturnType<typeof agentConfig> = {};
  for (const [printer, all] of by) {
    const events = new Set<AlertEvent>();
    for (const p of all) for (const e of p.events) if (e !== 'offline') events.add(e);
    if (all.some((p) => p.layer != null)) events.add('layer');
    if (!events.size) continue;
    const cameras: Partial<Record<AlertEvent, string[][]>> = {};
    for (const e of events) {
      const sets = new Map<string, string[]>();
      for (const p of all) if (p.cameras[e]?.length && (e === 'layer' ? p.layer != null : p.events.includes(e))) sets.set(cameraKey(p.cameras[e]!), p.cameras[e]!);
      if (sets.size) cameras[e] = [...sets.values()];
    }
    const pictures = PICTURE_EVENTS.some((e) => cameras[e]);
    out[printer] = { events: [...events], ...watchFor(all), pictures, cameras };
  }
  return out;
}

/** An alert as the bridge sends it, checked. */
export function cleanAlert(raw: Record<string, unknown>): FiredAlert | null {
  const events: AlertEvent[] = ['started', 'layer1', 'layer3', 'layer', 'progress', 'almostDone', 'stillPrinting', 'finished', 'resumed', 'bedCooled', 'failed', 'paused', 'error'];
  if (!events.includes(raw.event as AlertEvent)) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v) : undefined);
  const d = (raw.details ?? {}) as Record<string, unknown>;
  const details: PrintDetails = {};
  for (const k of ['percent', 'layer', 'total', 'left', 'printed', 'estimate', 'usedMm', 'totalMm'] as const) {
    const v = n(d[k]);
    if (v !== undefined) details[k] = v;
  }
  if (typeof d.totalG === 'number' && d.totalG > 0 && d.totalG < 1e6) details.totalG = Math.round(d.totalG * 10) / 10;
  if (typeof d.runout === 'string' && d.runout) details.runout = d.runout.slice(0, 40);
  // The U1's own errors: in Snapmaker's words, the newest first.
  if (Array.isArray(raw.exceptions) && raw.exceptions.length) {
    const e = describeU1Error(raw.exceptions[raw.exceptions.length - 1], u1Words as unknown as Words);
    if (e) details.error = { title: e.title.slice(0, 80), text: e.text.slice(0, 300), code: e.code };
  }
  // A Bambu Lab printer's: its print error and health messages, as its report has them.
  if (!details.error && raw.bambu && typeof raw.bambu === 'object') {
    const e = describeBambuErrors(raw.bambu, bambuWords as unknown as BambuWords)[0];
    if (e) details.error = { title: e.title.slice(0, 80), text: e.text.slice(0, 300), code: e.code };
  }
  return {
    details,
    event: raw.event as AlertEvent,
    file: typeof raw.file === 'string' ? raw.file.slice(0, 200) : '',
    layer: n(raw.layer),
    total: n(raw.total),
    percent: n(raw.percent),
    left: n(raw.left),
    duration: n(raw.duration),
    hours: n(raw.hours),
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 160) : undefined,
  };
}

export const urgentEvent = (e: AlertEvent) => e === 'failed' || e === 'paused' || e === 'error' || e === 'offline';

/** Who gets this alert, and the push for each. Also says which subscriptions to forget their "after layer N" for. */
export function fanOut(
  subs: [string, StoredSub][],
  printer: { id: string; name: string },
  bridgeId: string,
  alert: FiredAlert,
  /** Picture addresses by choice of cameras (cameraKey), and the one picture an older bridge sends. */
  images: { byCameras: Record<string, string>; single?: string },
): { to: [string, StoredSub, AlertPush][]; clearLayer: string[] } {
  const to: [string, StoredSub, AlertPush][] = [];
  const clearLayer: string[] = [];
  for (const [key, s] of subs) {
    const prefs = s.printers[printer.id];
    if (!prefs) continue;
    const cams = prefs.cameras[alert.event];
    const image = cams?.length ? (images.byCameras[cameraKey(cams)] ?? images.single) : undefined;
    if (wants(prefs, alert))
      to.push([key, s, { ...alertText(alert, printer.name, undefined, s.clock), tag: `${bridgeId}.${printer.id}:${alert.event}`, printer: `${bridgeId}.${printer.id}`, ...(image && { image }) }]);
    if (ENDS_PRINT.includes(alert.event) && prefs.layer != null) clearLayer.push(key);
  }
  return { to, clearLayer };
}

export { cleanPrefs };
