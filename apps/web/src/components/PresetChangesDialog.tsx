// Desktop Orca's question when New project meets changed settings ("Some
// presets are modified"): keep them in the new project, discard them, or
// save them into presets first. "Remember my choice" answers Keep or Discard
// without asking next time (the settings panel offers to ask again).
import { useState } from 'react';
import { create } from 'zustand';
import { Dialog } from './Dialog';
import { Note } from './Note';
import { copyName } from '../account/preset-diff';
import { shortName } from '../lib/presets';
import { changedPresets, presetTaken, saveChangedPresets, type ChangedPreset } from '../account/preset-save';
import { loadPresetChangesChoice, savePresetChangesChoice } from '../lib/storage';
import { setPresetChangesQuestion } from '../state/projects';

export type PresetChangesAnswer = 'keep' | 'discard' | 'saved' | 'cancel';

interface Question {
  presets: ChangedPreset[];
  answer(choice: PresetChangesAnswer): void;
}

const useQuestion = create<{ question: Question | null }>(() => ({ question: null }));
const useRemembered = create<{ choice: 'keep' | 'discard' | null }>(() => ({ choice: loadPresetChangesChoice() }));

/** The Keep or Discard ticked "Remember my choice" for, or null when New project asks. */
export const useRememberedChoice = () => useRemembered((s) => s.choice);

/** Asks again from the next New project on. */
export function forgetChoice() {
  savePresetChangesChoice(null);
  useRemembered.setState({ choice: null });
}

/**
 * What New project does with the changed settings: 'keep' them, 'discard'
 * them, or they were 'saved' into presets. Straight away 'keep' when no
 * selected preset has changes, and the remembered choice when there is one.
 */
export async function askPresetChanges(): Promise<PresetChangesAnswer> {
  const presets = await changedPresets();
  if (!presets.length) return 'keep';
  const remembered = useRemembered.getState().choice;
  if (remembered) return remembered;
  useQuestion.getState().question?.answer('cancel');
  return new Promise((resolve) =>
    useQuestion.setState({
      question: {
        presets,
        answer: (choice) => {
          useQuestion.setState({ question: null });
          resolve(choice);
        },
      },
    }),
  );
}

const label = (p: ChangedPreset) => (p.type === 'filament' ? `Filament ${(p.slot ?? 0) + 1}` : p.type === 'process' ? 'Process' : 'Printer');
const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/** A name for each preset's changes: the user's own preset keeps its name (Save writes into it), a system preset gets a free copy name. */
function startNames(presets: ChangedPreset[]): string[] {
  const names: string[] = [];
  for (const p of presets) {
    const taken = (n: string) => presetTaken(p.type, n) || names.includes(n);
    names.push(p.user && !names.includes(p.name) ? p.name : copyName(p.name, taken));
  }
  return names;
}

export function PresetChangesDialog() {
  const q = useQuestion((s) => s.question);
  if (!q) return null;
  return <Question key={q.presets.map((p) => `${p.type}${p.slot}:${p.name}`).join('|')} q={q} />;
}

function Question({ q }: { q: Question }) {
  const [remember, setRemember] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const answer = (choice: 'keep' | 'discard') => {
    if (remember) {
      savePresetChangesChoice(choice);
      useRemembered.setState({ choice });
    }
    q.answer(choice);
  };

  async function save() {
    if (!names) return;
    setWorking(true);
    setError('');
    try {
      await saveChangedPresets(q.presets.map((preset, i) => ({ preset, name: names[i] })));
      q.answer('saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  if (names)
    return (
      <Dialog
        title="Save changed settings"
        testId="preset-changes-save"
        onClose={() => q.answer('cancel')}
        footer={
          <>
            <button className="secondary" disabled={working} onClick={() => (setNames(null), setError(''))}>
              Back
            </button>
            <button className="primary" type="submit" form="preset-changes-names" disabled={working}>
              {working ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form
          id="preset-changes-names"
          className="preset-changes-names"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p>Your own presets keep their name and take the changes. Give a new name to save a copy instead.</p>
          {q.presets.map((p, i) => (
            <label key={`${p.type}${p.slot}`} className="field">
              <span>
                {label(p)}: {shortName(p.name)} ({changes(p.changes)})
              </span>
              <input
                value={names[i]}
                maxLength={128}
                autoFocus={i === 0}
                onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
              />
            </label>
          ))}
          {error && <Note tone="error">{error}</Note>}
        </form>
      </Dialog>
    );

  return (
    <Dialog
      title="Keep your changed settings?"
      role="alertdialog"
      describedBy="preset-changes-text"
      testId="preset-changes"
      onClose={() => q.answer('cancel')}
      footer={
        <>
          <button className="secondary" onClick={() => q.answer('cancel')}>
            Cancel
          </button>
          <button className="secondary" onClick={() => answer('discard')}>
            Discard
          </button>
          <button className="secondary" onClick={() => setNames(startNames(q.presets))}>
            Save…
          </button>
          <button className="primary" autoFocus onClick={() => answer('keep')}>
            Keep
          </button>
        </>
      }
    >
      <p id="preset-changes-text">Some presets have changed settings. Keep them in the new project, discard them, or save them into presets.</p>
      <ul className="preset-changes-list">
        {q.presets.map((p) => (
          <li key={`${p.type}${p.slot}`}>
            <strong>{label(p)}:</strong> {shortName(p.name)} ({changes(p.changes)})
          </li>
        ))}
      </ul>
      <label className="switch-row">
        <input className="switch" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Remember my choice (Keep or Discard)</span>
      </label>
    </Dialog>
  );
}

setPresetChangesQuestion(askPresetChanges);
