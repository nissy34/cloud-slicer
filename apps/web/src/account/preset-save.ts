// Saving the settings on screen into a user preset, shared by the ⋯ menu
// beside each picker and the printer / filament settings windows. A preset is
// saved as a diff over the system preset it inherits, with a part per engine
// (src/lib/preset-engines.ts): what the running engine saves never changes
// the other engine's own part.
import type { OrcaConfig, PresetSummary, Selection } from '../engine/protocol';
import { i18n } from '../i18n';
import { presetFromEngine, upgradePreset, useSameValues } from '../lib/preset-engines';
import { listUserPresets, presetEdit, saveUserPreset } from '../state/account';
import { useSlicer } from '../state/store';
import type { PresetType } from './api';
import { META, presetEdited, systemParent } from './preset-diff';
import { presetNameError } from './api';

/** The presets a picker of `type` offers. */
export function presetList(type: PresetType): PresetSummary[] {
  const s = useSlicer.getState();
  return type === 'printer' ? s.printers : type === 'process' ? s.processes : s.filaments;
}

/** The preset a picker (filament slot) has selected. */
export function selectedName(selection: Selection | null, type: PresetType, slot?: number): string {
  if (!selection) return '';
  if (type === 'printer') return selection.printer;
  if (type === 'process') return selection.process;
  return selection.filaments[slot ?? 0] ?? '';
}

/** Whether a preset of `type` already has this name. */
export const presetTaken = (type: PresetType, name: string) =>
  presetList(type).some((p) => p.name === name) || listUserPresets(type).some((p) => p.name === name);

/** The selection with this picker pointing at `name`. */
export function selectionWith(type: PresetType, name: string, slot?: number): Partial<Selection> {
  if (type === 'printer') return { printer: name };
  if (type === 'process') return { process: name };
  const filaments = useSlicer.getState().selection?.filaments ?? [];
  return { filaments: filaments.map((f, i) => (i === (slot ?? 0) ? name : f)) };
}

/** `target` with the current changes: its base preset, and its settings before and after the changes. */
async function editsFor(type: PresetType, target: PresetSummary, slot?: number): Promise<EngineEdits> {
  const s = useSlicer.getState();
  const inherits = systemParent(target);
  const [ownCfg, parentCfg] = await Promise.all([s.presetConfig(type, target.name), s.presetConfig(type, inherits)]);
  if (!ownCfg || !parentCfg) throw new Error(i18n.t('presetSave.notAvailable', { name: inherits }));
  const slots = s.selection?.filaments.length ?? 1;
  const edited = presetEdited({
    own: ownCfg,
    overrides: s.overrides,
    options: s.options,
    slot: type === 'filament' ? { index: slot ?? 0, count: slots, config: s.baseConfig } : undefined,
  });
  return { inherits, edited, own: ownCfg, parent: parentCfg };
}

/** A preset's settings in the running engine: its base there, and its settings after (and before) the user's changes. */
export interface EngineEdits {
  inherits: string;
  edited: OrcaConfig;
  /** The settings before the changes; only read when building on a stored preset. */
  own?: OrcaConfig;
  parent: OrcaConfig;
}

/**
 * Saves the running engine's settings as preset `name`. `from` names the
 * user preset they came from, whose other-engine part they keep.
 */
export async function saveFromEngine(type: PresetType, name: string, edits: EngineEdits, opts: { overwrite?: boolean; from?: string } = {}) {
  const prev = opts.from ? listUserPresets(type).find((p) => p.name === opts.from) : undefined;
  const { inherits, config, engines } = presetFromEngine(prev, useSlicer.getState().flavor, { type, ...edits, own: edits.own ?? {}, meta: META });
  return saveUserPreset(type, name, inherits, config, { overwrite: opts.overwrite, engines });
}

/**
 * Runs a preset edit, then reloads the engine's presets with the account's
 * list and applies `task`'s selection. Whatever did save reaches the engine
 * even when the task fails.
 */
export async function editPresets(task: () => Promise<Partial<Selection> | undefined>): Promise<void> {
  try {
    await presetEdit(async () => {
      const next = await task();
      await useSlicer.getState().setUserPresets(listUserPresets(), next);
    });
  } catch (e) {
    void useSlicer
      .getState()
      .setUserPresets(listUserPresets())
      .catch(() => {});
    throw e;
  }
}

