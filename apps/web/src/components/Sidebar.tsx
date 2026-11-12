import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { shortName } from '../lib/presets';
import { installedFilaments, installedOnly, installedPrinters, SETUP_KEY, type Setup } from '../lib/setup';
import { canSend } from '../lib/printer-catalog';
import { useUserSetting } from '../state/account';
import { SendMark, useSetupWizard } from './SetupWizard';
import { CalibrationBanner } from './CalibrationDialog';
import { useFilamentLimit, useSlicer } from '../state/store';
import { filamentLimitMessage } from '../lib/filament-limit';
import { ObjectList } from './ObjectList';
import { ColorMixPanel } from './ColorMixing';
import { SyncFilamentsButton, usePrinterFilamentRows, type PrinterFilamentRow } from './FilamentSync';
import { useDevice } from '../state/device';
import { FlushVolumesButton } from './FlushVolumes';
import { OptionField } from './OptionField';
import { SettingsPanel } from './SettingsPanel';
import { PresetMenu } from '../account/PresetMenu';
import { EditPresetButton } from './PresetSettingsDialog';
import { EngineSection } from './EngineSection';
import type { PresetSummary } from '../engine/protocol';
import { Printer, Settings, SlidersHorizontal, Spool, X } from 'lucide-react';
import { Picker, type PickerOption } from './Picker';
import { IconButton } from './IconButton';
import { ColourPicker } from './ColourPicker';
import { toHex6 } from '../lib/colours';
import { filamentsByBrand, type FilamentOrder } from '../lib/filament-order';

/** The user's own presets always show, whatever the setup wizard installed. */
const withMine = (installed: string[] | undefined, list: PresetSummary[]) =>
  installed && [...installed, ...list.filter((p) => p.user).map((p) => p.name)];


function PrinterSection() {
  const { t } = useTranslation();
  const allPrinters = useSlicer((s) => s.printers);
  const selection = useSlicer((s) => s.selection);
  const selectPrinter = useSlicer((s) => s.selectPrinter);
  const installed = installedPrinters(useUserSetting<Setup>(SETUP_KEY), useSlicer((s) => s.flavor));
  const printers = installedOnly(allPrinters, withMine(installed, allPrinters), selection?.printer);
  const manage = useSetupWizard((s) => s.show);
  const busy = useSlicer((s) => s.engine !== 'ready');
  const catalog = useSlicer((s) => s.catalog);
  const sends = (name: string) => canSend(catalog, name, allPrinters);
  const selectedSends = selection ? sends(selection.printer) : null;
  const mine = t('sidebar.myPrinters');
  const group = (p: PresetSummary) => (p.user ? mine : p.vendor || t('sidebar.otherPrinters'));
  const vendors = [...new Set(printers.map(group))].sort((a, b) => Number(b === mine) - Number(a === mine));
  return (
    <section className="group">
      <div className="group-head">
        <h2>
          <Printer aria-hidden />
          {t('sidebar.printer')}
        </h2>
        <div className="group-actions">
          <button className="quiet" onClick={() => manage('printers')}>
            {t('sidebar.manage')}
          </button>
          <EditPresetButton type="printer" />
          <PresetMenu type="printer" />
        </div>
      </div>
      <Picker
        field
        label={t('sidebar.printerPreset')}
        value={selection?.printer ?? null}
        disabled={busy}
        options={vendors.flatMap((v) =>
          printers
            .filter((p) => group(p) === v)
            .map((p) => ({ value: p.name, label: p.name, group: v, hint: sends(p.name) ? <SendMark /> : undefined })),
        )}
        onChange={(name) => void selectPrinter(name)}
        // Like desktop's printer list: to add more or remove some.
        actions={[{ id: 'add', label: t('sidebar.addRemovePrinters'), icon: Settings }]}
        onAction={() => manage('printers')}
      />
      {selectedSends === true && (
        <p className="muted small printer-send">
          <SendMark /> {t('sidebar.sendsFromDevice')}
        </p>
      )}
      {selectedSends === false && <p className="muted small printer-send">{t('sidebar.noDirectPrint')}</p>}
      <OptionField optKey="curr_bed_type" label={t('sidebar.plateType')} />
    </section>
  );
}

