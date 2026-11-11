// Small rules for saved projects, kept apart from the state so they can be tested.
import type { OrcaConfig, ProjectInfo, Selection } from '../engine/protocol';
import { i18n } from '../i18n';

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

/** How far an upload got, in the total's unit: "12 of 40 MB", "3.5 of 8.2 MB". */
export function sentOf(sent: number, total: number): string {
  const unit = formatBytes(total);
  const n = unit.split(' ')[0];
  const digits = n.includes('.') ? n.split('.')[1].length : 0;
  const scale = unit.endsWith(' MB') ? 1024 * 1024 : unit.endsWith(' KB') ? 1024 : 1;
  return `${sent <= 0 ? 0 : (Math.min(sent, total) / scale).toFixed(digits)} of ${unit}`;
}

/** "just now", "5 min ago", "3 h ago", else the date. */
export function formatWhen(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return i18n.t('time.justNow');
  if (s < 3600) return i18n.t('time.minAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return i18n.t('time.hoursAgo', { n: Math.floor(s / 3600) });
  return new Date(ms).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const newProjectId = () => crypto.randomUUID();

/** How Online projects orders its list (the Sort picker). */
export type ProjectSort = 'newest' | 'oldest' | 'name' | 'size';
export const PROJECT_SORTS: { value: ProjectSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'size', label: 'Biggest first' },
];

/** The projects whose name holds every word typed in Search (any case), in the chosen order. */
export function findProjects<P extends { name: string; updatedAt: number; size: number }>(projects: P[], search: string, sort: ProjectSort): P[] {
  const words = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const found = projects.filter((p) => {
    const name = p.name.toLocaleLowerCase();
    return words.every((w) => name.includes(w));
  });
  const byName = (a: P, b: P) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const order: Record<ProjectSort, (a: P, b: P) => number> = {
    newest: (a, b) => b.updatedAt - a.updatedAt,
    oldest: (a, b) => a.updatedAt - b.updatedAt,
    name: byName,
    size: (a, b) => b.size - a.size || byName(a, b),
  };
  return [...found].sort(order[sort]);
}
