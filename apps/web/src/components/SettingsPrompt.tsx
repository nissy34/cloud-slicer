// Desktop's settings checks in the page: settings that don't apply grey out
// or hide (useOptionStates), and an edit that makes a combination desktop
// rejects either fixes itself or asks, like desktop's "change these settings
// automatically?" messages (setOverrideChecked, setObjectSettingChecked).
import { useMemo } from 'react';
import { create } from 'zustand';
import type { OrcaConfig } from '../engine/protocol';
import { optionStates, reviewChange, type OptionStates, type SettingsPrompt, type ToggleContext } from '../lib/option-toggles';
import { useSlicer } from '../state/store';

type Scope = ToggleContext['scope'];
type Apply = (changes: OrcaConfig) => void;

interface PromptState {
  queue: { prompt: SettingsPrompt; apply: Apply }[];
  push(items: { prompt: SettingsPrompt; apply: Apply }[]): void;
  answer(changes: OrcaConfig): void;
}
export const useSettingsPrompts = create<PromptState>((set, get) => ({
  queue: [],
  push: (items) => set({ queue: [...get().queue, ...items] }),
  answer(changes) {
    const [first, ...rest] = get().queue;
    set({ queue: rest });
    if (first && Object.keys(changes).length) first.apply(changes);
  },
}));

function context(scope: Scope, slot?: number): ToggleContext {
  const s = useSlicer.getState();
  return { flowVariant: s.flowVariant, slot, slots: s.selection?.filaments.length ?? 1, scope, options: s.options };
}

function review(before: OrcaConfig, after: OrcaConfig, key: string, ctx: ToggleContext, apply: Apply) {
  const { changes, prompts } = reviewChange(before, after, [key], ctx);
  if (Object.keys(changes).length) apply(changes);
  if (prompts.length) useSettingsPrompts.getState().push(prompts.map((prompt) => ({ prompt, apply })));
}

/** Changes a global setting (process, printer or filament), then runs desktop's checks on it. */
export function setOverrideChecked(key: string, value: string | null, slot?: number) {
  const s = useSlicer.getState();
  const before = { ...s.baseConfig, ...s.overrides };
  s.setOverride(key, value);
  const after = { ...s.baseConfig, ...useSlicer.getState().overrides };
  const apply: Apply = (changes) => {
    const { setOverride } = useSlicer.getState();
    for (const [k, v] of Object.entries(changes)) setOverride(k, v);
  };
  review(before, after, key, context('global', slot), apply);
}

/** Changes one setting of an object (or a part or modifier), then runs desktop's checks on it. */
export async function setObjectSettingChecked(object: number, volume: number, key: string, value: string | null) {
  const s = useSlicer.getState();
  const own = () => {
    const o = useSlicer.getState().project?.objects[object];
    return (volume < 0 ? o?.settings : o?.volumes[volume]?.settings) ?? {};
  };
  const global = { ...s.baseConfig, ...s.overrides };
  const before = { ...global, ...own() };
  await s.setObjectSettings(object, volume, { [key]: value });
  const after = { ...global, ...own() };
  // Fixes go into the object's own settings, like desktop's object list.
  const apply: Apply = (changes) => void useSlicer.getState().setObjectSettings(object, volume, changes);
  review(before, after, key, context('object'), apply);
}

/**
 * Which settings are greyed out or hidden, for the global settings or, with
 * `own`, for an object whose own settings sit on top of them.
 */
export function useOptionStates(scope: Scope, slot?: number, own?: OrcaConfig): OptionStates {
  const baseConfig = useSlicer((s) => s.baseConfig);
  const overrides = useSlicer((s) => s.overrides);
  const options = useSlicer((s) => s.options);
  const flowVariant = useSlicer((s) => s.flowVariant);
  const slots = useSlicer((s) => s.selection?.filaments.length ?? 1);
  return useMemo(
    () => optionStates({ ...baseConfig, ...overrides, ...own }, { flowVariant, slot, slots, scope, options }),
    [baseConfig, overrides, own, options, flowVariant, slot, slots, scope],
  );
}

/** The message for the first check waiting on an answer. */
export function SettingsPromptDialog() {
  const current = useSettingsPrompts((s) => s.queue[0]);
  const answer = useSettingsPrompts((s) => s.answer);
  if (!current) return null;
  const { prompt } = current;
  return (
    <div className="dialog-backdrop">
      <div className="dialog settings-prompt" role="alertdialog" aria-modal="true" aria-labelledby="settings-prompt-text">
        <p id="settings-prompt-text">{prompt.message}</p>
        <div className="dialog-actions wrap">
          {prompt.answers.map((a, i) => (
            <button key={a.label} className={i === prompt.answers.length - 1 ? 'primary' : 'secondary'} autoFocus={i === prompt.answers.length - 1} onClick={() => answer(a.changes)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
