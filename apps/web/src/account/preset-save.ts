// Saving the settings on screen into a user preset, shared by the ⋯ menu
// beside each picker and the printer / filament settings windows. A preset is
// saved as a diff over the system preset it inherits.
import type { OrcaConfig, PresetSummary, Selection } from '../engine/protocol';
import { listUserPresets, presetEdit, saveUserPreset } from '../state/account';
import { useSlicer } from '../state/store';
import type { PresetType } from './api';
import { presetDiff, systemParent } from './preset-diff';

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

/** `target` with the current changes, as the diff a user preset stores. */
async function diffFor(type: PresetType, target: PresetSummary, slot?: number): Promise<{ inherits: string; config: OrcaConfig }> {
  const s = useSlicer.getState();
  const inherits = systemParent(target);
  const [ownCfg, parentCfg] = await Promise.all([s.presetConfig(type, target.name), s.presetConfig(type, inherits)]);
  if (!ownCfg || !parentCfg) throw new Error(`The preset ${inherits} is not available.`);
  const slots = s.selection?.filaments.length ?? 1;
  return {
    inherits,
    config: presetDiff({
      own: ownCfg,
      parent: parentCfg,
      overrides: s.overrides,
      options: s.options,
      slot: type === 'filament' ? { index: slot ?? 0, count: slots, config: s.baseConfig } : undefined,
    }),
  };
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
    if (!preset?.user) throw new Error('Only your own presets can be saved; use Save as.');
    const { inherits, config } = await diffFor(type, preset, slot);
    await saveUserPreset(type, preset.name, inherits, config, { overwrite: true });
    return undefined;
  });

/** Saves the selected preset with the changes as a new preset `name` and selects it. */
export const saveAsNew = (type: PresetType, name: string, slot?: number) =>
  editPresets(async () => {
    const current = selectedName(useSlicer.getState().selection, type, slot);
    const preset = presetList(type).find((p) => p.name === current);
    if (!preset) throw new Error('No preset is selected.');
    const { inherits, config } = await diffFor(type, preset, slot);
    await saveUserPreset(type, name, inherits, config);
    return selectionWith(type, name, slot);
  });
