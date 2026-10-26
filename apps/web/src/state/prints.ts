// Print history of the open project (lib/prints.ts has the rules): its
// records from the account, what each plate prints now, and the printer's
// word on prints still going. Only saved projects of a signed-in person have
// one; everywhere else it stays empty and nothing shows.
//
// Records come from four places: the Send window (Upload only, Upload and
// print), the plate menu (Mark as printed / not printed, Keep as printed), the
// printer connected on the Device tab, whose job status turns a record into
// printing, then printed, failed or cancelled, for whichever project it
// belongs to, and the bridge, which tells the account the same with no page
// open (functions/_lib/prints.ts fromBridge); the page picks those up when it
// comes back into view, and every few minutes while a print is waiting.
import { create } from 'zustand';
import { api } from '../account/api';
import { job } from '../device/status';
import { changesBetween, nextStatus, OPEN_STATUSES, plateMarks, progressOf, type PlateMark, type PlateSummary, type PrintOrigin, type PrintRecord } from '../lib/prints';
import { useAccount } from './account';
import { onFileSent, useDevice } from './device';
import { useProjects } from './projects';
import { onPlateDeleted, useSlicer } from './store';

interface PrintsState {
  /** The open project's id these are for, or null. */
  projectId: string | null;
  records: PrintRecord[];
  /** What each plate prints now: plate -> fingerprint (missing until worked out). */
  fingerprints: Record<number, string>;
  summaries: Record<number, PlateSummary>;
  /** Every project's records still waiting for the printer (for the watcher). */
  open: PrintRecord[];
  /** The plate whose Print history window is open, or null. */
  historyPlate: number | null;
  /** The plate whose mark pop-up is open, or null. */
  markPlate: number | null;
  error: string;

  reload(): Promise<void>;
  mark(plate: number): Promise<void>;
  unmark(plate: number): Promise<void>;
  /** "Keep as printed": the plate as it is now counts as the one printed. */
  keep(plate: number): Promise<void>;
  openHistory(plate: number | null): void;
  openMark(plate: number | null): void;
}

const signedIn = () => useAccount.getState().status === 'signedIn';

