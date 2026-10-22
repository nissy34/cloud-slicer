import { useEffect, useMemo, useState } from 'react';
import { formatDuration, formatGrams } from '../../lib/format';
import { currentSession, useDevice, type SendSource } from '../../state/device';
import { suggestToolMap, u1Heads, u1MappingCheck, u1NoHeadReason, u1PrintOptions, u1PrintPrepGcode, type U1PrintOptions } from '../addons/u1';
import { uploadName } from '../commands';
import { metaFromMoonraker, readGcodeMeta, type GcodeMeta } from '../gcode-meta';
import { job } from '../status';
import { useAlerts } from '../../state/alerts';
import { LayerField } from './AlertsCard';
import { Dialog, Swatch } from './parts';

/**
 * Sends a file to the printer and optionally starts it. With more than one
 * saved printer, a new file can go to any of them: picking one connects to
 * it. On a U1 the same dialog also maps each filament in the file to a tool
 * head and sets the printer's own pre-print options.
 */
export function PrintDialog({ source }: { source: SendSource }) {
  const objects = useDevice((s) => s.objects);
  const addons = useDevice((s) => s.addons);
  const conn = useDevice((s) => s.conn.state);
  const online = conn === 'online';
  const printers = useDevice((s) => s.printers);
  const activeId = useDevice((s) => s.activeId);
  const printer = printers.find((p) => p.id === activeId);
  const upload = useDevice((s) => s.upload);
  const close = () => useDevice.getState().openPrintDialog(null);
  const go = useDevice((s) => s.uploadAndMaybePrint);
  const isU1 = addons.some((a) => a.id === 'u1');
  // Alerts for the printer picked here, as the Alerts card has them.
  const alertsHere = useAlerts((s) => s.printerId === activeId);
  const alertStatus = useAlerts((s) => s.status);
  const alertPrefs = useAlerts((s) => (s.status === 'on' ? s.prefs : null));
  const alertProblem = useAlerts((s) => s.problem);
  useEffect(() => void useAlerts.getState().load(), [activeId]);
  const [meta, setMeta] = useState<GcodeMeta | null>(null);
  const [name, setName] = useState(source.kind === 'upload' ? uploadName(source.name) : source.path);
  const heads = useMemo(() => (isU1 ? u1Heads(objects) : []), [isU1, objects]);
  // What the user changed; the rest follows the printer's own settings.
  const [optionEdits, setOptionEdits] = useState<Partial<U1PrintOptions>>({});
  const options = { ...u1PrintOptions(objects), ...optionEdits };
  const [toolMap, setToolMap] = useState<Record<number, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const state = job(objects).state;
  const printerBusy = state === 'printing' || state === 'paused';
  const mapChecks = useMemo(() => {
    const out = new Map<number, ReturnType<typeof u1MappingCheck>>();
    if (!isU1 || !meta || !toolMap) return out;
    for (const f of meta.filaments) {
      const head = heads[toolMap[f.index]];
      out.set(f.index, head ? u1MappingCheck(f, head) : { blocked: u1NoHeadReason(f), warning: null });
    }
    return out;
  }, [isU1, meta, toolMap, heads]);
  const mapBlocked = [...mapChecks.values()].some((c) => c.blocked);

  useEffect(() => {
    let live = true;
    const read = source.kind === 'upload' ? readGcodeMeta(source.blob) : (currentSession()?.metadata(source.path) ?? Promise.resolve(null)).then(metaFromMoonraker);
    void read.then((m) => live && setMeta(m));
    return () => {
      live = false;
    };
  }, [source]);

  // Another printer: its own heads and settings.
  useEffect(() => {
    setToolMap(null);
    setOptionEdits({});
  }, [activeId]);

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
      title={
        source.kind === 'upload' ? `Send to ${printer?.name ?? 'printer'}` : printer ? `Print on ${printer.name}` : 'Print'
      }
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
            disabled={busy || !online || printerBusy || mapBlocked}
            title={printerBusy ? 'The printer is already printing' : mapBlocked ? 'A filament is mapped to a tool head it can’t print on' : undefined}
            data-testid="upload-and-print"
          >
            {source.kind === 'upload' ? 'Upload and print' : 'Print'}
          </button>
        </>
      }
    >
      <div className="dv-form">
        {source.kind === 'upload' && printers.length > 1 && (
          <label>
            Printer
            <select value={activeId ?? ''} onChange={(e) => useDevice.getState().select(e.target.value)} disabled={busy} data-testid="send-printer">
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
      {!online && <p className="dv-alert">{conn === 'connecting' ? `Connecting to ${printer?.name ?? 'the printer'}…` : `${printer?.name ?? 'The printer'} is not connected.`}</p>}
      {meta?.printer && printer?.preset && meta.printer !== printer.preset && (
        <p className="dv-alert" data-testid="profile-mismatch">
          This file was sliced for {meta.printer}, but {printer.name} is set up as {printer.preset}. Choose that printer in the slicer and slice again before printing.
        </p>
      )}

      {isU1 && meta && meta.filaments.length > 0 && toolMap && (
        <fieldset className="dv-fieldset" data-testid="tool-map">
          <legend>Tool heads</legend>
          <ul className="dv-map">
            {meta.filaments.map((f) => {
              const head = heads[toolMap[f.index]];
              const check = mapChecks.get(f.index);
              return (
                <li key={f.index} data-blocked={check?.blocked ? '' : undefined}>
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
                    {head ? <Swatch colour={head.colour} empty={!head.ready} /> : <Swatch colour="#888888" empty />}
                    <select
                      aria-label={`Tool head for filament ${f.index + 1}`}
                      aria-invalid={check?.blocked ? true : undefined}
                      value={toolMap[f.index]}
                      onChange={(e) => setToolMap({ ...toolMap, [f.index]: Number(e.target.value) })}
                    >
                      {!head && (
                        <option value={-1} disabled>
                          No matching head
                        </option>
                      )}
                      {heads.map((h) => {
                        const blocked = u1MappingCheck(f, h).blocked;
                        return (
                          <option key={h.index} value={h.index} disabled={Boolean(blocked)} title={blocked ?? undefined}>
                            {h.label} · {h.material ? `${h.material} ${h.subType}`.trim() : 'empty'}
                          </option>
                        );
                      })}
                    </select>
                  </span>
                  {check?.blocked && (
                    <span className="dv-error-text" data-testid="map-blocked">
                      {check.blocked}
                    </span>
                  )}
                  {check?.warning && <span className="dv-warn-text">{check.warning}</span>}
                  {head && !check?.blocked && !head.ready && <span className="dv-warn-text">No filament in {head.label}</span>}
                </li>
              );
            })}
          </ul>
          <p className="muted dv-map-note">
            As in Snapmaker’s own app, a filament can only go to a head with the same filament type and nozzle size. Brand and colour can differ.
          </p>
        </fieldset>
      )}
      {isU1 && (
        <fieldset className="dv-fieldset">
          <legend>Before printing</legend>
          <label className="check">
            <input type="checkbox" checked={options.bedLevel} onChange={(e) => setOptionEdits({ ...optionEdits, bedLevel: e.target.checked })} />
            Level the bed
          </label>
          <label className="check">
            <input type="checkbox" checked={options.flowCalibrate} onChange={(e) => setOptionEdits({ ...optionEdits, flowCalibrate: e.target.checked })} />
            Calibrate flow
          </label>
          <label className="check">
            <input type="checkbox" checked={options.timeLapse} onChange={(e) => setOptionEdits({ ...optionEdits, timeLapse: e.target.checked })} />
            Record a time-lapse
          </label>
        </fieldset>
      )}
      {alertsHere && alertStatus !== 'loading' && (
        <fieldset className="dv-fieldset" data-testid="send-layer-alert">
          <legend>Alert</legend>
          {alertProblem && alertProblem !== 'offline' ? (
            <p className="muted">This device can’t show alerts. The Alerts card on the Device tab says why.</p>
          ) : (
            <>
              <div className="dv-print-layer">
                <LayerField prefs={alertPrefs} max={meta?.layers} onSet={(layer) => void layerAlert(layer)} />
              </div>
              {alertStatus !== 'on' && <p className="muted dv-map-note">Alerts are off for this printer. A layer here turns them on, with the usual alerts (problems and Finished).</p>}
            </>
          )}
        </fieldset>
      )}
    </Dialog>
  );
}

/** "Alert me after layer N" from the Print dialog, turning alerts on first when they're off. */
async function layerAlert(layer: number | null) {
  const a = useAlerts.getState();
  if (a.status !== 'on') {
    if (layer == null) return;
    await a.enable();
  }
  const { status, prefs } = useAlerts.getState();
  if (status === 'on' && prefs) await useAlerts.getState().save({ ...prefs, layer });
}
