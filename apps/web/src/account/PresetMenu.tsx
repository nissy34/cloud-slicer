// Save, rename and delete the user's own presets, next to each preset picker
// (like desktop Orca's save / delete preset buttons). A preset is saved as a
// diff over the system preset it inherits; signed in, it follows the account.
import { useEffect, useRef, useState } from 'react';
import type { OrcaConfig, PresetSummary, Selection } from '../engine/protocol';
import { deleteUserPreset, listUserPresets, presetEdit, saveUserPreset, useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import { presetNameError, type PresetType } from './api';
import { changesFor, copyName, presetDiff, systemParent } from './preset-diff';
import { usePresetImport } from './ImportPresets';
import { canShareFiles, presetBundle, presetFileName, saveFile } from '../lib/preset-files';

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

  const current = !selection
    ? ''
    : type === 'printer'
      ? selection.printer
      : type === 'process'
        ? selection.process
        : selection.filaments[slot ?? 0];
  const preset = list.find((p) => p.name === current);
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

  const taken = (name: string) => list.some((p) => p.name === name) || listUserPresets(type).some((p) => p.name === name);

  // The selection with this picker pointing at `name`.
  const pick = (name: string): Partial<Selection> => {
    if (type === 'printer') return { printer: name };
    if (type === 'process') return { process: name };
    return {
      filaments: (selection?.filaments ?? []).map((f, i) => (i === (slot ?? 0) ? name : f)),
    };
  };

  async function run(task: () => Promise<Partial<Selection> | undefined>) {
    setWorking(true);
    setError('');
    try {
      await presetEdit(async () => {
        const next = await task();
        // Reloads the engine's presets with the account's list, then selects.
        await useSlicer.getState().setUserPresets(listUserPresets(), next);
      });
      close();
    } catch (e) {
      setError((e as Error).message);
      // Whatever did save still reaches the engine.
      void useSlicer
        .getState()
        .setUserPresets(listUserPresets())
        .catch(() => {});
    } finally {
      setWorking(false);
    }
  }

  async function diffFor(target: PresetSummary): Promise<{ inherits: string; config: OrcaConfig }> {
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

  const save = () =>
    run(async () => {
      if (!preset) return;
      const { inherits, config } = await diffFor(preset);
      await saveUserPreset(type, preset.name, inherits, config, {
        overwrite: true,
      });
      return undefined;
    });

  const submitName = (action: 'saveAs' | 'rename', raw: string) => {
    const name = raw.trim();
    const problem = presetNameError(name) ?? (taken(name) ? 'A preset with this name already exists.' : null);
    if (problem) return setError(problem);
    return run(async () => {
      if (!preset) return;
      if (action === 'saveAs') {
        const { inherits, config } = await diffFor(preset);
        await saveUserPreset(type, name, inherits, config);
      } else {
        const stored = listUserPresets(type).find((p) => p.name === preset.name);
        if (!stored) throw new Error('This preset is not one of yours.');
        await saveUserPreset(type, name, stored.inherits, stored.config);
        await deleteUserPreset(type, preset.name);
      }
      return pick(name);
    });
  };

  const remove = () =>
    run(async () => {
      if (!preset) return;
      await deleteUserPreset(type, preset.name);
      return pick(preset.inherits || '');
    });

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
      <button
        className="icon"
        aria-label={`${label[0].toUpperCase() + label.slice(1)} preset actions${slot != null ? ` (filament ${slot + 1})` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={!!mode}
        disabled={busy || !preset}
        onClick={() => (mode ? close() : setMode({ kind: 'menu' }))}
      >
        ⋯
      </button>
      {mode && preset && (
        <div className="preset-pop" role="dialog" aria-label={`${label} preset`}>
          {mode.kind === 'menu' && (
            <>
              <p className="preset-pop-title">{preset.name}</p>
              <p className="account-muted">
                {preset.user ? `Your preset, based on ${preset.inherits || 'a system preset'}.` : 'System preset.'}
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
                <button className="account-danger" disabled={working} onClick={() => void remove()}>
                  {working ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
