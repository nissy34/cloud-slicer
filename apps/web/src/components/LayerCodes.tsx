import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayerCode } from '../engine/protocol';
import { canChangeFilament, codeAt, codeLabel, layerOf, newCode, withCodeAt } from '../lib/layerCodes';
import { NO_COLOURS, useOption, usePlateOption, useSlicer } from '../state/store';
import { Swatch } from './Swatch';
import { filamentChoices } from '../lib/filament-choices';

const NO_CODES: LayerCode[] = [];

/** The sliced plate's layer items (pauses, filament changes, custom G-code). */
export function useLayerCodes() {
  return useSlicer((s) => (s.job.kind === 'sliced' ? (s.project?.plates[s.job.plate]?.layerCodes ?? NO_CODES) : NO_CODES));
}

/** A marker's colour on the slider: the new filament's colour for a filament change. */
function markColour(code: LayerCode, palette: string[]) {
  if (code.type === 'filament') return palette[code.filament - 1] ?? code.colour ?? '#888';
  if (code.type === 'pause') return 'var(--danger)';
  return 'var(--muted)';
}

/**
 * Desktop's ticks on the layer slider: one marker per item, where its layer
 * sits along the slider. Tapping one goes to its layer.
 */
export function LayerMarks({ layerZ, onLayer }: { layerZ: Float32Array; onLayer(layer: number): void }) {
  const { t } = useTranslation();
  const codes = useLayerCodes();
  const palette = usePalette();
  const last = layerZ.length - 1;
  if (!codes.length || last < 1) return null;
  return (
    <div className="layer-marks" data-testid="layer-marks">
      {codes.map((c) => {
        const layer = layerOf(c.z, layerZ);
        return (
          <button
            key={c.z}
            className={`layer-mark ${c.type}`}
            // Along the track, which runs half a thumb in from each end.
            style={{ left: `calc(9px + (100% - 18px) * ${layer / last})`, color: markColour(c, palette) }}
            title={t('layerCodes.markLabel', { layer: layer + 1, what: codeLabel(c) })}
            aria-label={t('layerCodes.markLabel', { layer: layer + 1, what: codeLabel(c) })}
            onClick={() => onLayer(layer)}
          />
        );
      })}
    </div>
  );
}

function usePalette() {
  const palette = useSlicer((s) => s.palette);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  return palette.length ? palette : colours;
}

type Form = null | 'gcode' | 'jump';

/**
 * Desktop's layer slider menu (IMSlider::render_add_menu / render_edit_menu)
 * for the layer shown: add a pause, a filament change, custom G-code or the
 * printer's custom template at the start of that layer, or change or delete
 * the item already there; and jump to a layer. It opens above the slider.
 */
