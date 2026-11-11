// Save, rename and delete the user's own presets, next to each preset picker
// (like desktop Orca's save / delete preset buttons). A preset is saved as a
// diff over the system preset it inherits; signed in, it follows the account.
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { OrcaConfig } from '../engine/protocol';
import { deleteUserPreset, listUserPresets, saveUserPreset, useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import { presetNameError, type PresetType } from './api';
import { changesFor, copyName, systemParent } from './preset-diff';
import { editPresets, presetTaken, sameValuesInBothEngines, saveAsNew, saveChanges, selectionWith } from './preset-save';
import { engineName } from '../lib/engines';
import { shortName } from '../lib/presets';
import { usePresetImport } from './ImportPresets';
import { canShareFiles, presetBundle, presetFileName, saveFile } from '../lib/preset-files';
import { Ellipsis } from 'lucide-react';
import { IconButton } from '../components/IconButton';
import { Note } from '../components/Note';
import { Menu } from '../components/Menu';

/** Every user preset as one zip that desktop Orca's Import Configs reads too. */
export async function exportAllPresets(share = false): Promise<number> {
  const s = useSlicer.getState();
  const mine = listUserPresets();
  const files = await Promise.all(mine.map(async (p) => ({ type: p.type, name: p.name, json: await s.presetExport(p.type, p.name) })));
  const day = new Date().toISOString().slice(0, 10);
  await saveFile(new Blob([presetBundle(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `orca-presets-${day}.zip`, share);
  return files.length;
}

// Words about each kind of preset, in a sentence and as a name ("Printer preset actions").
const PRESET_WORDS: Record<PresetType, { menu: string; actions: string; newName: string }> = {
  printer: { menu: 'presetMenu.printerPreset', actions: 'presetMenu.printerActions', newName: 'presetMenu.newPrinterName' },
  filament: { menu: 'presetMenu.filamentPreset', actions: 'presetMenu.filamentActions', newName: 'presetMenu.newFilamentName' },
  process: { menu: 'presetMenu.processPreset', actions: 'presetMenu.processActions', newName: 'presetMenu.newProcessName' },
};

type Mode = { kind: 'menu' } | { kind: 'name'; action: 'saveAs' | 'rename'; value: string } | { kind: 'delete' };

/** The ⋯ menu beside a printer, process or filament (slot) picker. */
export function PresetMenu({ type, slot }: { type: PresetType; slot?: number }) {
  const { t } = useTranslation();
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

  const current = !selection
    ? ''
    : type === 'printer'
      ? selection.printer
      : type === 'process'
        ? selection.process
        : selection.filaments[slot ?? 0];
  const preset = list.find((p) => p.name === current);
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
    const problem = presetNameError(name) ?? (taken(name) ? t('presetMenu.nameTaken') : null);
    if (problem) return setError(problem);
    if (action === 'saveAs') return run(() => saveAsNew(type, name, slot));
    return run(() =>
      editPresets(async () => {
        if (!preset) return;
        const stored = listUserPresets(type).find((p) => p.name === preset.name);
        if (!stored) throw new Error(t('presetSave.notYours'));
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

  const words = PRESET_WORDS[type];
  const where = signedIn ? t('presetMenu.savedAccount') : t('presetMenu.savedBrowser');
  return (
    <Menu
      label={t(words.menu)}
      role="dialog"
      placement="bottom-end"
      className="preset-pop"
      open={!!mode && !!preset}
      onOpenChange={(next) => (next ? setMode({ kind: 'menu' }) : close())}
      button={(props) => (
        <IconButton
          {...props}
          icon={Ellipsis}
          label={t('presetMenu.more')}
          aria-label={slot != null ? t('presetMenu.actionsSlot', { actions: t(words.actions), n: slot + 1 }) : t(words.actions)}
          disabled={busy || !preset}
        />
      )}
    >
      {mode && preset && (
        <>
          {mode.kind === 'menu' && (
            <>
              <p className="preset-pop-title" title={preset.name}>
                {shortName(preset.name)}
              </p>
              <p className="account-muted">
                {preset.user
                  ? t('presetMenu.yours', { base: preset.inherits ? shortName(preset.inherits) : t('presetMenu.aSystemPreset') })
                  : t('presetMenu.system')}
                {changes > 0 && ` ${t('presetMenu.unsaved', { count: changes })}`}
              </p>
              <div className="preset-pop-actions">
                {preset.user && (
                  <button disabled={working || changes === 0} onClick={() => void save()}>
                    {t('presetMenu.saveChanges')}
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
                  {t('presetMenu.saveAsNew')}
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
                      {t('presetMenu.renameMenu')}
                    </button>
                    <button className="ghost danger" disabled={working} onClick={() => setMode({ kind: 'delete' })}>
                      {t('presetMenu.deleteMenu')}
                    </button>
                  </>
                )}
              </div>
              <div className="preset-pop-actions">
                {preset.user && (
                  <div className="preset-pop-split">
                    <button className="ghost" disabled={working} onClick={() => void exportOne(false)} title={changes > 0 ? t('presetMenu.exportTip') : undefined}>
                      {t('presetMenu.export')}
                    </button>
                    {share && (
                      <button className="ghost" disabled={working} aria-label={t('presetMenu.sharePreset')} onClick={() => void exportOne(true)}>
                        {t('presetMenu.share')}
                      </button>
                    )}
                  </div>
                )}
                {mineCount > 0 && (
                  <div className="preset-pop-split">
                    <button className="ghost" disabled={working} onClick={() => void exportAll(false)}>
                      {t('presetMenu.exportAll')}
                    </button>
                    {share && (
                      <button className="ghost" disabled={working} aria-label={t('presetMenu.shareAll')} onClick={() => void exportAll(true)}>
                        {t('presetMenu.share')}
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
                  {t('presetMenu.import')}
                </button>
              </div>
              {preset.user && apart > 0 && (
                <>
                  <p className="account-muted small">
                    {t('presetMenu.apart', { count: apart, engine: other })}
                  </p>
                  <button className="ghost" disabled={working} onClick={() => void run(() => sameValuesInBothEngines(type, preset.name))}>
                    {t('presetMenu.sameValues')}
                  </button>
                </>
              )}
              {preset.user && (
                <p className="account-muted small">
                  {t('presetMenu.bothEngines', { engine: other })}
                </p>
              )}
              {preset.user && changes > 0 && <p className="account-muted small">{t('presetMenu.exportNote')}</p>}
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
                <span>{mode.action === 'saveAs' ? t(words.newName) : t('presetMenu.newName')}</span>
                <input autoFocus value={mode.value} maxLength={128} onChange={(e) => setMode({ ...mode, value: e.target.value })} />
              </label>
              {mode.action === 'saveAs' && (
                <p className="account-muted small">
                  {changes > 0 ? t('presetMenu.basedOnChanges', { base: systemParent(preset), count: changes }) : t('presetMenu.basedOn', { base: systemParent(preset) })}
                </p>
              )}
              <div className="preset-pop-actions row">
                <button type="button" className="ghost" onClick={() => setMode({ kind: 'menu' })}>
                  {t('presetMenu.back')}
                </button>
                <button type="submit" disabled={working}>
                  {working ? t('presetMenu.saving') : mode.action === 'saveAs' ? t('presetMenu.save') : t('presetMenu.rename')}
                </button>
              </div>
            </form>
          )}
          {mode.kind === 'delete' && (
            <div className="stack">
              <p>
                <Trans i18nKey={'presetMenu.deleteAsk'} values={{ name: preset.name }} components={{ b: <strong /> }} /> {signedIn ? t('presetMenu.deleteEverywhere') : ''}
              </p>
              <div className="preset-pop-actions row">
                <button className="ghost" onClick={() => setMode({ kind: 'menu' })}>
                  {t('presetMenu.back')}
                </button>
                <button className="primary danger" disabled={working} onClick={() => void remove()}>
                  {working ? t('presetMenu.deleting') : t('presetMenu.delete')}
                </button>
              </div>
            </div>
          )}
          {error && <Note tone="error">{error}</Note>}
        </>
      )}
    </Menu>
  );
}
