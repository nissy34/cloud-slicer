// Printer and filament settings in their own window, like desktop Orca's
// preset editors: opened from the edit button beside the printer picker or a
// filament slot, with Save and Save as at the bottom. Closing keeps the
// changes on screen as unsaved, like desktop's "(modified)" presets.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { SettingsLevelChips, SettingsPages } from './SettingsPanel';
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
  const { t } = useTranslation();
  const busy = useSlicer((s) => s.engine !== 'ready' || !s.layout);
  const label = target.type === 'printer' ? t('presetSettings.editPrinter') : t('presetSettings.editFilament', { n: target.slot + 1 });
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
  const { t } = useTranslation();
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
    else if (!p.dirty) setSaved(signedIn ? t('presetSettings.savedInProject', { name: p.current.name }) : t('presetSettings.savedIn3mf'));
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
    const problem = presetNameError(next) ?? (presetTaken(type, next) ? t('presetSettings.nameTaken') : null);
    if (problem) return setError(problem);
    void act(() => saveAsNew(type, next, slot), t('presetSettings.savedAs', { name: next }));
  }

  const where = signedIn ? t('presetSettings.whereAccount') : t('presetSettings.whereBrowser');
  const title = type === 'printer' ? t('presetSettings.printerTitle') : slots > 1 ? t('presetSettings.filamentNTitle', { n: (slot ?? 0) + 1 }) : t('presetSettings.filamentTitle');

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
              <span>{type === 'printer' ? t('presetSettings.newPrinterName') : t('presetSettings.newFilamentName')}</span>
              <input autoFocus value={saveAs} maxLength={128} onChange={(e) => setSaveAs(e.target.value)} />
            </label>
            <div className="win-foot-row">
              <button type="button" className="secondary" onClick={() => (setSaveAs(null), setError(''))}>
                {t('presetSettings.back')}
              </button>
              <button type="submit" className="primary" disabled={working}>
                {working ? t('presetSettings.saving') : t('presetSettings.save')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <span className="preset-settings-count muted small" role="status">
              {saved || (changes > 0 ? t('presetSettings.unsaved', { count: changes }) : t('presetSettings.noChanges'))}
            </span>
            <button className="secondary" disabled={working} onClick={hide}>
              {t('common.close')}
            </button>
            {changes > 0 && (type === 'printer' || slots < 2) && (
              <button className="secondary" disabled={working} onClick={() => resetOverrides(ownKeys)}>
                {t('presetSettings.discard')}
              </button>
            )}
            <button
              className={saveAsMain ? 'primary' : 'secondary'}
              disabled={working || !preset}
              onClick={() => (setError(''), setSaved(''), setSaveAs(copyName(name, (n) => presetTaken(type, n))))}
            >
              {t('presetSettings.saveAsNew')}
            </button>
            {preset?.user && (
              <button className="primary" disabled={working || changes === 0} onClick={() => void act(() => saveChanges(type, slot), t('presetSettings.savedName', { name }))}>
                {working ? t('presetSettings.saving') : t('presetSettings.saveToPreset')}
              </button>
            )}
            {hasProject && (
              <button
                className={preset?.user ? 'secondary' : 'primary'}
                disabled={working || projectBusy || changes === 0}
                title={t('presetSettings.saveToProjectTip')}
                onClick={() => void saveToProject()}
              >
                {t('presetSettings.saveToProject')}
              </button>
            )}
          </>
        )
      }
    >
      <p className="preset-settings-name" title={name}>
        <b>{type === 'filament' ? shortName(name) : name}</b>
        {changes > 0 && <span className="muted"> {t('presetSettings.modified')}</span>}
        <span className="muted small">
          {' '}
          {preset?.user ? t('presetSettings.yours', { parent: systemParent(preset) }) : t('presetSettings.system')}
        </span>
      </p>
      <SettingsLevelChips />
      <div className="preset-settings-body">
        <SettingsPages kind={type} slot={slot} />
      </div>
      {error && (
        <Note tone="error">
          {error}
        </Note>
      )}
      <p className="muted small">
        {t('presetSettings.footHint', { where })}
      </p>
    </Dialog>
  );
}