export function LayerMenu({ layerZ, layer, onLayer, onClose }: { layerZ: Float32Array; layer: number; onLayer(layer: number): void; onClose(): void }) {
  const { t } = useTranslation();
  const codes = useLayerCodes();
  const palette = usePalette();
  const presets = useSlicer((s) => s.selection?.filaments ?? NO_COLOURS);
  const physical = presets.length || 1;
  const plateFilaments = useSlicer((s) => (s.job.kind === 'sliced' ? s.project?.plates[s.job.plate]?.filaments : undefined));
  const setLayerCodes = useSlicer((s) => s.setLayerCodes);
  const template = String(useOption('template_custom_gcode') ?? '');
  const byObject = usePlateOption('print_sequence') === 'by object';
  const here = codeAt(codes, layerZ, layer);
  const [form, setForm] = useState<Form>(null);
  const [gcode, setGcode] = useState(here?.type === 'custom' ? here.gcode : '');
  const [jumpTo, setJumpTo] = useState(String(layer + 1));
  const card = useRef<HTMLDivElement>(null);

  // Closes on a press elsewhere (but not on the slider's own button) or Escape.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!card.current?.contains(target) && !target.closest?.('.layer-add')) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  });

  const put = (code: LayerCode | null, label: string) => {
    onClose();
    void setLayerCodes(withCodeAt(codes, layerZ, layer, code), label);
  };
  const z = layerZ[layer];
  const canChange = !byObject && canChangeFilament(palette.length, plateFilaments ?? []);
  const item = (label: string, onClick: () => void, extra?: { disabled?: boolean; title?: string }) => (
    <button role="menuitem" className="menu-item" disabled={extra?.disabled} title={extra?.title} onClick={onClick}>
      {label}
    </button>
  );
  // The rows every filament picker shows: numbered square, then the preset's name.
  const filaments = (current?: number) => (
    <div className="layer-filaments" role="group" aria-label={t('layerCodes.changeFilament')}>
      {filamentChoices(palette, presets, physical).map((f, i) => (
        <button
          key={i}
          role="menuitemradio"
          aria-checked={current === i + 1}
          className="menu-item"
          data-filament={i + 1}
          disabled={!canChange || current === i + 1}
          title={canChange ? t('layerCodes.printWith', { filament: i + 1 }) : undefined}
          onClick={() => put(newCode('filament', z, { filament: i + 1, colour: f.swatch }), t('layerCodes.changeFilament'))}
        >
          <Swatch colour={f.swatch} number={f.swatchNumber} />
          {f.label}
        </button>
      ))}
    </div>
  );
  const sequenceNote = byObject ? t('layerCodes.notByObject') : undefined;

  return (
    <div
      ref={card}
      className="menu object-menu layer-menu"
      role="menu"
      aria-label={t('layerCodes.menu')}
      data-testid="layer-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="menu-title">
        {t('layerCodes.title', { layer: layer + 1, z: z.toFixed(2) })}
        {here ? ` · ${codeLabel(here)}` : ''}
      </div>
      {form === 'gcode' ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (gcode.trim()) put(newCode('custom', z, { gcode: gcode.trim() }), here ? t('layerCodes.editGcodeStep') : t('layerCodes.addGcodeStep'));
          }}
        >
          <label>
            {t('layerCodes.gcodeLabel')}
            <textarea aria-label={t('layerCodes.customGcode')} rows={4} value={gcode} autoFocus spellCheck={false} placeholder="M117 Hello" onChange={(e) => setGcode(e.target.value)} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              {t('layerCodes.back')}
            </button>
            <button type="submit" className="primary" disabled={!gcode.trim()}>
              {here ? t('layerCodes.save') : t('layerCodes.add')}
            </button>
          </div>
        </form>
      ) : form === 'jump' ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.round(Number(jumpTo));
            if (n >= 1 && n <= layerZ.length) {
              onLayer(n - 1);
              onClose();
            }
          }}
        >
          <label>
            {t('layerCodes.layerNumberRange', { last: layerZ.length })}
            <input aria-label={t('layerCodes.layerNumber')} type="number" inputMode="numeric" min={1} max={layerZ.length} value={jumpTo} autoFocus onChange={(e) => setJumpTo(e.target.value)} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              {t('layerCodes.back')}
            </button>
            <button type="submit" className="primary">
              {t('layerCodes.go')}
            </button>
          </div>
        </form>
      ) : here ? (
        <>
          {here.type === 'pause' && item(t('layerCodes.deletePause'), () => put(null, t('layerCodes.deletePause')))}
          {here.type === 'template' && item(t('layerCodes.deleteTemplate'), () => put(null, t('layerCodes.deleteTemplate')))}
          {here.type === 'colour' && item(t('layerCodes.deleteColour'), () => put(null, t('layerCodes.deleteColour')))}
          {here.type === 'custom' && (
            <>
              {item(t('layerCodes.editGcode'), () => setForm('gcode'))}
              {item(t('layerCodes.deleteGcode'), () => put(null, t('layerCodes.deleteGcode')))}
            </>
          )}
          {here.type === 'filament' && (
            <>
              <div className="menu-label">{t('layerCodes.changeFilament')}</div>
              {filaments(here.filament)}
              {item(t('layerCodes.deleteFilament'), () => put(null, t('layerCodes.deleteFilament')))}
            </>
          )}
          <hr />
          {item(t('layerCodes.jump'), () => setForm('jump'))}
        </>
      ) : (
        <>
          {item(t('layerCodes.addPause'), () => put(newCode('pause', z), t('layerCodes.addPause')), {
            disabled: byObject,
            title: sequenceNote ?? t('layerCodes.addPauseHint'),
          })}
          {item(t('layerCodes.addGcode'), () => setForm('gcode'), { disabled: byObject, title: sequenceNote ?? t('layerCodes.addGcodeHint') })}
          {template.trim() &&
            item(t('layerCodes.addTemplate'), () => put(newCode('template', z), t('layerCodes.addTemplate')), {
              disabled: byObject,
              title: sequenceNote ?? t('layerCodes.addTemplateHint'),
            })}
          {palette.length > 1 && (
            <>
              <div className="menu-label">
                {canChange
                  ? t('layerCodes.changeFilament')
                  : byObject
                    ? t('layerCodes.changeFilamentByObject')
                    : t('layerCodes.changeFilamentOneOnly')}
              </div>
              {filaments()}
            </>
          )}
          <hr />
          {item(t('layerCodes.jump'), () => setForm('jump'))}
        </>
      )}
    </div>
  );
}
