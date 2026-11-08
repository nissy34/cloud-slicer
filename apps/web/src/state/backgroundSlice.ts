// While a plate slices: keep the phone's screen awake, show the progress in the
// tab title, and when the slice ends while the page is hidden on a computer, say
// so with a notification (only when notifications are already allowed, for print
// alerts). Not on phones and tablets: there a hidden page stops slicing, so the
// slicer has to stay on screen anyway and a notification would only be odd.
// A page hidden on a phone gets paused by the browser, so keeping the screen on
// is what keeps a long slice going. docs/architecture/background-slicing.md.
import { endNotice, slicingTitle, type SliceEnd } from '../lib/backgroundSlice';
import { useSlicer } from './store';

let lock: WakeLockSentinel | null = null;
let asking = false;
let baseTitle = '';

const slicing = () => useSlicer.getState().job.kind === 'slicing';

async function keepAwake() {
  if (lock || asking || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  asking = true;
  try {
    const got = await navigator.wakeLock.request('screen');
    if (slicing()) {
      lock = got;
      got.addEventListener('release', () => {
        if (lock === got) lock = null;
      });
    } else void got.release();
  } catch {
    // Refused (battery saver, or the page lost focus meanwhile): the screen sleeps as usual.
  } finally {
    asking = false;
  }
}

function letSleep() {
  const l = lock;
  lock = null;
  void l?.release().catch(() => {});
}

/** A phone or tablet (touch first), like the rest of the app decides it. */
const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

async function notify(end: SliceEnd) {
  if (document.visibilityState === 'visible' || touch() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration('/');
  if (!reg) return;
  const { title, body } = endNotice(end, useSlicer.getState().project?.plates.length ?? 1);
  await reg.showNotification(title, { body, tag: 'slice', icon: '/icons/icon-192.png', data: { slice: true } }).catch(() => {});
}

// The browser drops the wake lock whenever the page is hidden; take it again on return.
document.addEventListener('visibilitychange', () => {
  if (slicing()) void keepAwake();
});

useSlicer.subscribe((s, prev) => {
  const was = prev.job.kind === 'slicing' ? prev.job : null;
  const now = s.job.kind === 'slicing' ? s.job : null;
  if (now && !was) {
    baseTitle = document.title;
    void keepAwake();
  }
  if (now) document.title = slicingTitle(now.pct, baseTitle);
  if (!was || now) return;
  document.title = baseTitle;
  letSleep();
  const sliced = s.slices[was.plate];
  if (sliced && sliced !== prev.slices[was.plate]) void notify({ kind: 'done', plate: was.plate });
  else if (s.job.kind === 'error') void notify({ kind: 'failed', message: s.job.message });
  else if (s.gcodeFallback && !prev.gcodeFallback) void notify({ kind: 'question' });
});
