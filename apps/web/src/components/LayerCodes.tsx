import { useEffect, useRef, useState } from 'react';
import type { LayerCode } from '../engine/protocol';
import { canChangeFilament, codeAt, codeLabel, layerOf, newCode, withCodeAt } from '../lib/layerCodes';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';

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
            title={`Layer ${layer + 1}: ${codeLabel(c)}`}
            aria-label={`Layer ${layer + 1}: ${codeLabel(c)}`}
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
  const codes = useLayerCodes();
  const palette = usePalette();
  const plateFilaments = useSlicer((s) => (s.job.kind === 'sliced' ? s.project?.plates[s.job.plate]?.filaments : undefined));
  const setLayerCodes = useSlicer((s) => s.setLayerCodes);
  const template = String(useOption('template_custom_gcode') ?? '');
  const byObject = useOption('print_sequence') === 'by object';
  const here = codeAt(codes, layerZ, layer);
  const [form, setForm] = useState<Form>(null);
  const [gcode, setGcode] = useState(here?.type === 'custom' ? here.gcode : '');
  const [jumpTo, setJumpTo] = useState(String(layer + 1));
  const card = useRef<HTMLDivElement>(null);

  // Closes on a press elsewhere (but not on the slider's own button) or Escape.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!card.current?.contains(t) && !t.closest?.('.layer-add')) onClose();
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
  const filamentChoices = !byObject && canChangeFilament(palette.length, plateFilaments ?? []);
  const item = (label: string, onClick: () => void, extra?: { disabled?: boolean; title?: string }) => (
    <button role="menuitem" className="menu-item" disabled={extra?.disabled} title={extra?.title} onClick={onClick}>
      {label}
    </button>
  );
  const filaments = (current?: number) => (
    <div className="layer-filaments" role="group" aria-label="Change filament">
      {palette.map((colour, i) => (
        <button
          key={i}
          role="menuitem"
          className={`layer-filament${current === i + 1 ? ' current' : ''}`}
          disabled={!filamentChoices || current === i + 1}
          title={filamentChoices ? `Print with filament ${i + 1} from this layer on` : undefined}
          onClick={() => put(newCode('filament', z, { filament: i + 1, colour }), 'Change filament')}
        >
          <span className="menu-swatch" style={{ background: colour }} />
          {i + 1}
        </button>
      ))}
    </div>
  );
  const sequenceNote = byObject ? 'Not when printing object by object' : undefined;

  return (
    <div
      ref={card}
      className="object-menu layer-menu"
      role="menu"
      aria-label="Layer menu"
      data-testid="layer-menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="menu-title">
        Layer {layer + 1} · {z.toFixed(2)} mm{here ? ` · ${codeLabel(here)}` : ''}
      </div>
      {form === 'gcode' ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (gcode.trim()) put(newCode('custom', z, { gcode: gcode.trim() }), here ? 'Edit custom G-code' : 'Add custom G-code');
          }}
        >
          <label>
            Custom G-code run at the start of this layer
            <textarea aria-label="Custom G-code" rows={4} value={gcode} autoFocus spellCheck={false} placeholder="M117 Hello" onChange={(e) => setGcode(e.target.value)} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              Back
            </button>
            <button type="submit" className="primary" disabled={!gcode.trim()}>
              OK
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
            Layer number (1 to {layerZ.length})
            <input aria-label="Layer number" type="number" inputMode="numeric" min={1} max={layerZ.length} value={jumpTo} autoFocus onChange={(e) => setJumpTo(e.target.value)} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              Back
            </button>
            <button type="submit" className="primary">
              Go
            </button>
          </div>
        </form>
      ) : here ? (
        <>
          {here.type === 'pause' && item('Delete pause', () => put(null, 'Delete pause'))}
          {here.type === 'template' && item('Delete custom template', () => put(null, 'Delete custom template'))}
          {here.type === 'colour' && item('Delete colour change', () => put(null, 'Delete colour change'))}
          {here.type === 'custom' && (
            <>
              {item('Edit custom G-code…', () => setForm('gcode'))}
              {item('Delete custom G-code', () => put(null, 'Delete custom G-code'))}
            </>
          )}
          {here.type === 'filament' && (
            <>
              <div className="menu-label">Change filament</div>
              {filaments(here.filament)}
              {item('Delete filament change', () => put(null, 'Delete filament change'))}
            </>
          )}
          <hr />
          {item('Jump to layer…', () => setForm('jump'))}
        </>
      ) : (
        <>
          {item('Add pause', () => put(newCode('pause', z), 'Add pause'), {
            disabled: byObject,
            title: sequenceNote ?? 'The printer pauses at the start of this layer, for example to drop in a magnet or nut',
          })}
          {item('Add custom G-code…', () => setForm('gcode'), { disabled: byObject, title: sequenceNote ?? 'Your own G-code at the start of this layer' })}
          {template.trim() &&
            item('Add custom template', () => put(newCode('template', z), 'Add custom template'), {
              disabled: byObject,
              title: sequenceNote ?? "The printer's custom template G-code at the start of this layer",
            })}
          {palette.length > 1 && (
            <>
              <div className="menu-label">
                Change filament{!filamentChoices && (byObject ? ' (not when printing object by object)' : ' (only when the plate prints with one filament)')}
              </div>
              {filaments()}
            </>
          )}
          <hr />
          {item('Jump to layer…', () => setForm('jump'))}
        </>
      )}
    </div>
  );
}
