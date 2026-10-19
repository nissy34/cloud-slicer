// The fonts the Text tool can use in this page, and getting one into the
// engine before a text is made with it (src/lib/fonts.ts has the list).
import { BUNDLED_FONTS, DEFAULT_TEXT, computerFontName, fontFileName, type FontChoice, type TextStyle } from '../lib/fonts';
import type { EngineClient } from '../engine/client';

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

/** A font file the user picked (TTF, OTF, TTC); named after the file. */
export function addFontFile(file: File): FontChoice {
  const name = file.name.replace(/\.(ttf|otf|ttc)$/i, '');
  loaders.set(name, () => file.arrayBuffer());
  const choice: FontChoice = { name, source: 'file' };
  files = [...files.filter((f) => f.name !== name), choice];
  return choice;
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
