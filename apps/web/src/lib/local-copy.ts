// AutoSave: unsaved work kept in this browser (IndexedDB), for everyone, signed
// in or not: after a crash or a closed tab the Continue card offers it back. It
// never leaves the browser; only Save puts a project in the person's Google
// Drive. One copy per browser: the newest unsaved work replaces the one before,
// and it is dropped once the work is saved.
import { createStore, del, get, set } from 'idb-keyval';
import type { EngineFlavor } from './engines';

export interface LocalCopy {
  /** The project as Orca's 3MF, like Save makes it. */
  file: Blob;
  /** The list picture, when the page could take one. */
  picture: Blob | null;
  name: string;
  /** The online project it came from (null: never saved online), and that version. */
  id: string | null;
  version: number;
  engine: EngineFlavor;
  savedAt: number;
}

const KEY = 'unsaved';
let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore('cloud-slicer-unsaved', 'work'));

/** The unsaved work kept here, or null (none, or the browser keeps no storage). */
export async function loadLocalCopy(): Promise<LocalCopy | null> {
  try {
    const copy = await get<LocalCopy>(KEY, db());
    return copy && copy.file instanceof Blob && copy.file.size > 0 ? copy : null;
  } catch {
    return null;
  }
}

/** True when it was kept (false: a private window or a full disk, so the work just isn't kept here). */
export async function saveLocalCopy(copy: LocalCopy): Promise<boolean> {
  try {
    await set(KEY, copy, db());
    return true;
  } catch (e) {
    console.warn('Unsaved work not kept in this browser:', e);
    return false;
  }
}

export async function clearLocalCopy(): Promise<void> {
  try {
    await del(KEY, db());
  } catch {
    // nothing kept
  }
}
