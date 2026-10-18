// Import Configs, like desktop Orca's: pick preset files (desktop's .json,
// .orca_printer / .orca_filament bundles, a .zip, or this app's own exports),
// see what each one is and where it goes, then add them to My presets.
import { useRef, useState } from 'react';
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
import { listUserPresets, presetEdit, saveUserPreset, useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import type { PresetType } from './api';
import { systemParent } from './preset-diff';

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

const TYPE_LABEL: Record<PresetType, string> = { printer: 'Printer', filament: 'Filament', process: 'Process' };

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
            throw new Error(`You can keep up to ${MAX_USER_PRESETS} presets; ${added} were imported.`);
          await saveUserPreset(row.type, name, row.base, row.diff, { overwrite: true });
          taken.add(`${row.type}\n${name}`);
          added++;
        }
      });
      done = `Imported ${added} preset${added === 1 ? '' : 's'}. ${signedIn ? 'They are saved to your account.' : 'They are saved in this browser until you sign in.'}`;
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
    <div className="dialog-backdrop">
      <div className="dialog import-presets" role="dialog" aria-modal="true" aria-labelledby="import-presets-title">
        <h2 id="import-presets-title">Import presets</h2>
        <p className="muted small">
          Orca preset files (.json) and bundles (.orca_printer, .orca_filament, .zip) from desktop Orca, Snapmaker Orca or this app. Each preset must be based on a
          printer, filament or process preset this app has.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={PRESET_FILE_TYPES}
          aria-label="Preset files"
          className="sr-only"
          onChange={(e) => void pick(e.target.files)}
        />
        <div>
          <button className="secondary" disabled={working} onClick={() => input.current?.click()}>
            {rows ? 'Choose other files…' : 'Choose files…'}
          </button>
        </div>
        {working && !rows && <p className="muted">Reading…</p>}
        {problems.length > 0 && (
          <ul className="import-problems" aria-label="Files left out">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {rows && rows.length > 0 && (
          <ul className="import-list" aria-label="Presets to import">
            {rows.map((row) => (
              <li key={row.key} className={row.rejected || row.problem ? 'import-row rejected' : 'import-row'} aria-label={`${TYPE_LABEL[row.type]} ${row.name}`}>
                <div className="import-row-head">
                  <span className="import-type">{TYPE_LABEL[row.type]}</span>
                  <b>{row.name}</b>
                </div>
                {row.rejected || row.problem ? (
                  <p className="import-note warn">{row.rejected ?? `Can't import: ${row.problem}`}</p>
                ) : (
                  <>
                    {row.converted ? (
                      <label className="field">
                        <span className="small">
                          Made for {row.inherits ? <b>{row.inherits}</b> : 'another printer'}. Put it on:
                        </span>
                        <select aria-label={`Base for ${row.name}`} value={row.base} disabled={working} onChange={(e) => void rebase(row, e.target.value)}>
                          {!baseChoices(row.type).some((p) => p.name === row.base) && <option value={row.base}>{row.base}</option>}
                          {baseChoices(row.type).map((p) => (
                            <option key={p.name} value={p.name}>
                              {shortName(p.name)}
                            </option>
                          ))}
                        </select>
                        <span className="small muted">
                          {row.type === 'process'
                            ? 'Keeps its layer, wall, infill, support and other model settings; speeds, line widths and the like come from the new base.'
                            : 'Keeps its material settings; its filament start/end G-code comes from the new base.'}
                        </span>
                      </label>
                    ) : (
                      <p className="import-note small muted">
                        Based on {row.base}, {Object.keys(row.diff).length} setting{Object.keys(row.diff).length === 1 ? '' : 's'} changed.
                      </p>
                    )}
                    {row.taken === 'user' && (
                      <label className="field">
                        <span className="small">You already have a {row.type} preset with this name.</span>
                        <select
                          aria-label={`When ${row.name} exists`}
                          value={row.collision}
                          onChange={(e) => update(row.key, { collision: e.target.value as Collision })}
                        >
                          <option value="overwrite">Replace mine</option>
                          <option value="keep">Keep both</option>
                          <option value="skip">Skip</option>
                        </select>
                      </label>
                    )}
                    {row.name !== row.fileName && !row.taken && <p className="import-note small muted">Saved as “{row.name}” (the name “{row.fileName}” is taken or not allowed).</p>}
                    {row.gcode.length > 0 && (
                      <p className="import-note small warn">
                        Changes custom G-code ({row.gcode.join(', ')}). It runs on your printer as written, so only import it if you trust where it came from.
                      </p>
                    )}
                    {row.dropped.length > 0 && (
                      <p className="import-note small muted" title={row.dropped.join(', ')}>
                        {row.dropped.length} setting{row.dropped.length === 1 ? '' : 's'} this version of Orca doesn't have {row.dropped.length === 1 ? 'was' : 'were'} left out.
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {rows && rows.length === 0 && !problems.length && <p>No presets found.</p>}
        {rows && importable.length > room && <p className="warn small">You can keep up to {MAX_USER_PRESETS} presets; only {Math.max(0, room)} more fit.</p>}
        {done && (
          <p className="ok" role="status">
            {done}
          </p>
        )}
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="secondary" onClick={close}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {rows && (
            <button className="primary" disabled={working || importable.length === 0} onClick={() => void run()}>
              {working ? 'Importing…' : `Import ${importable.length} preset${importable.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
