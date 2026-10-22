// Print alerts for the printer on the Device tab: whether this browser gets
// them, and which. Printers through a bridge keep this browser's choices with
// the relay, which pushes alerts even with every tab closed. Printers reached
// directly keep them in this browser and alert only while a tab is open: the
// page runs the same rules itself (src/device/alerts.ts) on the status it
// already gets.
import { create } from 'zustand';
import { alertText, type AlertPush } from '../device/alert-text';
import { AlertWatcher, cleanPrefs, defaultPrefs, detailsOf, fileFacts, PICTURE_EVENTS, snapshotOf, wants, watchFor, ENDS_PRINT, type AlertPrefs, type FileFacts } from '../device/alerts';
import { BridgeLink } from '../device/link/bridge';
import { allowNotifications, localClock, pushProblem, pushSubscription, relayPushKey, serviceWorker, type PushProblem } from '../device/push';
import { currentSession, useDevice, type SavedPrinter } from './device';

export type AlertsProblem = PushProblem | 'relay' | 'offline';

interface AlertsState {
  /** The saved printer these are for. */
  printerId: string | null;
  status: 'loading' | 'off' | 'on';
  /** Why alerts can't be turned on here, if they can't. */
  problem: AlertsProblem | null;
  prefs: AlertPrefs | null;
  busy: boolean;
  error: string;
  /** A note after a test alert. */
  note: string;
  /** Reads this browser's alerts for the printer on screen. */
  load(): Promise<void>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  save(prefs: AlertPrefs): Promise<void>;
  test(): Promise<void>;
}

const LOCAL_KEY = 'cloud-slicer:alerts:v1';

function localPrefs(): Record<string, AlertPrefs> {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).flatMap(([id, p]) => (cleanPrefs(p) ? [[id, cleanPrefs(p)!]] : [])));
  } catch {
    return {};
  }
}

function setLocalPrefs(id: string, prefs: AlertPrefs | null) {
  const all = localPrefs();
  if (prefs) all[id] = prefs;
  else delete all[id];
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: alerts last for this visit
  }
}

const active = (): SavedPrinter | undefined => {
  const d = useDevice.getState();
  return d.printers.find((p) => p.id === d.activeId);
};

/** The relay link of the printer on screen, when it is a bridge printer and connected. */
function bridgeLink(): BridgeLink | null {
  const link = currentSession()?.link;
  return link instanceof BridgeLink ? link : null;
}

async function relayCall<T>(params: Record<string, unknown>): Promise<T> {
  const link = bridgeLink();
  if (!link) throw new Error('Connect to the printer first.');
  return link.relay<T>('relay.alerts', params);
}

export const useAlerts = create<AlertsState>((set, get) => {
  let seq = 0;
  const fail = (e: unknown) => set({ busy: false, error: (e as Error).message || 'Something went wrong.' });

  return {
    printerId: null,
    status: 'loading',
    problem: null,
    prefs: null,
    busy: false,
    error: '',
    note: '',

    async load() {
      const p = active();
      const mine = ++seq;
      // Another printer starts from scratch; the same one is refreshed in place (a print ended and cleared "after layer N").
      if (get().printerId !== (p?.id ?? null)) set({ printerId: p?.id ?? null, status: 'loading', prefs: null, error: '', note: '', problem: null });
      if (!p) return;
      const problem = pushProblem(p.kind === 'bridge');
      if (p.kind === 'direct') {
        const prefs = localPrefs()[p.id] ?? null;
        const on = !!prefs && !problem && Notification.permission === 'granted';
        set({ status: on ? 'on' : 'off', prefs: on ? prefs : null, problem });
        return;
      }
      if (problem) return set({ status: 'off', problem });
      try {
        const key = await relayPushKey(p.relay);
        if (mine !== seq) return;
        if (!key) return set({ status: 'off', problem: 'relay' });
        const sub = await pushSubscription(key, false);
        if (!sub || Notification.permission !== 'granted') return mine === seq ? set({ status: 'off' }) : undefined;
        const { prefs } = await relayCall<{ prefs: unknown }>({ op: 'get', endpoint: sub.endpoint, clock: localClock() });
        if (mine !== seq) return;
        const clean = cleanPrefs(prefs);
        set({ status: clean ? 'on' : 'off', prefs: clean });
      } catch (e) {
        if (mine === seq) set({ status: 'off', problem: 'offline', error: (e as Error).message });
      }
    },

    async enable() {
      const p = active();
      if (!p) return;
      set({ busy: true, error: '', note: '' });
      try {
        if (!(await allowNotifications())) return set({ busy: false, problem: 'denied' });
        await serviceWorker();
        if (p.kind === 'direct') {
          const prefs = defaultPrefs();
          setLocalPrefs(p.id, prefs);
          return set({ busy: false, status: 'on', prefs });
        }
        const key = await relayPushKey(p.relay);
        if (!key) return set({ busy: false, problem: 'relay' });
        const sub = await pushSubscription(key, true);
        if (!sub) throw new Error('This browser did not make a push subscription.');
        const r = await relayCall<{ prefs: unknown }>({ op: 'set', ...sub, clock: localClock(), prefs: defaultPrefs() });
        set({ busy: false, status: 'on', prefs: cleanPrefs(r.prefs) });
      } catch (e) {
        fail(e);
      }
    },

    async disable() {
      const p = active();
      if (!p) return;
      set({ busy: true, error: '', note: '' });
      try {
        if (p.kind === 'direct') setLocalPrefs(p.id, null);
        else {
          const key = await relayPushKey(p.relay);
          const sub = key ? await pushSubscription(key, false) : null;
          if (sub) await relayCall({ op: 'set', endpoint: sub.endpoint, prefs: null });
        }
        set({ busy: false, status: 'off', prefs: null });
      } catch (e) {
        fail(e);
      }
    },

    async save(prefs) {
      const p = active();
      if (!p) return;
      const before = get().prefs;
      // Show the change at once.
      set({ prefs, error: '', note: '' });
      try {
        if (p.kind === 'direct') return setLocalPrefs(p.id, prefs);
        const key = await relayPushKey(p.relay);
        const sub = key ? await pushSubscription(key, false) : null;
        if (!sub) throw new Error('Turn alerts off and on again on this device.');
        const r = await relayCall<{ prefs: unknown }>({ op: 'set', ...sub, clock: localClock(), prefs });
        if (get().printerId === p.id) set({ prefs: cleanPrefs(r.prefs) ?? prefs });
      } catch (e) {
        set({ prefs: before, error: `Could not save: ${(e as Error).message}` });
      }
    },

    async test() {
      const p = active();
      if (!p) return;
      set({ busy: true, error: '', note: '' });
      try {
        if (p.kind === 'direct') await show({ ...alertText({ event: 'test' }, p.name), tag: `direct.${p.id}:test`, printer: `direct.${p.id}` });
        else {
          const key = await relayPushKey(p.relay);
          const sub = key ? await pushSubscription(key, false) : null;
          if (!sub) throw new Error('Turn alerts off and on again on this device.');
          await relayCall({ op: 'test', endpoint: sub.endpoint });
        }
        set({ busy: false, note: 'Sent. It should show in a few seconds.' });
      } catch (e) {
        fail(e);
      }
    },
  };
});

