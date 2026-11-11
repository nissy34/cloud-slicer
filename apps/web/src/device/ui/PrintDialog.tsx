import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Picker } from '../../components/Picker';

/** What the upload bar says before the first byte leaves (word keys). */
const UPLOAD_STAGE = {
  start: 'deviceSend.stageStart',
  zipping: 'deviceSend.stageZipping',
  direct: 'deviceSend.stageDirect',
  relay: 'deviceSend.stageRelay',
};

/**
 * Sends a file to the printer and optionally starts it. With more than one
 * saved printer, a new file can go to any of them: picking one connects to
 * it. On a printer whose add-on knows where its filaments are (a U1's tool
 * heads, a Bambu Lab AMS), the same dialog also maps each filament in the file
 * to one of them, and sets the printer's own pre-print options.
 */
export function PrintDialog({ source }: { source: SendSource }) {
  const { t } = useTranslation();
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
            ...(meta?.bedType && { bedType: meta.bedType }),
          })
        : [{ method: 'printer.print.start', params: { filename: at }, timeoutMs: 60_000 }];
    await go(src, { start: start ? begin : null });
    setBusy(false);
  };

  const uploading = upload && source.kind === 'upload';
  return (
    <Dialog
      title={
        source.kind === 'upload'
          ? printer
            ? t('deviceSend.sendTo', { name: printer.name })
            : t('deviceSend.sendToPrinter')
          : printer
            ? t('deviceSend.printOn', { name: printer.name })
            : t('deviceSend.print')
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
                  <progress max={1} value={upload.fraction} />{' '}
                  {upload.stage === 'relay'
                    ? t('deviceSend.uploadingRelay', { percent: Math.round(upload.fraction * 100) })
                    : t('deviceSend.uploading', { percent: Math.round(upload.fraction * 100) })}
                </>
              ) : (
                <>
                  {/* Before the first byte leaves: zipping, then opening a direct link or not. */}
                  <progress max={1} /> {t(UPLOAD_STAGE[upload.stage ?? 'start'])}
                </>
              )}
            </span>
          )}
          {/* While the file goes up, Cancel stops it; once it's starting a print, it waits. */}
          <button className="secondary" onClick={uploading ? () => useDevice.getState().cancelUpload() : close} disabled={busy && !uploading} data-testid="send-cancel">
            {t('common.cancel')}
          </button>
          {source.kind === 'upload' && (
            <button className="secondary" onClick={() => void submit(false)} disabled={busy || !online} data-testid="upload-only">
              {t('deviceSend.uploadOnly')}
            </button>
          )}
          <button
            className="primary"
            onClick={() => void submit(true)}
            disabled={busy || !online || printerBusy || mapBlocked}
            title={printerBusy ? t('deviceSend.alreadyPrinting') : mapBlocked ? t('deviceSend.mapBlocked', { noun: fil?.words.noun ?? t('deviceSend.slot') }) : undefined}
            data-testid="upload-and-print"
          >
            {source.kind === 'upload' ? t('deviceSend.uploadAndPrint') : t('deviceSend.print')}
          </button>
        </>
      }
    >
      <div className="dv-form">
        {source.kind === 'upload' && printers.length > 1 && (
          <label>
            {t('deviceSend.printer')}
            <Picker
              field
              label={t('deviceSend.printer')}
              testId="send-printer"
              value={activeId}
              disabled={busy}
              options={printers.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => useDevice.getState().select(id)}
            />
          </label>
        )}
        {source.kind === 'upload' ? (
          <label>
            {t('deviceSend.fileName')}
            <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </label>
        ) : (
          <p className="dv-job-file">{source.path}</p>
        )}
      </div>
      {meta && (
        <p className="muted dv-print-facts">
          {meta.estimatedSeconds ? t('deviceSend.printTime', { time: formatDuration(meta.estimatedSeconds) }) : t('deviceSend.noEstimate')}
          {meta.layers ? ` · ${t('deviceSend.layers', { count: meta.layers })}` : ''}
          {meta.filaments.length ? ` · ${t('deviceSend.filament', { amount: formatGrams(meta.filaments.reduce((a, f) => a + f.grams, 0)) })}` : ''}
        </p>
      )}
      {printerBusy && <p className="dv-alert">{t('deviceSend.busy')}</p>}
      {!online && <p className="dv-alert">{conn === 'connecting' ? (printer ? t('deviceSend.connectingTo', { name: printer.name }) : t('deviceSend.connecting')) : printer ? t('deviceSend.notConnectedName', { name: printer.name }) : t('deviceSend.notConnected')}</p>}
      {meta?.printer && printer?.preset && meta.printer !== printer.preset && (
        <p className="dv-alert" data-testid="profile-mismatch">
          {t('deviceSend.mismatch', { sliced: meta.printer, name: printer.name, preset: printer.preset })}
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
                    <Swatch colour={f.colour} number={f.index + 1} />
                    <span>
                      {t('deviceSend.filamentN', { n: f.index + 1 })} <span className="muted">{[f.material, f.grams ? formatGrams(f.grams) : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                  <span aria-hidden className="muted">
                    →
                  </span>
                  <span className="dv-map-head">
                    {/* The printer's filaments, its slot name in the square, like every filament picker. */}
                    <Picker
                      field
                      label={t('deviceSend.slotFor', { noun: `${fil.words.noun[0].toUpperCase()}${fil.words.noun.slice(1)}`, n: f.index + 1 })}
                      invalid={Boolean(check?.blocked)}
                      value={String(toolMap[f.index])}
                      placeholder={t('deviceSend.noMatching', { noun: fil.words.noun })}
                      options={slots.map((h) => {
                        const blocked = slotCheck(f, h, fil.words).blocked;
                        return {
                          value: String(h.index),
                          label: h.material ? `${h.material} ${h.subType}`.trim() : t('deviceSend.empty'),
                          swatch: h.colour,
                          swatchNumber: h.label,
                          swatchEmpty: !h.ready,
                          disabled: Boolean(blocked),
                          title: blocked ?? undefined,
                        };
                      })}
                      onChange={(v) => setToolMap({ ...toolMap, [f.index]: Number(v) })}
                    />
                  </span>
                  {check?.blocked && (
                    <span className="dv-error-text" data-testid="map-blocked">
                      {check.blocked}
                    </span>
                  )}
                  {check?.warning && <span className="dv-warn-text">{check.warning}</span>}
                  {slot && !check?.blocked && !slot.ready && <span className="dv-warn-text">{t('deviceSend.noFilamentIn', { slot: slot.label })}</span>}
                </li>
              );
            })}
          </ul>
          <p className="muted dv-map-note">{fil.note}</p>
        </fieldset>
      )}
      {fil && !mapping && meta && meta.filaments.length > 1 && (
        <p className="muted dv-map-note" data-testid="no-map">
          {t('deviceSend.plainGcode', { noun: fil.words.noun })}
        </p>
      )}
      {options && (!fil || mapping) && (
        <fieldset className="dv-fieldset">
          <legend>{t('deviceSend.beforePrinting')}</legend>
          <div className="switch-list">
          <label className="switch-row">
            <input className="switch" type="checkbox" checked={options.bedLevel} onChange={(e) => setOptionEdits({ ...optionEdits, bedLevel: e.target.checked })} />
            {t('deviceSend.levelBed')}
          </label>
          {options.flowCalibrate !== undefined && (
            <label className="switch-row">
              <input className="switch" type="checkbox" checked={options.flowCalibrate} onChange={(e) => setOptionEdits({ ...optionEdits, flowCalibrate: e.target.checked })} />
              {t('deviceSend.calibrateFlow')}
            </label>
          )}
          <label className="switch-row">
            <input className="switch" type="checkbox" checked={options.timeLapse} onChange={(e) => setOptionEdits({ ...optionEdits, timeLapse: e.target.checked })} />
            {t('deviceSend.timeLapse')}
          </label>
          </div>
        </fieldset>
      )}
      {alertsHere && alertStatus !== 'loading' && (
        <fieldset className="dv-fieldset" data-testid="send-layer-alert">
          <legend>{t('deviceSend.alert')}</legend>
          {alertProblem && alertProblem !== 'offline' ? (
            <p className="muted">{t('deviceSend.cantAlert')}</p>
          ) : (
            <>
              <div className="dv-print-layer">
                <LayerField prefs={alertPrefs} max={meta?.layers} onSet={(layer) => void layerAlert(layer)} />
              </div>
              {alertStatus !== 'on' && <p className="muted dv-map-note">{t('deviceSend.alertsOff')}</p>}
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
