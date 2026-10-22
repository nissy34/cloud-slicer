// Small rules for saved projects, kept apart from the state so they can be tested.
import type { OrcaConfig, ProjectInfo, Selection } from '../engine/protocol';

export const UNTITLED = 'Untitled';

/** A project name from a file name: "benchy v2.3mf" -> "benchy v2". */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.(3mf|stl|obj|amf|step|stp)$/i, '').trim();
  return base.slice(0, 128) || UNTITLED;
}

/** A download name for a project: no characters file systems refuse. */
export function projectFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = name.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${safe || UNTITLED}.3mf`;
}

/** "Name (copy)", "Name (copy 2)", ... not taken by `taken`. */
export function copyName(name: string, taken: string[]): string {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, '');
  for (let n = 1; ; n++) {
    const candidate = `${base} (copy${n === 1 ? '' : ` ${n}`})`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** `name`, or "name (2)", "name (3)"... when another project already has it. */
export function freeName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) if (!taken.includes(`${name} (${n})`)) return `${name} (${n})`;
}

/**
 * What would be saved, as text: objects with their settings, instances and
 * paint flags, plates, the preset selection and the user's changes. Two equal
 * signatures mean nothing a save would keep has changed. (Paint strokes on
 * already painted parts don't show here; the project state tracks those.)
 */
export function projectSignature(project: ProjectInfo | null, selection: Selection | null, overrides: OrcaConfig): string {
  return JSON.stringify({
    objects: project?.objects ?? [],
    plates: project?.plates.map((p) => p.name) ?? [],
    selection,
    overrides,
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "just now", "5 min ago", "3 h ago", else the date. */
export function formatWhen(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const newProjectId = () => crypto.randomUUID();