/** Shows an alert with this page's own service worker (direct printers, and test alerts for them). */
async function show(push: AlertPush) {
  const reg = await serviceWorker();
  await reg.showNotification(push.title, {
    body: push.body,
    tag: push.tag,
    icon: '/icons/icon-192.png',
    data: { printer: push.printer },
    ...(push.image && { image: push.image }),
  } as NotificationOptions);
}

// ---- Direct printers: the page watches, while it is open ----

const watchers = new Map<string, AlertWatcher>();
const facts = new Map<string, { file: string; facts: FileFacts }>();

async function picture(): Promise<string | undefined> {
  const s = currentSession();
  const cam = (await s?.webcams())?.find((c) => c.snapshotUrl);
  if (!s || !cam) return undefined;
  try {
    const blob = await s.link.snapshot(cam.snapshotUrl);
    return await new Promise<string>((ok, bad) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = bad;
      r.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

useDevice.subscribe((d, prev) => {
  if (d.objects === prev.objects) return;
  const p = d.printers.find((x) => x.id === d.activeId);
  if (!p || p.kind !== 'direct' || d.conn.state !== 'online') return;
  const prefs = localPrefs()[p.id];
  if (!prefs || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  let w = watchers.get(p.id);
  if (!w || prev.activeId !== d.activeId || prev.conn.state !== 'online') {
    w = new AlertWatcher();
    watchers.set(p.id, w);
  }
  const file = typeof d.objects.print_stats?.filename === 'string' ? d.objects.print_stats.filename : '';
  let est = facts.get(p.id);
  if (!est || est.file !== file) {
    const fresh = { file, facts: fileFacts(null) };
    est = fresh;
    facts.set(p.id, fresh);
    if (file)
      void currentSession()
        ?.metadata(file)
        .then((m) => {
          fresh.facts = fileFacts(m as Record<string, unknown> | null);
        });
  }
  for (const a of w.update(snapshotOf(d.objects, est.facts.estimate), watchFor([prefs]), Date.now())) {
    if (ENDS_PRINT.includes(a.event) && prefs.layer != null) {
      setLocalPrefs(p.id, { ...prefs, layer: null });
      if (useAlerts.getState().printerId === p.id) useAlerts.setState({ prefs: { ...prefs, layer: null } });
    }
    if (!wants(prefs, a)) continue;
    const details = detailsOf(d.objects, est.facts);
    const err = (a.event === 'paused' || a.event === 'failed' || a.event === 'error') && (d.errors.find((e) => !e.once) ?? d.errors[0]);
    if (err) details.error = { title: err.title, text: err.text, code: err.code };
    const push: AlertPush = { ...alertText({ ...a, details }, p.name, undefined, localClock()), tag: `direct.${p.id}:${a.event}`, printer: `direct.${p.id}` };
    void (async () => {
      const image = prefs.pictures && PICTURE_EVENTS.includes(a.event) ? await picture() : undefined;
      await show({ ...push, image }).catch(() => undefined);
    })();
  }
});