/** Saves the changes into the selected preset, which must be the user's own. */
export const saveChanges = (type: PresetType, slot?: number) =>
  editPresets(async () => {
    const name = selectedName(useSlicer.getState().selection, type, slot);
    const preset = presetList(type).find((p) => p.name === name);
    if (!preset?.user) throw new Error(i18n.t('presetSave.onlyOwn'));
    await saveFromEngine(type, preset.name, await editsFor(type, preset, slot), { overwrite: true, from: preset.name });
    return undefined;
  });

/** Saves the selected preset with the changes as a new preset `name` and selects it. */
export const saveAsNew = (type: PresetType, name: string, slot?: number) =>
  editPresets(async () => {
    const current = selectedName(useSlicer.getState().selection, type, slot);
    const preset = presetList(type).find((p) => p.name === current);
    if (!preset) throw new Error(i18n.t('presetSave.noneSelected'));
    // A copy of one of the user's presets keeps its other engine's part too.
    await saveFromEngine(type, name, await editsFor(type, preset, slot), { from: preset.user ? preset.name : undefined });
    return selectionWith(type, name, slot);
  });

/** A selected preset with changes not saved into it (desktop's "Some presets are modified"). */
export interface ChangedPreset {
  type: PresetType;
  /** The filament slot, for a filament. */
  slot?: number;
  name: string;
  /** One of the user's own presets, which Save can write the changes into. */
  user: boolean;
  changes: number;
}

/** The selected presets the current changes belong to: filaments first, then process, then printer. */
export async function changedPresets(): Promise<ChangedPreset[]> {
  const s = useSlicer.getState();
  const selection = s.selection;
  if (!selection || !Object.keys(s.overrides).length) return [];
  const slots = selection.filaments.length;
  const picks: { type: PresetType; slot?: number }[] = [...selection.filaments.map((_, slot) => ({ type: 'filament' as const, slot })), { type: 'process' }, { type: 'printer' }];
  const out: ChangedPreset[] = [];
  for (const { type, slot } of picks) {
    const name = selectedName(selection, type, slot);
    const preset = presetList(type).find((p) => p.name === name);
    const own = preset ? await s.presetConfig(type, name) : null;
    if (!preset || !own) continue;
    const edited = presetEdited({
      own,
      overrides: s.overrides,
      options: s.options,
      slot: type === 'filament' ? { index: slot ?? 0, count: slots, config: s.baseConfig } : undefined,
    });
    const changes = Object.keys(edited).filter((k) => k in s.overrides && edited[k] !== own[k]).length;
    if (changes) out.push({ type, slot, name, user: !!preset.user, changes });
  }
  return out;
}

/**
 * Saves each changed preset's changes under the name given for it: into the
 * preset itself when that is the user's own and keeps its name, else as a new
 * preset. Printer last, as a new printer can change which filaments and
 * processes fit.
 */
export async function saveChangedPresets(rows: { preset: ChangedPreset; name: string }[]): Promise<void> {
  const names = rows.map((r) => `${r.preset.type}:${r.name.trim()}`);
  for (const { preset, name: raw } of rows) {
    const name = raw.trim();
    const problem =
      presetNameError(name) ??
      (names.filter((n) => n === `${preset.type}:${name}`).length > 1 ? i18n.t('presetSave.sameName') : null) ??
      (!(preset.user && name === preset.name) && presetTaken(preset.type, name) ? i18n.t('presetSave.nameTaken', { name }) : null);
    if (problem) throw new Error(problem);
  }
  for (const { preset, name } of rows) {
    if (preset.user && name.trim() === preset.name) await saveChanges(preset.type, preset.slot);
    else await saveAsNew(preset.type, name.trim(), preset.slot);
  }
}

/** Makes the settings a preset keeps apart per engine the same in both, with the running engine's values. */
export const sameValuesInBothEngines = (type: PresetType, name: string) =>
  editPresets(async () => {
    const stored = listUserPresets(type).find((p) => p.name === name);
    if (!stored) throw new Error(i18n.t('presetSave.notYours'));
    const p = useSameValues(stored, useSlicer.getState().flavor);
    await saveUserPreset(type, name, p.inherits, p.config, { overwrite: true, engines: p.engines });
    return undefined;
  });

/**
 * Moves presets saved with an older list of shared settings (an engine update
 * changed it) to the current list and saves them, so it happens once. Returns
 * what changed, for a note.
 */
export async function upgradeStoredPresets(): Promise<string[]> {
  const notes: string[] = [];
  for (const stored of listUserPresets()) {
    const { preset, notes: n } = upgradePreset(stored);
    if (preset === stored) continue;
    await saveUserPreset(stored.type, stored.name, preset.inherits, preset.config, { overwrite: true, engines: preset.engines });
    notes.push(...n);
  }
  return notes;
}
