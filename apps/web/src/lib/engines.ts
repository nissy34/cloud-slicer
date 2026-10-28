// The two slicing engines (engine/README.md, "Two engines"): Snapmaker Orca and
// upstream OrcaSlicer. Each project slices with one of them; new projects use
// the default picked in the setup wizard.
import { Unzip, UnzipInflate } from 'fflate';

export type EngineFlavor = 'snapmaker' | 'orca';

export const ENGINES: { id: EngineFlavor; name: string; blurb: string; examples: string[] }[] = [
  {
    id: 'snapmaker',
    name: 'Snapmaker Orca',
    blurb: "Snapmaker's own OrcaSlicer, made for the U1.",
    examples: ['Colour mixing: print two filaments as a new colour', 'Standard and high flow filament settings', "Snapmaker's U1 presets"],
  },
  {
    id: 'orca',
    name: 'OrcaSlicer',
    blurb: 'The community OrcaSlicer 2.4.2, with its own presets.',
    examples: ['The newest OrcaSlicer fixes and settings', "OrcaSlicer's own U1 presets", 'No colour mixing'],
  },
];

export const engineName = (flavor: EngineFlavor) => ENGINES.find((e) => e.id === flavor)!.name;
/** Each engine's version (from its version.inc at build time), empty when the build didn't have its sources. */
export const engineRelease = (flavor: EngineFlavor): string =>
  (import.meta.env.VITE_ENGINE_RELEASES as Record<EngineFlavor, string> | undefined)?.[flavor] ?? '';
export const isFlavor = (v: unknown): v is EngineFlavor => v === 'snapmaker' || v === 'orca';

/** Where the engine is served from: public/engine/ or public/engine-orca/. */
export const engineFolder = (flavor: EngineFlavor) => (flavor === 'orca' ? 'engine-orca' : 'engine');

/** ?engine=orca (or snapmaker) in the page address starts with that engine; tests use it. */
export function engineFromUrl(): EngineFlavor | null {
  const v = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('engine');
  return isFlavor(v) ? v : null;
}

/**
 * Which engine made a 3MF project, from the metadata at the top of its
 * 3D/3dmodel.model: Snapmaker Orca writes Application "Snapmaker_Orca-…",
 * OrcaSlicer (desktop or this site) an "OrcaSlicer" entry. Null for anything
 * else (Bambu Studio, PrusaSlicer, a plain 3MF), which opens with the engine
 * already running.
 */
export function engineOfModelHead(head: string): EngineFlavor | null {
  if (/<metadata name="Application">\s*Snapmaker_Orca/.test(head)) return 'snapmaker';
  if (/<metadata name="OrcaSlicer">/.test(head)) return 'orca';
  return null;
}

/**
 * The program that wrote a 3MF, for messages: "Bambu Studio 2.5" from Application
 * "BambuStudio-02.05.00.66", the engine's name for the two engines, else the
 * Application entry as written ("" when there is none).
 */
export function appOfModelHead(head: string): string {
  const engine = engineOfModelHead(head);
  if (engine) return engineName(engine);
  const app = /<metadata name="Application">\s*([^<]*?)\s*<\/metadata>/.exec(head)?.[1] ?? '';
  const bambu = /^BambuStudio-0*(\d+)\.0*(\d+)/.exec(app);
  return bambu ? `Bambu Studio ${bambu[1]}.${bambu[2]}` : app;
}

/** engineOfModelHead for a 3MF file; reads only the start of its model. */
export async function engineOf3mf(file: Blob): Promise<EngineFlavor | null> {
  return engineOfModelHead(await modelHeadOf3mf(file));
}

/** The start of a 3MF's 3D/3dmodel.model, up to its first object: the metadata. */
export async function modelHeadOf3mf(file: Blob): Promise<string> {
  let head = '';
  let done = false;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (f) => {
    if (f.name !== '3D/3dmodel.model') return;
    const text = new TextDecoder();
    f.ondata = (err, chunk, final) => {
      if (done) return;
      if (!err) head += text.decode(chunk, { stream: true });
      // The metadata comes before the first object.
      if (err || final || head.length > 64 * 1024 || head.includes('<resources')) {
        done = true;
        f.terminate();
      }
    };
    f.start();
  };
  try {
    const reader = file.stream().getReader();
    while (!done) {
      const { value, done: end } = await reader.read();
      if (end) {
        unzip.push(new Uint8Array(0), true);
        break;
      }
      unzip.push(value);
    }
    await reader.cancel().catch(() => {});
  } catch {
    // Not a zip, or unreadable: the engine says what is wrong when it opens it.
  }
  return head;
}
