// This browser's side of print alerts: notification permission, the service
// worker (public/sw.js, which shows alerts with the page closed) and its push
// subscription, made with the relay's public push key.

export type PushProblem =
  /** iPhone or iPad in Safari: alerts need the site added to the Home Screen first. */
  | 'ios-home'
  /** The browser has no notifications or push (or this isn't a secure page). */
  | 'unsupported'
  /** Notifications are blocked for this site. */
  | 'denied'
  /** The Allow question was closed without an answer; turning alerts on asks again. */
  | 'dismissed';

export const isIos = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/** Opened as an installed app (Home Screen icon) rather than in a browser tab. */
export const standalone = () => typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

/** What stops alerts here, or null. `push`: needs Web Push (bridge printers), not just notifications. */
export function pushProblem(push: boolean): PushProblem | null {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIos() && !standalone()) return 'ios-home';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !window.isSecureContext) return 'unsupported';
  if (push && !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return null;
}

/** "this phone", "this computer": what the Alerts card calls this device. */
export function thisDevice(): string {
  if (typeof navigator === 'undefined') return 'this device';
  if (/iPad|Tablet/i.test(navigator.userAgent) || (isIos() && !/iPhone|iPod/.test(navigator.userAgent))) return 'this tablet';
  return /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) ? 'this phone' : 'this computer';
}

/** The service worker, registered now if the page hasn't yet (it is registered on load in production). */
export async function serviceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/**
 * Asks for permission to show notifications (only from a tap): 'granted', or
 * 'denied' when blocked, or 'default' when the question was closed unanswered
 * (or, in an app installed from Chrome on Android, never shown).
 */
export async function allowNotifications(): Promise<NotificationPermission> {
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

const fromBase64Url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
};

/** This browser's push subscription for the relay's key, made if needed (after permission). */
export async function pushSubscription(relayKey: string, create: boolean): Promise<PushSubscriptionJSON | null> {
  const reg = await serviceWorker();
  const key = fromBase64Url(relayKey);
  let sub = await reg.pushManager.getSubscription();
  // Made for another relay's key: only one subscription per site, so start over.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    if (!create) return null;
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub ? sub.toJSON() : null;
}

/** The relay's public push key, or null when it can't send alerts. */
const relayKeys = new Map<string, Promise<string | null>>();
export function relayPushKey(relay: string): Promise<string | null> {
  const base = relay.replace(/\/+$/, '');
  let k = relayKeys.get(base);
  if (!k) {
    k = fetch(`${base}/v1/info`)
      .then((r) => r.json() as Promise<{ push?: unknown }>)
      .then((i) => (typeof i.push === 'string' ? i.push : null))
      .catch(() => {
        relayKeys.delete(base);
        return null;
      });
    relayKeys.set(base, k);
  }
  return k;
}

/** This browser's time zone and 12/24 h, so a bridge's alerts can say "done about 14:35" in it. */
export function localClock(): { timeZone?: string; hour12: boolean } {
  try {
    const o = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    return { timeZone: o.timeZone, hour12: o.hour12 === true };
  } catch {
    return { hour12: false };
  }
}
