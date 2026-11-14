// Import Configs, like desktop Orca's: pick preset files (desktop's .json,
// .orca_printer / .orca_filament bundles, a .zip, or this app's own exports),
// see what each one is and where it goes, then add them to My presets.
import { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { create } from 'zustand';
import type { OrcaConfig } from '../engine/protocol';
import {
  changedGcode,
  convertedKeys,
  finalName,
  importDiff,
  limitError,
  MAX_USER_PRESETS,
  planImport,
  PRESET_FILE_TYPES,
  readPresetFiles,
  type Collision,
  type ImportItem,
} from '../lib/preset-files';
import { shortName } from '../lib/presets';
import { listUserPresets, presetEdit, useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import type { PresetType } from './api';
import { systemParent } from './preset-diff';
import { saveFromEngine } from './preset-save';
import { Dialog } from '../components/Dialog';
import { Note } from '../components/Note';
import { Picker } from '../components/Picker';

/** An item with what it would store, worked out for its current base. */
type Row = ImportItem & { diff: OrcaConfig; gcode: string[]; problem: string | null };

interface ImportState {
  open: boolean;
  show(): void;
  hide(): void;
}
export const usePresetImport = create<ImportState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

const TYPE_LABEL: Record<PresetType, string> = { printer: 'importPresets.printer', filament: 'importPresets.filament', process: 'importPresets.process' };
const TAKEN: Record<PresetType, string> = { printer: 'importPresets.takenPrinter', filament: 'importPresets.takenFilament', process: 'importPresets.takenProcess' };

/** The diff a row stores on `base`: re-read on that base when it moved. */
async function prepare(item: ImportItem, text: string): Promise<Row> {
  const s = useSlicer.getState();
  let parsed = item.parsed!;
  if (item.converted) {
    const [again] = await s.presetParse([{ text, rebase: item.base }]);
    if (again?.ok) parsed = again;
  }
  const base = (await s.presetConfig(item.type, item.base)) ?? {};
  const keep = item.converted ? convertedKeys(item.type, parsed.config, s.layout) : undefined;
  const diff = importDiff(parsed.config, base, s.options, keep);
  return { ...item, diff, gcode: changedGcode(diff, s.options), problem: limitError(diff) };
}

export function ImportPresetsDialog() {
  const { t } = useTranslation();
  const open = usePresetImport((s) => s.open);
  const hide = usePresetImport((s) => s.hide);
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const filaments = useSlicer((s) => s.filaments);
  const processes = useSlicer((s) => s.processes);
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [texts, setTexts] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  if (!open) return null;

  const close = () => {
    setRows(null);
    setProblems([]);
    setError('');
    setDone('');
    hide();
  };

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setWorking(true);
    setError('');
    setDone('');
    try {
      const files = await Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      const { sources, problems } = readPresetFiles(files);
      setProblems(problems);
      const s = useSlicer.getState();
      const parsed = sources.length ? await s.presetParse(sources.map((src) => ({ text: src.text }))) : [];
      const names = (type: PresetType, user: boolean) => {
        const list = type === 'printer' ? s.printers : type === 'filament' ? s.filaments : s.processes;
        return new Set([...list.filter((p) => p.user === user).map((p) => p.name), ...(user ? listUserPresets(type).map((p) => p.name) : [])]);
      };
      const current = s.processes.find((p) => p.name === s.selection?.process);
      const plan = planImport({
        sources,
        parsed,
        systemNames: { printer: names('printer', false), filament: names('filament', false), process: names('process', false) },
        userNames: { printer: names('printer', true), filament: names('filament', true), process: names('process', true) },
        processes: s.processes.filter((p) => p.system),
        filaments: s.filaments.filter((p) => p.system),
        defaultProcess: current ? systemParent(current) : '',
      });
      const byKey = new Map(plan.map((item) => [item.key, sources[Number(item.key)]?.text ?? '']));
      setTexts(sources.map((src) => src.text));
      setRows(
        await Promise.all(
          plan.map((item) => (item.rejected ? { ...item, diff: {}, gcode: [], problem: null } : prepare(item, byKey.get(item.key) ?? ''))),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
      if (input.current) input.current.value = '';
    }
  }

  const update = (key: string, change: Partial<Row>) => setRows((r) => r && r.map((row) => (row.key === key ? { ...row, ...change } : row)));

  async function rebase(row: Row, base: string) {
    update(row.key, { base });
    const next = await prepare({ ...row, base }, texts[Number(row.key)] ?? '');
    update(row.key, next);
  }

  const importable = (rows ?? []).filter((r) => !r.rejected && !r.problem && !(r.taken === 'user' && r.collision === 'skip'));
  const room = MAX_USER_PRESETS - listUserPresets().length;

  async function run() {
    setWorking(true);
    setError('');
    let added = 0;
    let done = '';
    try {
      await presetEdit(async () => {
        const taken = new Set(listUserPresets().map((p) => `${p.type}\n${p.name}`));
        for (const row of importable) {
          const name = finalName(row, (n) => taken.has(`${row.type}\n${n}`));
          if (!name) continue;
          if (!taken.has(`${row.type}\n${name}`) && listUserPresets().length >= MAX_USER_PRESETS)
            throw new Error(t('importPresets.limitReached', { max: MAX_USER_PRESETS, n: added }));
          await saveFromEngine(row.type, name, { inherits: row.base, edited: row.diff, parent: {} }, { overwrite: true });
          taken.add(`${row.type}\n${name}`);
          added++;
        }
      });
      done = `${t('importPresets.imported', { count: added })} ${signedIn ? t('importPresets.savedAccount') : t('importPresets.savedBrowser')}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Whatever was saved reaches the engine and the pickers. Done only
      // after that: the reload re-applies the selection, so an edit made
      // while it ran (a filament added once the dialog closes) would be lost.
      await useSlicer
        .getState()
        .setUserPresets(listUserPresets())
        .catch(() => {});
      if (done) {
        setDone(done);
        setRows(null);
      }
      setWorking(false);
    }
  }

  const baseChoices = (type: PresetType) => (type === 'filament' ? filaments : processes).filter((p) => p.system);

  return (
    <Dialog
      title={t('importPresets.title')}
      onClose={close}
      className="import-presets"
      footer={
        <>
          <button className="secondary" onClick={close}>
            {done ? t('common.close') : t('common.cancel')}
          </button>
          {rows && (
            <button className="primary" disabled={working || importable.length === 0} onClick={() => void run()}>
              {working ? t('importPresets.importing') : t('importPresets.importN', { count: importable.length })}
            </button>
          )}
        </>
      }
    >
      <p className="muted small">
        {t('importPresets.intro')}
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept={PRESET_FILE_TYPES}
        aria-label={t('importPresets.files')}
        className="sr-only"
        onChange={(e) => void pick(e.target.files)}
      />
      <div>
        <button className="secondary" disabled={working} onClick={() => input.current?.click()}>
          {rows ? t('importPresets.chooseOther') : t('importPresets.choose')}
        </button>
      </div>
      {working && !rows && <p className="muted">{t('importPresets.reading')}</p>}
      {problems.length > 0 && (
        <ul className="import-problems" aria-label={t('importPresets.leftOut')}>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {rows && rows.length > 0 && (
        <ul className="import-list" aria-label={t('importPresets.toImport')}>
          {rows.map((row) => (
            <li key={row.key} className={row.rejected || row.problem ? 'import-row rejected' : 'import-row'} aria-label={t('importPresets.rowLabel', { type: t(TYPE_LABEL[row.type]), name: row.name })}>
              <div className="import-row-head">
                <span className="import-type">{t(TYPE_LABEL[row.type])}</span>
                <b>{row.name}</b>
              </div>
              {row.rejected || row.problem ? (
                <Note tone="error">{row.rejected ?? t('importPresets.cantImport', { problem: row.problem })}</Note>
              ) : (
                <>
                  {row.converted ? (
                    <label className="field">
                      <span className="small">
                        {row.inherits ? (
                          <Trans i18nKey={'importPresets.madeFor'} values={{ printer: row.inherits }} components={{ b: <b /> }} />
                        ) : (
                          t('importPresets.madeForOther')
                        )}
                      </span>
                      <Picker
                        field
                        label={t('importPresets.baseFor', { name: row.name })}
                        value={row.base}
                        disabled={working}
                        options={[
                          ...(baseChoices(row.type).some((p) => p.name === row.base) ? [] : [{ value: row.base, label: row.base }]),
                          ...baseChoices(row.type).map((p) => ({ value: p.name, label: shortName(p.name) })),
                        ]}
                        onChange={(v) => void rebase(row, v)}
                      />
                      <span className="small muted">
                        {row.type === 'process'
                          ? t('importPresets.keepsProcess')
                          : t('importPresets.keepsFilament')}
                      </span>
                    </label>
                  ) : (
                    <p className="import-note small muted">
                      {t('importPresets.basedOn', { base: row.base, count: Object.keys(row.diff).length })}
                    </p>
                  )}
                  {row.taken === 'user' && (
                    <label className="field">
                      <span className="small">{t(TAKEN[row.type])}</span>
                      <Picker
                        field
                        label={t('importPresets.whenExists', { name: row.name })}
                        value={row.collision}
                        options={[
                          { value: 'overwrite', label: t('importPresets.replace') },
                          { value: 'keep', label: t('importPresets.keepBoth') },
                          { value: 'skip', label: t('importPresets.skip') },
                        ]}
                        onChange={(v) => update(row.key, { collision: v as Collision })}
                      />
                    </label>
                  )}
                  {row.name !== row.fileName && !row.taken && <p className="import-note small muted">{t('importPresets.savedAs', { name: row.name, fileName: row.fileName })}</p>}
                  {row.gcode.length > 0 && (
                    <p className="import-note small warn">
                      {t('importPresets.gcodeWarn', { keys: row.gcode.join(', ') })}
                    </p>
                  )}
                  {row.dropped.length > 0 && (
                    <p className="import-note small muted" title={row.dropped.join(', ')}>
                      {t('importPresets.dropped', { count: row.dropped.length })}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length === 0 && !problems.length && <p>{t('importPresets.none')}</p>}
      {rows && importable.length > room && <p className="warn small">{t('importPresets.room', { max: MAX_USER_PRESETS, n: Math.max(0, room) })}</p>}
      {done && (
        <p className="ok" role="status">
          {done}
        </p>
      )}
      {error && (
        <Note tone="error">
          {error}
        </Note>
      )}
    </Dialog>
  );
}
