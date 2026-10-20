// The fonts the Text tool can use in this page, and getting one into the
// engine before a text is made with it (src/lib/fonts.ts has the list).
import { BUNDLED_FONTS, DEFAULT_TEXT, computerFontName, fontFileName, type FontChoice, type TextStyle } from '../lib/fonts';
import type { EngineClient } from '../engine/client';
import { get as idbGet, set as idbSet } from 'idb-keyval';

// Font files the user picked are kept in this browser (IndexedDB), so texts
// made with them can still be changed after a reload.
const SAVED_FILES = 'cloud-slicer:font-files:v1';
type SavedFont = { name: string; data: ArrayBuffer };

const loaders = new Map<string, () => Promise<ArrayBuffer>>();
let computer: FontChoice[] = [];
let files: FontChoice[] = [];

/** Bundled fonts, then font files picked here, then the computer's (once allowed). */
export function availableFonts(): FontChoice[] {
  return [...BUNDLED_FONTS, ...files, ...computer];
}

/** Whether this browser can list the computer's fonts (Chrome and Edge on a computer). */
export function canListComputerFonts(): boolean {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window;
}

interface LocalFont {
  fullName: string;
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

/** Asks for the computer's fonts (the browser asks the user first); their names, sorted. */
export async function loadComputerFonts(): Promise<FontChoice[]> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
  if (!query) return [];
  const found = await query.call(window);
  const seen = new Set(availableFonts().map((f) => f.name));
  computer = [];
  for (const f of found) {
    const name = computerFontName(f);
    if (seen.has(name)) continue;
    seen.add(name);
    loaders.set(name, () => f.blob().then((b) => b.arrayBuffer()));
    computer.push({ name, source: 'computer' });
  }
  computer.sort((a, b) => a.name.localeCompare(b.name));
  return computer;
}

function addFile(name: string, load: () => Promise<ArrayBuffer>): FontChoice {
  loaders.set(name, load);
  const choice: FontChoice = { name, source: 'file' };
  files = [...files.filter((f) => f.name !== name), choice];
  return choice;
}

/** A font file the user picked (TTF, OTF, TTC); named after the file, and kept in this browser. */
export async function addFontFile(file: File): Promise<FontChoice> {
  const name = file.name.replace(/\.(ttf|otf|ttc)$/i, '');
  const data = await file.arrayBuffer();
  try {
    const saved = ((await idbGet<SavedFont[]>(SAVED_FILES)) ?? []).filter((f) => f.name !== name);
    await idbSet(SAVED_FILES, [...saved, { name, data }]);
  } catch (e) {
    console.warn('Font file not kept in this browser:', e);
  }
  return addFile(name, async () => data);
}

let restored: Promise<void> | null = null;
/**
 * Once per page: the font files kept in this browser, and the computer's
 * fonts again if the browser already allowed them (no new question).
 */
export function restoreFonts(): Promise<void> {
  restored ??= (async () => {
    try {
      for (const f of (await idbGet<SavedFont[]>(SAVED_FILES)) ?? []) if (!loaders.has(f.name)) addFile(f.name, async () => f.data);
    } catch (e) {
      console.warn('Kept font files:', e);
    }
    try {
      if (canListComputerFonts() && (await navigator.permissions.query({ name: 'local-fonts' as PermissionName })).state === 'granted') await loadComputerFonts();
    } catch {
      // no permission API for fonts: the user asks from the font list
    }
  })();
  return restored;
}

/** Puts font `name` in the engine's files if it isn't there yet; its path there. */
export async function fontInEngine(engine: EngineClient, name: string): Promise<string> {
  const path = fontFileName(name);
  if (await engine.hasFont(path)) return path;
  const bundled = BUNDLED_FONTS.find((f) => f.name === name);
  if (bundled) await engine.loadBundledFont(path, bundled.file!);
  else {
    const load = loaders.get(name);
    if (!load) throw new Error(`The font "${name}" isn't on this device. Pick another font for this text.`);
    await engine.loadFont(path, await load());
  }
  return path;
}

let lastStyle: TextStyle = DEFAULT_TEXT;
/** The style the next new text starts with: the last one used, like desktop. */
export const nextTextStyle = (): TextStyle => ({ ...lastStyle, text: DEFAULT_TEXT.text });
export function rememberTextStyle(style: TextStyle) {
  lastStyle = style;
}
