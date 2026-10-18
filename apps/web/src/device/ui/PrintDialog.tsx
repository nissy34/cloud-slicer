import { useEffect, useMemo, useState } from 'react';
import { formatDuration, formatGrams } from '../../lib/format';
import { currentSession, useDevice, type SendSource } from '../../state/device';
import { suggestToolMap, u1Heads, u1PrintOptions, u1PrintPrepGcode, type U1PrintOptions } from '../addons/u1';
import { uploadName } from '../commands';
import { metaFromMoonraker, readGcodeMeta, type GcodeMeta } from '../gcode-meta';
import { job } from '../status';
import { Dialog, Swatch } from './parts';

/**
 * Sends a file to the printer and optionally starts it. On a U1 the same
 * dialog also maps each filament in the file to a tool head and sets the
 * printer's own pre-print options.
 */
export function PrintDialog({ source }: { source: SendSource }) {
  const objects = useDevice((s) => s.objects);
  const addons = useDevice((s) => s.addons);
  const online = useDevice((s) => s.conn.state === 'online');
  const upload = useDevice((s) => s.upload);
  const close = () => useDevice.getState().openPrintDialog(null);
  const go = useDevice((s) => s.uploadAndMaybePrint);
  const isU1 = addons.some((a) => a.id === 'u1');
  const [meta, setMeta] = useState<GcodeMeta | null>(null);
  const [name, setName] = useState(source.kind === 'upload' ? uploadName(source.name) : source.path);
  const heads = useMemo(() => (isU1 ? u1Heads(objects) : []), [isU1, objects]);
  const [options, setOptions] = useState<U1PrintOptions>(() => u1PrintOptions(objects));
  const [toolMap, setToolMap] = useState<Record<number, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const state = job(objects).state;
  const printerBusy = state === 'printing' || state === 'paused';

  useEffect(() => {
    let live = true;
    const read = source.kind === 'upload' ? readGcodeMeta(source.blob) : (currentSession()?.metadata(source.path) ?? Promise.resolve(null)).then(metaFromMoonraker);
    void read.then((m) => live && setMeta(m));
    return () => {
      live = false;
    };
  }, [source]);

  // Suggest a head per filament once both the file and the printer's spools are known.
  useEffect(() => {
    if (meta && isU1 && toolMap == null && heads.length) setToolMap(suggestToolMap(meta.filaments, heads));
  }, [meta, isU1, heads, toolMap]);

  const submit = async (start: boolean) => {
    setBusy(true);
    const src: SendSource = source.kind === 'upload' ? { ...source, name: name.trim() || uploadName(source.name) } : source;
    const prep = start && isU1 ? u1PrintPrepGcode(options, toolMap ?? {}) : [];
    await go(src, { start, prep });
    setBusy(false);
  };

  const uploading = upload && source.kind === 'upload';
  return (
    <Dialog
      title={source.kind === 'upload' ? 'Send to printer' : 'Print'}
      onClose={close}
      wide={isU1}
      footer={
        <>
          {uploading && (
            <span className="dv-upload" aria-live="polite">
              <progress max={1} value={upload.fraction} /> Uploading {Math.round(upload.fraction * 100)}%
            </span>
          )}
          <button className="secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          {source.kind === 'upload' && (
            <button className="secondary" onClick={() => void submit(false)} disabled={busy || !online} data-testid="upload-only">
              Upload only
            </button>
          )}
          <button
            className="primary"
            onClick={() => void submit(true)}
            disabled={busy || !online || printerBusy}
            title={printerBusy ? 'The printer is already printing' : undefined}
            data-testid="upload-and-print"
          >
            {source.kind === 'upload' ? 'Upload and print' : 'Print'}
          </button>
        </>
      }
    >
      <div className="dv-form">
        {source.kind === 'upload' ? (
          <label>
            File name
            <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </label>
        ) : (
          <p className="dv-job-file">{source.path}</p>
        )}
      </div>
      {meta && (
        <p className="muted dv-print-facts">
          {meta.estimatedSeconds ? `${formatDuration(meta.estimatedSeconds)} print` : 'No time estimate'}
          {meta.layers ? ` · ${meta.layers} layers` : ''}
          {meta.filaments.length ? ` · ${formatGrams(meta.filaments.reduce((a, f) => a + f.grams, 0))} filament` : ''}
        </p>
      )}
      {printerBusy && <p className="dv-alert">The printer is busy, so this can only be uploaded for now.</p>}
      {!online && <p className="dv-alert">The printer is not connected.</p>}

      {isU1 && meta && meta.filaments.length > 0 && toolMap && (
        <fieldset className="dv-fieldset" data-testid="tool-map">
          <legend>Tool heads</legend>
          <ul className="dv-map">
            {meta.filaments.map((f) => {
              const head = heads[toolMap[f.index]];
              const mismatch = head && head.loaded && f.material && head.material && f.material.toUpperCase() !== head.material.toUpperCase();
              return (
                <li key={f.index}>
                  <span className="dv-map-file">
                    <Swatch colour={f.colour} />
                    <span>
                      Filament {f.index + 1} <span className="muted">{[f.material, f.grams ? formatGrams(f.grams) : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                  <span aria-hidden className="muted">
                    →
                  </span>
                  <span className="dv-map-head">
                    {head && <Swatch colour={head.colour} empty={!head.loaded} />}
                    <select
                      aria-label={`Tool head for filament ${f.index + 1}`}
                      value={toolMap[f.index]}
                      onChange={(e) => setToolMap({ ...toolMap, [f.index]: Number(e.target.value) })}
                    >
                      {heads.map((h) => (
                        <option key={h.index} value={h.index}>
                          {h.label} · {h.loaded ? `${h.material || '?'} ${h.subType}`.trim() : 'empty'}
                        </option>
                      ))}
                    </select>
                  </span>
                  {mismatch && <span className="dv-warn-text">The file expects {f.material}</span>}
                  {head && !head.loaded && <span className="dv-warn-text">No filament in {head.label}</span>}
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      {isU1 && (
        <fieldset className="dv-fieldset">
          <legend>Before printing</legend>
          <label className="check">
            <input type="checkbox" checked={options.bedLevel} onChange={(e) => setOptions({ ...options, bedLevel: e.target.checked })} />
            Level the bed
          </label>
          <label className="check">
            <input type="checkbox" checked={options.flowCalibrate} onChange={(e) => setOptions({ ...options, flowCalibrate: e.target.checked })} />
            Calibrate flow
          </label>
          <label className="check">
            <input type="checkbox" checked={options.timeLapse} onChange={(e) => setOptions({ ...options, timeLapse: e.target.checked })} />
            Record a time-lapse
          </label>
        </fieldset>
      )}
    </Dialog>
  );
}