function FilamentSection() {
  const { t } = useTranslation();
  const selection = useSlicer((s) => s.selection);
  const allFilaments = useSlicer((s) => s.filaments);
  const filamentOrder = useSlicer((s) => s.filamentOrder);
  const installed = installedFilaments(useUserSetting<Setup>(SETUP_KEY), useSlicer((s) => s.flavor));
  const filaments = installedOnly(allFilaments, withMine(installed, allFilaments), selection?.filaments);
  const { setFilament, setColour, addFilament, removeFilament } = useSlicer.getState();
  const manage = useSetupWizard((s) => s.show);
  const limit = useFilamentLimit();
  const onPrinter = usePrinterFilamentRows();
  if (!selection) return null;
  const limitMessage = filamentLimitMessage(limit, selection.filaments.length);
  return (
    <section className="group">
      <div className="group-head">
        <h2>
          <Spool aria-hidden />
          {t('sidebar.filament')}
        </h2>
        <div className="group-actions spaced">
          <SyncFilamentsButton />
          <button className="quiet" onClick={() => void addFilament()} aria-label={t('sidebar.addFilament')}>
            {t('sidebar.add')}
          </button>
        </div>
      </div>
      <ol className="slots">
        {selection.filaments.map((name, i) => (
          <li key={i} className="slot" data-preset={name}>
            <ColourPicker label={t('sidebar.filamentNColour', { n: i + 1 })} title={t('sidebar.filamentColour')} number={i + 1} value={selection.colours[i]} onChange={(hex) => void setColour(i, hex)} />
            <Picker
              field
              label={t('sidebar.filamentNPreset', { n: i + 1 })}
              value={printerRowFor(onPrinter?.rows, name, selection.colours[i]) ?? name}
              options={[
                ...printerOptions(onPrinter),
                ...(filaments.some((f) => f.name === name) ? [] : [{ value: name, label: shortName(name) }]),
                ...filamentOptions(filaments, filamentOrder),
              ]}
              onChange={(next) => {
                const row = onPrinter?.rows.find((r) => `${PRINTER_ROW}${r.head}` === next);
                void (row ? setFilament(i, row.preset, row.colour) : setFilament(i, next));
              }}
              // Connects the Device tab's printer, so its filaments can show at the top.
              onOpen={() => useDevice.getState().start()}
              // Like desktop's filament list.
              actions={[{ id: 'add', label: t('sidebar.addRemoveFilaments'), icon: Settings }]}
              onAction={() => manage('filaments')}
            />
            <EditPresetButton type="filament" slot={i} />
            <PresetMenu type="filament" slot={i} />
            <IconButton icon={X} label={t('sidebar.removeFilament')} aria-label={t('sidebar.removeFilamentN', { n: i + 1 })} disabled={selection.filaments.length <= 1} onClick={() => void removeFilament(i)} />
          </li>
        ))}
      </ol>
      <FlushVolumesButton />
      {limitMessage && (
        <p className={limitMessage.warn ? 'hint warn' : 'hint'} data-testid="filament-limit">
          {limitMessage.text}
        </p>
      )}
      <ColorMixPanel />
    </section>
  );
}

function ProcessSection() {
  const { t } = useTranslation();
  const processes = useSlicer((s) => s.processes);
  const selection = useSlicer((s) => s.selection);
  const selectProcess = useSlicer((s) => s.selectProcess);
  return (
    <section className="group">
      <div className="group-head">
        <h2>
          <SlidersHorizontal aria-hidden />
          {t('sidebar.process')}
        </h2>
        <PresetMenu type="process" />
      </div>
      <label className="field">
        <span className="sr-only">{t('sidebar.processPreset')}</span>
        <Picker field label={t('sidebar.processPreset')} value={selection?.process ?? null} options={presetOptions(processes)} onChange={(v) => void selectProcess(v)} />
      </label>
    </section>
  );
}

const PRINTER_ROW = 'printer-head:';

/**
 * The printer's loaded filaments at the top of the list, like desktop's "AMS
 * filaments": the head's colour as the square with its name inside, then the
 * preset it becomes; picking one sets the preset and the colour.
 */
function printerOptions(on: ReturnType<typeof usePrinterFilamentRows>): PickerOption[] {
  if (!on) return [];
  if (on.reading) return [{ value: `${PRINTER_ROW}reading`, label: i18n.t('sidebar.readingFilaments'), group: on.group, disabled: true }];
  return on.rows.map((r) => ({ value: `${PRINTER_ROW}${r.head}`, label: shortName(r.preset), group: on.group, swatch: r.colour, swatchNumber: r.label, tag: r.label }));
}

/** The printer row this filament is (its preset and colour are that head's, as desktop ticks it), if any. */
function printerRowFor(rows: PrinterFilamentRow[] | undefined, preset: string, colour: string): string | undefined {
  const row = rows?.find((r) => r.preset === preset && r.colour === toHex6(colour).toUpperCase());
  return row && `${PRINTER_ROW}${row.head}`;
}

/**
 * The filament list's choices, like Snapmaker Orca 2.4.1's filament menu: the
 * user's own presets first, then a heading per brand (lib/filament-order.ts).
 */
function filamentOptions(presets: PresetSummary[], order: FilamentOrder): PickerOption[] {
  const option = (p: PresetSummary, group: string) => ({ value: p.name, label: shortName(p.name), group });
  const brands = filamentsByBrand(
    presets.filter((p) => !p.user),
    order,
    (p) => shortName(p.name),
  );
  return [...presets.filter((p) => p.user).map((p) => option(p, i18n.t('sidebar.myPresets'))), ...brands.flatMap(([brand, list]) => list.map((p) => option(p, brand)))];
}

/** A list's choices: the user's own presets first, under their own heading. */
function presetOptions(presets: PresetSummary[]): PickerOption[] {
  const mine = presets.filter((p) => p.user);
  const options = (list: PresetSummary[], group?: string) => list.map((p) => ({ value: p.name, label: shortName(p.name), group }));
  if (!mine.length) return options(presets);
  return [...options(mine, i18n.t('sidebar.myPresets')), ...options(presets.filter((p) => !p.user), i18n.t('sidebar.systemPresets'))];
}

export function Sidebar() {
  return (
    <aside className="panel">
      <CalibrationBanner />
      <EngineSection />
      <PrinterSection />
      <FilamentSection />
      <ObjectList />
      <ProcessSection />
      <SettingsPanel />
    </aside>
  );
}