export const usePrints = create<PrintsState>((set, get) => ({
  projectId: null,
  records: [],
  fingerprints: {},
  summaries: {},
  open: [],
  historyPlate: null,
  markPlate: null,
  error: '',

  async reload() {
    const id = useProjects.getState().current.id;
    if (!id || !signedIn()) return set({ projectId: id, records: [] });
    try {
      const records = await api.prints(id);
      if (useProjects.getState().current.id === id) set({ projectId: id, records, error: '' });
    } catch (e) {
      set({ projectId: id, records: [], error: (e as Error).message });
    }
    scheduleFingerprints(0);
  },

  async mark(plate) {
    const id = get().projectId;
    if (!id) return;
    const now = await current(plate);
    await add(id, { plate, status: 'marked', ...(now && { fingerprint: now.fingerprint, summary: now.summary }) });
  },

  async unmark(plate) {
    const id = get().projectId;
    if (id) await add(id, { plate, status: 'unmarked' });
  },

  async keep(plate) {
    const mark = marksNow()[plate];
    if (!mark || mark.state !== 'changed') return;
    const now = await current(plate);
    if (!now) return;
    try {
      const updated = await api.updatePrint(mark.record.id, { fingerprint: now.fingerprint, summary: now.summary });
      set({ records: get().records.map((r) => (r.id === updated.id ? updated : r)), error: '' });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  openHistory: (plate) => set({ historyPlate: plate, markPlate: null }),
  openMark: (plate) => set({ markPlate: plate }),
}));

async function add(projectId: string, p: Parameters<typeof api.addPrint>[1]) {
  try {
    const record = await api.addPrint(projectId, p);
    // The server closed the waiting ones this replaces: the same file on the same printer, or a mark of the plate.
    const mark = record.status === 'marked' || record.status === 'unmarked';
    const replaced = (r: PrintRecord) =>
      r.id !== record.id &&
      OPEN_STATUSES.includes(r.status) &&
      (mark ? r.projectId === record.projectId && r.plate === record.plate : r.printer === record.printer && r.file === record.file);
    const s = usePrints.getState();
    const open = s.open.filter((r) => !replaced(r) && r.id !== record.id);
    const others = s.records.filter((r) => r.id !== record.id);
    usePrints.setState({
      open: OPEN_STATUSES.includes(record.status) ? [...open, { ...record, summary: null }] : open,
      ...(s.projectId === projectId && { records: [...others.map((r) => (replaced(r) ? { ...r, status: 'unknown' as const, endedAt: record.at } : r)), record], error: '' }),
    });
    scheduleFingerprints(0);
  } catch (e) {
    usePrints.setState({ error: (e as Error).message });
  }
}

/** What plate `plate` prints now (worked out on the spot when not known yet). */
async function current(plate: number) {
  const s = usePrints.getState();
  if (s.fingerprints[plate] && s.summaries[plate]) return { fingerprint: s.fingerprints[plate], summary: s.summaries[plate] };
  try {
    return await useSlicer.getState().plateFingerprint(plate);
  } catch (e) {
    console.warn('Plate fingerprint:', e);
    return null;
  }
}

/** Each plate's mark right now. */
export function marksNow(): PlateMark[] {
  const s = usePrints.getState();
  const plates = useSlicer.getState().project?.plates.length ?? 0;
  return s.projectId && s.projectId === useProjects.getState().current.id ? plateMarks(s.records, plates, s.summaries) : [];
}

/** Each plate's mark, for components (empty when the project has no history). */
export function usePlateMarks(): PlateMark[] {
  usePrints((s) => s.records);
  usePrints((s) => s.summaries);
  usePrints((s) => s.projectId);
  useProjects((s) => s.current.id);
  useSlicer((s) => s.project?.plates.length);
  return marksNow();
}

/** "Printed 6 of 10" and the next plate to print, or null when nothing was printed yet. */
export function usePrintProgress() {
  const marks = usePlateMarks();
  const project = useSlicer((s) => s.project);
  if (!marks.length || marks.every((m) => m.state === 'none')) return null;
  return progressOf(marks, (p) => !project?.plates[p]?.objects.length);
}

/** What changed on a plate since it was printed, in words. */
export function changesSince(plate: number, record: PrintRecord): string[] {
  const now = usePrints.getState().summaries[plate];
  if (!record.summary || !now) return [];
  const options = useSlicer.getState().options;
  return changesBetween(record.summary, now, (k) => options[k]?.label);
}

// What each plate prints now: worked out a moment after anything changed, for
// the plates of a project with a history.
let timer: ReturnType<typeof setTimeout> | undefined;
let run = 0;
function scheduleFingerprints(delay = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => void refreshFingerprints(), delay);
}
async function refreshFingerprints() {
  const s = usePrints.getState();
  const slicer = useSlicer.getState();
  const plates = slicer.project?.plates.length ?? 0;
  if (!s.records.length || !plates || slicer.engine !== 'ready') return;
  const mine = ++run;
  const fingerprints: Record<number, string> = {};
  const summaries: Record<number, PlateSummary> = {};
  for (let p = 0; p < plates; p++) {
    try {
      const { fingerprint, summary } = await slicer.plateFingerprint(p);
      if (mine !== run) return;
      fingerprints[p] = fingerprint;
      summaries[p] = summary;
    } catch (e) {
      console.warn('Plate fingerprint:', e);
    }
  }
  if (mine === run) usePrints.setState({ fingerprints, summaries });
}

// Another project, or signing in or out: its history.
let lastId: string | null | undefined;
useProjects.subscribe((p) => {
  if (p.current.id === lastId) return;
  lastId = p.current.id;
  usePrints.setState({ records: [], fingerprints: {}, summaries: {}, historyPlate: null, markPlate: null });
  void usePrints.getState().reload();
});
let lastStatus = useAccount.getState().status;
useAccount.subscribe((a) => {
  if (a.status === lastStatus) return;
  lastStatus = a.status;
  void usePrints.getState().reload();
  void loadOpen();
});

// Anything that may change what a plate prints: the project in the engine, the settings, the towers.
let lastKey = '';
useSlicer.subscribe((s, prev) => {
  const key = s.printChangesKey();
  if (key === lastKey && s.project === prev.project && s.overrides === prev.overrides && s.baseConfig === prev.baseConfig && s.towers === prev.towers && s.mixDefinitions === prev.mixDefinitions && s.engine === prev.engine) return;
  lastKey = key;
  if (usePrints.getState().records.length) scheduleFingerprints();
});

// A plate deleted: its records go, later plates' move down one.
onPlateDeleted((plate, before) => {
  const id = usePrints.getState().projectId;
  if (!id || !usePrints.getState().records.length) return;
  const order = Array.from({ length: before }, (_, i) => i).filter((i) => i !== plate);
  usePrints.setState({ records: usePrints.getState().records.filter((r) => r.plate !== plate).map((r) => (r.plate > plate ? { ...r, plate: r.plate - 1 } : r)) });
  api.reorderPrints(id, order).catch((e) => usePrints.setState({ error: (e as Error).message }));
});

// The Send window put a file on a printer: a record for the plate it came from.
onFileSent(({ source, path, printer, started }) => {
  const origin: PrintOrigin | undefined = source.kind === 'upload' ? source.origin : undefined;
  if (!origin || !signedIn()) return;
  void add(origin.projectId, {
    plate: origin.plate,
    id: origin.printId,
    status: started ? 'sent' : 'uploaded',
    printer: printer.id,
    printerName: printer.name,
    file: path,
    fingerprint: origin.fingerprint,
    summary: origin.summary,
  });
});

/** Every project's prints still waiting for their printer. */
async function loadOpen() {
  if (!signedIn()) return usePrints.setState({ open: [] });
  try {
    usePrints.setState({ open: await api.openPrints() });
    watchPrinter();
  } catch {
    // tried again at the next sign-in or send
  }
}

/**
 * A print waiting for the printer on the Device tab: connect to it now, not
 * only when the Device tab opens, so a print that ended while no page watched
 * is caught (lib/prints.ts nextStatus). Only while records wait (a week at most).
 */
function watchPrinter() {
  const d = useDevice.getState();
  if (d.activeId && usePrints.getState().open.some((r) => r.printer === d.activeId)) d.start();
}

// The printer on the Device tab: its job turns waiting records into printing, then how it ended.
const updating = new Set<string>();
useDevice.subscribe((d, prev) => {
  if (d.activeId !== prev.activeId) watchPrinter();
  if (d.objects === prev.objects || !d.activeId) return;
  const open = usePrints.getState().open;
  if (!open.length) return;
  const j = job(d.objects);
  for (const r of open) {
    const status = nextStatus(r, d.activeId, j);
    if (!status || updating.has(r.id)) continue;
    updating.add(r.id);
    const ended = status !== 'printing';
    api
      .updatePrint(r.id, { status, ...(ended && { duration: Math.round(j.printSeconds) || null, progress: status === 'printed' ? 1 : j.progress }) })
      .then((u) => {
        const s = usePrints.getState();
        usePrints.setState({
          open: ended || !OPEN_STATUSES.includes(u.status) ? s.open.filter((x) => x.id !== r.id) : s.open.map((x) => (x.id === r.id ? { ...x, status: u.status } : x)),
          records: s.records.map((x) => (x.id === u.id ? { ...x, ...u, summary: x.summary } : x)),
        });
      })
      .catch((e) => console.warn('Print history:', e))
      .finally(() => updating.delete(r.id));
  }
});

// What the bridge told the account while the page was away (or, with a print waiting, every few minutes).
const REFRESH_MS = 3 * 60_000;
let refreshed = Date.now();
async function refresh() {
  if (!signedIn()) return;
  refreshed = Date.now();
  void loadOpen();
  const id = usePrints.getState().projectId;
  if (!id) return;
  try {
    const records = await api.prints(id);
    const had = usePrints.getState().records.length;
    if (usePrints.getState().projectId !== id) return;
    usePrints.setState({ records });
    // What the plates print now is worked out only for a project with a history.
    if (!had && records.length) scheduleFingerprints(0);
  } catch {
    // tried again later
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - refreshed > 10_000) void refresh();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && usePrints.getState().open.length && Date.now() - refreshed >= REFRESH_MS) void refresh();
  }, 30_000);
}

void loadOpen();
