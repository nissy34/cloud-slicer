// Save, rename and delete the user's own presets, next to each preset picker
// (like desktop Orca's save / delete preset buttons). A preset is saved as a
// diff over the system preset it inherits; signed in, it follows the account.
import { useEffect, useRef, useState } from 'react';
import type { OrcaConfig } from '../engine/protocol';
import { deleteUserPreset, listUserPresets, saveUserPreset, useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import { presetNameError, type PresetType } from './api';
import { changesFor, copyName, systemParent } from './preset-diff';
import { editPresets, presetTaken, sameValuesInBothEngines, saveAsNew, saveChanges, selectionWith } from './preset-save';
import { engineName } from '../lib/engines';
import { useFlipUp } from '../lib/flip-up';
import { shortName } from '../lib/presets';
import { usePresetImport } from './ImportPresets';
import { canShareFiles, presetBundle, presetFileName, saveFile } from '../lib/preset-files';
import { Ellipsis } from 'lucide-react';
import { IconButton } from '../components/IconButton';
import { Note } from '../components/Note';

/** Every user preset as one zip that desktop Orca's Import Configs reads too. */
export async function exportAllPresets(share = false): Promise<number> {
  const s = useSlicer.getState();
  const mine = listUserPresets();
  const files = await Promise.all(mine.map(async (p) => ({ type: p.type, name: p.name, json: await s.presetExport(p.type, p.name) })));
  const day = new Date().toISOString().slice(0, 10);
  await saveFile(new Blob([presetBundle(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `orca-presets-${day}.zip`, share);
  return files.length;
}

const LABEL: Record<PresetType, string> = {
  printer: 'printer',
  filament: 'filament',
  process: 'process',
};

type Mode = { kind: 'menu' } | { kind: 'name'; action: 'saveAs' | 'rename'; value: string } | { kind: 'delete' };

/** The ⋯ menu beside a printer, process or filament (slot) picker. */
export function PresetMenu({ type, slot }: { type: PresetType; slot?: number }) {
  const selection = useSlicer((s) => s.selection);
  const list = useSlicer((s) => (type === 'printer' ? s.printers : type === 'process' ? s.processes : s.filaments));
  const overrides = useSlicer((s) => s.overrides);
  const busy = useSlicer((s) => s.engine !== 'ready');
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const [mode, setMode] = useState<Mode | null>(null);
  const [own, setOwn] = useState<{ name: string; config: OrcaConfig } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const share = canShareFiles();
  const mineCount = useAccount((s) => s.presets.length);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const current = !selection
    ? ''
    : type === 'printer'
      ? selection.printer
      : type === 'process'
        ? selection.process
        : selection.filaments[slot ?? 0];
  const preset = list.find((p) => p.name === current);
  // Near the bottom of the sidebar (Process often is) the menu opens upward.
  const up = useFlipUp(root, pop, !!mode && !!preset);
  const flavor = useSlicer((s) => s.flavor);
  const apart = useAccount((s) => s.presets.find((p) => p.type === type && p.name === current)?.engines?.apart?.length ?? 0);
  const other = engineName(flavor === 'orca' ? 'snapmaker' : 'orca');
  const changes = own?.name === current ? changesFor(own.config, overrides) : 0;

  useEffect(() => {
    if (!mode || !current) return;
    let live = true;
    void useSlicer
      .getState()
      .presetConfig(type, current)
      .then((config) => live && setOwn({ name: current, config: config ?? {} }));
    return () => {
      live = false;
    };
  }, [mode, type, current]);

  useEffect(() => {
    if (!mode) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [mode]);

  function close() {
    setMode(null);
    setError('');
  }

  const taken = (name: string) => presetTaken(type, name);

  async function run(task: () => Promise<unknown>) {
    setWorking(true);
    setError('');
    try {
      await task();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  const save = () => run(() => saveChanges(type, slot));

  const submitName = (action: 'saveAs' | 'rename', raw: string) => {
    const name = raw.trim();
    const problem = presetNameError(name) ?? (taken(name) ? 'A preset with this name already exists.' : null);
    if (problem) return setError(problem);
    if (action === 'saveAs') return run(() => saveAsNew(type, name, slot));
    return run(() =>
      editPresets(async () => {
        if (!preset) return;
        const stored = listUserPresets(type).find((p) => p.name === preset.name);
        if (!stored) throw new Error('This preset is not one of yours.');
        await saveUserPreset(type, name, stored.inherits, stored.config, { engines: stored.engines });
        await deleteUserPreset(type, preset.name);
        return selectionWith(type, name, slot);
      }),
    );
  };

  const remove = () =>
    run(() =>
      editPresets(async () => {
        if (!preset) return;
        await deleteUserPreset(type, preset.name);
        return selectionWith(type, preset.inherits || '', slot);
      }),
    );

  async function exportOne(viaShare: boolean) {
    if (!preset) return;
    setError('');
    try {
      const text = await useSlicer.getState().presetExport(type, preset.name);
      await saveFile(new Blob([text], { type: 'application/json' }), presetFileName(preset.name), viaShare);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function exportAll(viaShare: boolean) {
    setError('');
    try {
      await exportAllPresets(viaShare);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const label = LABEL[type];
  const where = signedIn ? 'Saved to your account.' : 'Saved in this browser until you sign in.';
  return (
    <div className="preset-menu" ref={root}>
      <IconButton
        icon={Ellipsis}
        label="More"
        aria-label={`${label[0].toUpperCase() + label.slice(1)} preset actions${slot != null ? ` (filament ${slot + 1})` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={!!mode}
        disabled={busy || !preset}
        onClick={() => (mode ? close() : setMode({ kind: 'menu' }))}
      />
      {mode && preset && (
        <div ref={pop} className={up ? 'preset-pop up' : 'preset-pop'} role="dialog" aria-label={`${label} preset`}>
          {mode.kind === 'menu' && (
            <>
              <p className="preset-pop-title" title={preset.name}>
                {shortName(preset.name)}
              </p>
              <p className="account-muted">
                {preset.user ? `Your preset, based on ${preset.inherits ? shortName(preset.inherits) : 'a system preset'}.` : 'System preset.'}
                {changes > 0 && ` ${changes} unsaved change${changes === 1 ? '' : 's'}.`}
              </p>
              <div className="preset-pop-actions">
                {preset.user && (
                  <button disabled={working || changes === 0} onClick={() => void save()}>
                    Save changes
                  </button>
                )}
                <button
                  className={preset.user ? 'ghost' : ''}
                  disabled={working}
                  onClick={() =>
                    setMode({
                      kind: 'name',
                      action: 'saveAs',
                      value: copyName(preset.name, taken),
                    })
                  }
                >
                  Save as new preset…
                </button>
                {preset.user && (
                  <>
                    <button
                      className="ghost"
                      disabled={working}
                      onClick={() =>
                        setMode({
                          kind: 'name',
                          action: 'rename',
                          value: preset.name,
                        })
                      }
                    >
                      Rename…
                    </button>
                    <button className="ghost danger" disabled={working} onClick={() => setMode({ kind: 'delete' })}>
                      Delete…
                    </button>
                  </>
                )}
              </div>
              <div className="preset-pop-actions">
                {preset.user && (
                  <div className="preset-pop-split">
                    <button className="ghost" disabled={working} onClick={() => void exportOne(false)} title={changes > 0 ? 'Exports the preset as last saved' : undefined}>
                      Export preset
                    </button>
                    {share && (
                      <button className="ghost" disabled={working} aria-label="Share preset" onClick={() => void exportOne(true)}>
                        Share…
                      </button>
                    )}
                  </div>
                )}
                {mineCount > 0 && (
                  <div className="preset-pop-split">
                    <button className="ghost" disabled={working} onClick={() => void exportAll(false)}>
                      Export all my presets
                    </button>
                    {share && (
                      <button className="ghost" disabled={working} aria-label="Share all my presets" onClick={() => void exportAll(true)}>
                        Share…
                      </button>
                    )}
                  </div>
                )}
                <button
                  className="ghost"
                  disabled={working}
                  onClick={() => {
                    close();
                    usePresetImport.getState().show();
                  }}
                >
                  Import presets…
                </button>
              </div>
              {preset.user && apart > 0 && (
                <>
                  <p className="account-muted small">
                    {apart} setting{apart === 1 ? ' differs' : 's differ'} between this engine and {other} in this preset.
                  </p>
                  <button className="ghost" disabled={working} onClick={() => void run(() => sameValuesInBothEngines(type, preset.name))}>
                    Use the same values in both engines
                  </button>
                </>
              )}
              {preset.user && (
                <p className="account-muted small">
                  Your presets are in {other} too: settings both engines have stay the same in both, and G-code and settings only one engine has are kept for each.
                </p>
              )}
              {preset.user && changes > 0 && <p className="account-muted small">Export takes the preset as last saved, without your unsaved changes.</p>}
              <p className="account-muted small">{where}</p>
            </>
          )}
          {mode.kind === 'name' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitName(mode.action, mode.value);
              }}
            >
              <label className="preset-pop-field">
                <span>{mode.action === 'saveAs' ? `New ${label} preset name` : 'New name'}</span>
                <input autoFocus value={mode.value} maxLength={128} onChange={(e) => setMode({ ...mode, value: e.target.value })} />
              </label>
              {mode.action === 'saveAs' && (
                <p className="account-muted small">
                  Based on {systemParent(preset)}
                  {changes > 0 ? `, with your ${changes} change${changes === 1 ? '' : 's'}.` : '.'}
                </p>
              )}
              <div className="preset-pop-actions row">
                <button type="button" className="ghost" onClick={() => setMode({ kind: 'menu' })}>
                  Back
                </button>
                <button type="submit" disabled={working}>
                  {working ? 'Saving…' : mode.action === 'saveAs' ? 'Save' : 'Rename'}
                </button>
              </div>
            </form>
          )}
          {mode.kind === 'delete' && (
            <div>
              <p>
                Delete <strong>{preset.name}</strong>? {signedIn ? 'It is removed from your account on every device.' : ''}
              </p>
              <div className="preset-pop-actions row">
                <button className="ghost" onClick={() => setMode({ kind: 'menu' })}>
                  Back
                </button>
                <button className="primary danger" disabled={working} onClick={() => void remove()}>
                  {working ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}
          {error && (
            <Note tone="error">
              {error}
            </Note>
          )}
        </div>
      )}
    </div>
  );
}
