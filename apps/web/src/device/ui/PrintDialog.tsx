import { useEffect, useMemo, useState } from 'react';
import { formatDuration, formatGrams } from '../../lib/format';
import { currentSession, useDevice, type SendSource } from '../../state/device';
import type { PrinterCall } from '../addons';
import { noSlotReason, slotCheck, suggestSlotMap, type PrintOptions } from '../slots';
import { uploadName } from '../commands';
import { metaFromMoonraker, readGcode3mf, readGcodeMeta, type GcodeMeta } from '../gcode-meta';
import { job } from '../status';
import { useAlerts } from '../../state/alerts';
import { LayerField } from './AlertsCard';
import { Swatch } from '../../components/Swatch';
import { Dialog } from '../../components/Dialog';
import { Note } from '../../components/Note';

/** What the upload bar says before the first byte leaves. */
const UPLOAD_STAGE = {
  start: 'Uploading…',
  zipping: 'Zipping…',
  direct: 'Opening a direct link…',
  relay: 'Direct link blocked, sending through the relay…',
};

/**
 * Sends a file to the printer and optionally starts it. With more than one
 * saved printer, a new file can go to any of them: picking one connects to
 * it. On a printer whose add-on knows where its filaments are (a U1's tool
 * heads, a Bambu Lab AMS), the same dialog also maps each filament in the file
 * to one of them, and sets the printer's own pre-print options.
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
  const sendError = useDevice((s) => s.sendError);
  const close = () => useDevice.getState().openPrintDialog(null);
  const go = useDevice((s) => s.uploadAndMaybePrint);
  const slotAddon = addons.find((a) => a.filaments);
  const fil = slotAddon?.filaments;
  const optionsAddon = addons.find((a) => a.printOptions);
  const starter = addons.find((a) => a.startPrint);
  // Alerts for the printer picked here, as the Alerts card has them.
  const alertsHere = useAlerts((s) => s.printerId === activeId);
  const alertStatus = useAlerts((s) => s.status);
  const alertPrefs = useAlerts((s) => (s.status === 'on' ? s.prefs : null));
  const alertProblem = useAlerts((s) => s.problem);
  useEffect(() => void useAlerts.getState().load(), [activeId]);
  const [meta, setMeta] = useState<GcodeMeta | null>(null);
  const [name, setName] = useState(source.kind === 'upload' ? uploadName(source.name) : source.path);
  const path = source.kind === 'upload' ? source.name : source.path;
  // A file the printer can map (a Bambu Lab printer: only a .gcode.3mf).
  const mapping = Boolean(fil && (!fil.maps || fil.maps(path)));
  const slots = useMemo(() => (mapping ? (fil?.read(objects) ?? []) : []), [mapping, fil, objects]);
  // What the user changed; the rest follows the printer's own settings.
  const [optionEdits, setOptionEdits] = useState<Partial<PrintOptions>>({});
  const options = optionsAddon?.printOptions ? { ...optionsAddon.printOptions(objects), ...optionEdits } : null;
  const [toolMap, setToolMap] = useState<Record<number, number> | null>(null);
  // The plate inside a .gcode.3mf, which the printer is told to print.
  const [plate, setPlate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const state = job(objects).state;
  const printerBusy = state === 'printing' || state === 'paused';
  const mapChecks = useMemo(() => {
    const out = new Map<number, ReturnType<typeof slotCheck>>();
    if (!fil || !mapping || !meta || !toolMap) return out;
    for (const f of meta.filaments) {
      const slot = slots[toolMap[f.index]];
      out.set(f.index, slot ? slotCheck(f, slot, fil.words) : { blocked: noSlotReason(f, fil.words), warning: null });
    }
    return out;
  }, [fil, mapping, meta, toolMap, slots]);
  const mapBlocked = [...mapChecks.values()].some((c) => c.blocked);

  useEffect(() => {
    let live = true;
    setPlate(null);
    // A .gcode.3mf: the plate inside, and its G-code for the details.
    const bundle = source.kind === 'upload' && /\.3mf$/i.test(source.name) ? readGcode3mf(source.blob) : Promise.resolve(null);
    const read =
      source.kind === 'upload'
        ? bundle.then((b) => {
            if (live && b) setPlate(b.plate);
            return readGcodeMeta(source.gcode ?? b?.gcode ?? source.blob);
          })
        : (currentSession()?.metadata(source.path) ?? Promise.resolve(null)).then(metaFromMoonraker);
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

  // Suggest a slot per filament once both the file and the printer's spools are known.
  useEffect(() => {
    if (meta && fil && toolMap == null && slots.length) setToolMap(suggestSlotMap(meta.filaments, slots, fil.words));
  }, [meta, fil, slots, toolMap]);

  const submit = async (start: boolean) => {
    setBusy(true);
    const src: SendSource = source.kind === 'upload' ? { ...source, name: name.trim() || uploadName(source.name) } : source;
    const begin = (at: string): PrinterCall[] =>
      starter?.startPrint
        ? starter.startPrint({
            path: at,
            map: mapping ? (toolMap ?? {}) : {},
            filamentCount: meta?.filamentCount ?? 0,
            options: options ?? { bedLevel: false, flowCalibrate: false, timeLapse: false },
            slots,
            plate,
          })
        : [{ method: 'printer.print.start', params: { filename: at }, timeoutMs: 60_000 }];
    await go(src, { start: start ? begin : null });
    setBusy(false);
  };

  const uploading = upload && source.kind === 'upload';
  return (
    <Dialog
      title={
        source.kind === 'upload' ? `Send to ${printer?.name ?? 'printer'}` : printer ? `Print on ${printer.name}` : 'Print'
      }
      onClose={close}
      wide={Boolean(fil)}
      footer={
        <>
          {sendError && !busy && (
            <Note tone="error" className="dv-send-error" testId="send-error">
              {sendError}
            </Note>
          )}
          {uploading && (
            <span className="dv-upload" aria-live="polite">
              {upload.fraction > 0 ? (
                <>
                  <progress max={1} value={upload.fraction} /> Uploading {Math.round(upload.fraction * 100)}%{upload.stage === 'relay' && ' through the relay'}
                </>
              ) : (
                <>
                  {/* Before the first byte leaves: zipping, then opening a direct link or not. */}
                  <progress max={1} /> {UPLOAD_STAGE[upload.stage ?? 'start']}
                </>
              )}
            </span>
          )}
          {/* While the file goes up, Cancel stops it; once it's starting a print, it waits. */}
          <button className="secondary" onClick={uploading ? () => useDevice.getState().cancelUpload() : close} disabled={busy && !uploading} data-testid="send-cancel">
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
            title={printerBusy ? 'The printer is already printing' : mapBlocked ? `A filament is mapped to a ${fil?.words.noun ?? 'slot'} it can’t print on` : undefined}
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

      {fil && mapping && meta && meta.filaments.length > 0 && toolMap && (
        <fieldset className="dv-fieldset" data-testid="tool-map">
          <legend>{fil.title}</legend>
          <ul className="dv-map">
            {meta.filaments.map((f) => {
              const slot = slots[toolMap[f.index]];
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
                    {slot ? <Swatch colour={slot.colour} empty={!slot.ready} /> : <Swatch colour="#888888" empty />}
                    <select
                      aria-label={`${fil.words.noun[0].toUpperCase()}${fil.words.noun.slice(1)} for filament ${f.index + 1}`}
                      aria-invalid={check?.blocked ? true : undefined}
                      value={toolMap[f.index]}
                      onChange={(e) => setToolMap({ ...toolMap, [f.index]: Number(e.target.value) })}
                    >
                      {!slot && (
                        <option value={-1} disabled>
                          No matching {fil.words.noun}
                        </option>
                      )}
                      {slots.map((h) => {
                        const blocked = slotCheck(f, h, fil.words).blocked;
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
                  {slot && !check?.blocked && !slot.ready && <span className="dv-warn-text">No filament in {slot.label}</span>}
                </li>
              );
            })}
          </ul>
          <p className="muted dv-map-note">{fil.note}</p>
        </fieldset>
      )}
      {fil && !mapping && meta && meta.filaments.length > 1 && (
        <p className="muted dv-map-note" data-testid="no-map">
          Plain G-code prints filament 1 from the first {fil.words.noun}, filament 2 from the second, and so on. Slice for this printer to send a .gcode.3mf and choose them here.
        </p>
      )}
      {options && (!fil || mapping) && (
        <fieldset className="dv-fieldset">
          <legend>Before printing</legend>
          <div className="switch-list">
          <label className="switch-row">
            <input className="switch" type="checkbox" checked={options.bedLevel} onChange={(e) => setOptionEdits({ ...optionEdits, bedLevel: e.target.checked })} />
            Level the bed
          </label>
          <label className="switch-row">
            <input className="switch" type="checkbox" checked={options.flowCalibrate} onChange={(e) => setOptionEdits({ ...optionEdits, flowCalibrate: e.target.checked })} />
            Calibrate flow
          </label>
          <label className="switch-row">
            <input className="switch" type="checkbox" checked={options.timeLapse} onChange={(e) => setOptionEdits({ ...optionEdits, timeLapse: e.target.checked })} />
            Record a time-lapse
          </label>
          </div>
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
