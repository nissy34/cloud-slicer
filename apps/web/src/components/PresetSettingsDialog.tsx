// Printer and filament settings in their own window, like desktop Orca's
// preset editors: opened from the edit button beside the printer picker or a
// filament slot, with Save and Save as at the bottom. Closing keeps the
// changes on screen as unsaved, like desktop's "(modified)" presets.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { OrcaConfig } from '../engine/protocol';
import { presetNameError } from '../account/api';
import { changesFor, copyName, systemParent } from '../account/preset-diff';
import { presetTaken, saveAsNew, saveChanges, selectedName } from '../account/preset-save';
import { shortName } from '../lib/presets';
import { useAccount } from '../state/account';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { SettingsPages } from './SettingsPanel';
import { Pencil } from 'lucide-react';
import { IconButton } from './IconButton';
import { Swatch } from './Swatch';
import { Note } from './Note';

type Target = { type: 'printer' } | { type: 'filament'; slot: number };

interface PresetSettingsState {
  open: Target | null;
  show(target: Target): void;
  hide(): void;
}
export const usePresetSettings = create<PresetSettingsState>((set) => ({
  open: null,
  show: (open) => set({ open }),
  hide: () => set({ open: null }),
}));

/** The edit (pencil) button beside a printer picker or filament slot. */
export function EditPresetButton(target: Target) {
  const busy = useSlicer((s) => s.engine !== 'ready' || !s.layout);
  const label = target.type === 'printer' ? 'Edit printer settings' : `Edit filament ${target.slot + 1} settings`;
  return (
    <IconButton icon={Pencil} label={label} disabled={busy} onClick={() => usePresetSettings.getState().show(target)} />
  );
}

export function PresetSettingsDialog() {
  const open = usePresetSettings((s) => s.open);
  if (!open) return null;
  return <Editor key={open.type === 'filament' ? `filament:${open.slot}` : 'printer'} target={open} />;
}

function Editor({ target }: { target: Target }) {
  const hide = usePresetSettings((s) => s.hide);
  const { type } = target;
  const slot = target.type === 'filament' ? target.slot : undefined;
  const selection = useSlicer((s) => s.selection);
  const colour = slot !== undefined ? selection?.colours[slot] : undefined;
  const overrides = useSlicer((s) => s.overrides);
  const resetOverrides = useSlicer((s) => s.resetOverrides);
  const slots = selection?.filaments.length ?? 1;
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const name = selectedName(selection, type, slot);
  const preset = useSlicer((s) => (type === 'printer' ? s.printers : s.filaments).find((p) => p.name === name));
  const [advanced, setAdvanced] = useState(false);
  const [own, setOwn] = useState<{ name: string; config: OrcaConfig } | null>(null);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const hasProject = useSlicer((s) => Boolean(s.project?.objects.length));
  const projectBusy = useProjects((s) => Boolean(s.busy));

  useEffect(() => {
    let live = true;
    void useSlicer
      .getState()
      .presetConfig(type, name)
      .then((config) => live && setOwn({ name, config: config ?? {} }));
    return () => {
      live = false;
    };
  }, [type, name]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !working && hide();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [hide, working]);

  // This preset's keys that differ from it on screen.
  const ownKeys = own?.name === name ? Object.keys(overrides).filter((k) => k in own.config) : [];
  const changes = own?.name === name ? changesFor(own.config, overrides) : 0;

  async function saveToProject() {
    setError('');
    setSaved('');
    await useProjects.getState().save();
    const p = useProjects.getState();
    // A new online project asks for its name first, in the projects' own window.
    if (p.saveAsOpen) return hide();
    if (p.message && p.messageWarn) setError(p.message);
    else if (!p.dirty) setSaved(signedIn ? `Saved in the project ${p.current.name}.` : 'Saved in the downloaded project 3MF.');
  }

  async function act(task: () => Promise<void>, done: string) {
    setWorking(true);
    setError('');
    setSaved('');
    try {
      await task();
      setSaveAs(null);
      setSaved(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  function submitSaveAs(raw: string) {
    const next = raw.trim();
    const problem = presetNameError(next) ?? (presetTaken(type, next) ? 'A preset with this name already exists.' : null);
    if (problem) return setError(problem);
    void act(() => saveAsNew(type, next, slot), `Saved as ${next}.`);
  }

  const where = signedIn ? 'Saved to your account.' : 'Saved in this browser until you sign in.';
  const title = type === 'printer' ? 'Printer settings' : slots > 1 ? `Filament ${(slot ?? 0) + 1} settings` : 'Filament settings';

  // Save as new preset is the main button when nothing else saves (a system preset, no project open).
  const saveAsMain = !preset?.user && !hasProject;
  return (
    <Dialog
      title={
        <>
          {colour && <Swatch colour={colour} size="sm" />}
          {title}
        </>
      }
      className="preset-settings"
      onClose={hide}
      head={
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          <span>Advanced</span>
        </label>
      }
      footer={
        saveAs !== null ? (
          <form
            className="preset-settings-saveas"
            onSubmit={(e) => {
              e.preventDefault();
              submitSaveAs(saveAs);
            }}
          >
            <label className="preset-pop-field">
              <span>New {type} preset name</span>
              <input autoFocus value={saveAs} maxLength={128} onChange={(e) => setSaveAs(e.target.value)} />
            </label>
            <div className="win-foot-row">
              <button type="button" className="secondary" onClick={() => (setSaveAs(null), setError(''))}>
                Back
              </button>
              <button type="submit" className="primary" disabled={working}>
                {working ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <span className="preset-settings-count muted small" role="status">
              {saved || (changes > 0 ? `${changes} unsaved change${changes === 1 ? '' : 's'}` : 'No changes')}
            </span>
            <button className="secondary" disabled={working} onClick={hide}>
              Close
            </button>
            {changes > 0 && (type === 'printer' || slots < 2) && (
              <button className="secondary" disabled={working} onClick={() => resetOverrides(ownKeys)}>
                Discard changes
              </button>
            )}
            <button
              className={saveAsMain ? 'primary' : 'secondary'}
              disabled={working || !preset}
              onClick={() => (setError(''), setSaved(''), setSaveAs(copyName(name, (n) => presetTaken(type, n))))}
            >
              Save as new preset…
            </button>
            {preset?.user && (
              <button className="primary" disabled={working || changes === 0} onClick={() => void act(() => saveChanges(type, slot), `Saved ${name}.`)}>
                {working ? 'Saving…' : 'Save to preset'}
              </button>
            )}
            {hasProject && (
              <button
                className={preset?.user ? 'secondary' : 'primary'}
                disabled={working || projectBusy || changes === 0}
                title="Keeps these changes in this project only and saves the project"
                onClick={() => void saveToProject()}
              >
                Save to project
              </button>
            )}
          </>
        )
      }
    >
      <p className="preset-settings-name" title={name}>
        <b>{type === 'filament' ? shortName(name) : name}</b>
        {changes > 0 && <span className="muted"> (modified)</span>}
        <span className="muted small">
          {' '}
          {preset?.user ? `Your preset, based on ${systemParent(preset)}.` : 'System preset: use Save as to keep your changes.'}
        </span>
      </p>
      <div className="preset-settings-body">
        <SettingsPages kind={type} advanced={advanced} slot={slot} />
      </div>
      {error && (
        <Note tone="error">
          {error}
        </Note>
      )}
      <p className="muted small">
        Save to project keeps these changes in this project only, and they come back when you open it. A preset keeps them for every project. {where} Export, import,
        rename and delete are in the ⋯ menu.
      </p>
    </Dialog>
  );
}
