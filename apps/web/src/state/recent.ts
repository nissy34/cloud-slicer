// Recent files (src/lib/recent.ts): the list and the files themselves are kept
// in this browser (IndexedDB), never uploaded.
import { create } from 'zustand';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import { addRecent, recentKey, type RecentFile } from '../lib/recent';

const LIST = 'cloud-slicer:recent-files:v1';
const fileKey = (key: string) => `cloud-slicer:recent-file:v1:${key}`;

interface RecentState {
  files: RecentFile[];
  /** Remembers files just opened from this device. */
  remember(files: File[]): Promise<void>;
  /** The stored file, or null when the browser no longer has it (it is then taken off the list). */
  load(entry: RecentFile): Promise<File | null>;
  clear(): Promise<void>;
}

// One change at a time, so two quick opens don't overwrite each other's list.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
};

export const useRecent = create<RecentState>()((set, get) => ({
  files: [],

  remember: (files) =>
    serial(async () => {
      const now = Date.now();
      const opened = files.map((f, i) => ({ key: recentKey(f), name: f.name, size: f.size, lastModified: f.lastModified, openedAt: now - i }));
      const { list, dropped } = addRecent(get().files, opened);
      try {
        for (const f of files) if (list.some((e) => e.key === recentKey(f))) await idbSet(fileKey(recentKey(f)), f);
        await idbSet(LIST, list);
        for (const key of dropped) await idbDel(fileKey(key));
        set({ files: list });
      } catch {
        // Storage full or blocked (private window): the list just stays as it was.
      }
    }),

  async load(entry) {
    const file = await idbGet<Blob>(fileKey(entry.key)).catch(() => undefined);
    if (file) return new File([file], entry.name, { type: file.type, lastModified: entry.lastModified });
    await serial(async () => {
      const list = get().files.filter((f) => f.key !== entry.key);
      set({ files: list });
      await idbSet(LIST, list).catch(() => {});
    });
    return null;
  },

  clear: () =>
    serial(async () => {
      const keys = get().files.map((f) => f.key);
      set({ files: [] });
      await idbSet(LIST, []).catch(() => {});
      for (const key of keys) await idbDel(fileKey(key)).catch(() => {});
    }),
}));

if (typeof indexedDB !== 'undefined')
  void idbGet<RecentFile[]>(LIST)
    .then((files) => files?.length && useRecent.setState({ files }))
    .catch(() => {});
