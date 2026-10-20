// The Recent files list: model and project files opened from this device,
// newest first, so they can be opened again without the phone's file picker
// (Android's picker opens sorted by name and forgets a change of sort).

export interface RecentFile {
  /** Name, size and file date together; the same file opened again replaces its old entry. */
  key: string;
  name: string;
  size: number;
  /** The file's own date, kept so the file opened again from the list has the same key. */
  lastModified: number;
  openedAt: number;
}

/** Entries kept. */
export const RECENT_MAX = 10;
/** Files bigger than this aren't kept (the browser's storage on a phone is limited). */
export const RECENT_FILE_MAX_BYTES = 100 * 1024 * 1024;
/** All kept files together stay under this; the oldest go first. */
export const RECENT_TOTAL_MAX_BYTES = 250 * 1024 * 1024;

export const recentKey = (f: { name: string; size: number; lastModified: number }) => `${f.name}|${f.size}|${f.lastModified}`;

/**
 * The list after opening `opened` (newest first), and the keys whose stored
 * files can be dropped.
 */
export function addRecent(list: RecentFile[], opened: RecentFile[]): { list: RecentFile[]; dropped: string[] } {
  const fresh = opened.filter((f) => f.size <= RECENT_FILE_MAX_BYTES);
  const keys = new Set(fresh.map((f) => f.key));
  const all = [...fresh, ...list.filter((f) => !keys.has(f.key))];
  const kept: RecentFile[] = [];
  let total = 0;
  for (const f of all) {
    if (kept.length >= RECENT_MAX || total + f.size > RECENT_TOTAL_MAX_BYTES) continue;
    kept.push(f);
    total += f.size;
  }
  const keep = new Set(kept.map((f) => f.key));
  return { list: kept, dropped: list.filter((f) => !keep.has(f.key)).map((f) => f.key) };
}
