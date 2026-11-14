import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingText } from '../i18n';
import {
  defaultOrder,
  FIRST_OTHER_LAYER,
  fitOrder,
  LAYER_END,
  plateSettingsRequest,
  readPlateSettings,
  vaseDiffer,
  type LayerRange,
  type PlateSettings,
} from '../lib/plate-settings';
import { NO_COLOURS, useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { Swatch } from './Swatch';
import { Picker } from './Picker';

/**
 * Desktop's Plate settings window (PlateSettingsDialog): the shown plate's
 * name and the settings it has of its own instead of the project's. Opened
 * from the plate menu, the gear on the plate's tab, or a sidebar setting that
 * the plate changes.
 */
export function PlateSettingsDialog() {
  const open = useSlicer((s) => s.plateSettings);
  const plate = useSlicer((s) => s.plate);
  const hasPlate = useSlicer((s) => !!s.project?.plates[s.plate]);
  if (!open || !hasPlate) return null;
  return <PlateSettingsWindow key={plate} />;
}

function PlateSettingsWindow() {
  const { t } = useTranslation();
  const plate = useSlicer((s) => s.plate);
  const info = useSlicer((s) => s.project!.plates[s.plate]);
  const options = useSlicer((s) => s.options);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const baseConfig = useSlicer((s) => s.baseConfig);
  const overrides = useSlicer((s) => s.overrides);
  const project = useMemo(() => ({ ...baseConfig, ...overrides }), [baseConfig, overrides]);
  const { openPlateSettings, plateAction } = useSlicer.getState();
  const count = Math.max(1, colours.length);
  const [name, setName] = useState(info.name);
  const [draft, setDraft] = useState<PlateSettings>(() => readPlateSettings(info.settings, count));
  const change = (patch: Partial<PlateSettings>) => setDraft({ ...draft, ...patch });
  const close = () => openPlateSettings(false);

  // "Project (its value)", then the option's own choices, as the sidebar lists them.
  const choices = (key: string) => {
    const def = options[key];
    return (def?.enumValues ?? []).map((v, i) => ({ value: v, label: settingText(def?.enumLabels?.[i] ?? '') || v }));
  };
  const labelOf = (key: string, value: string | undefined) => choices(key).find((c) => c.value === value)?.label ?? value ?? '';
  const projectSpiral = project.spiral_mode === '1';
  const spiralOn = draft.spiral ?? projectSpiral;
  const wasSpiral = readPlateSettings(info.settings, count).spiral ?? projectSpiral;

  const save = () => {
    // Turning spiral vase on here sets what it needs on the plate's objects, as desktop does.
    const vase = spiralOn && !wasSpiral ? vaseDiffer(project) : undefined;
    close();
    void plateAction({ op: 'settings', name: name.trim(), settings: plateSettingsRequest(draft, count), ...(vase && { vase }) }, t('plateSettings.undo'));
  };

  const segmented = <T,>(label: string, value: T, items: { value: T; label: string }[], onPick: (v: T) => void) => (
    <div className="chooser" role="radiogroup" aria-label={label}>
      {items.map((it) => (
        <button key={String(it.value)} type="button" role="radio" aria-checked={value === it.value} className={value === it.value ? 'on' : ''} onClick={() => onPick(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );

  return (
    <Dialog
      title={t('plateSettings.title', { n: plate + 1 })}
      onClose={close}
      className="plate-settings"
      footer={
        <>
          <button className="secondary" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="primary" onClick={save}>
            {t('plateSettings.save')}
          </button>
        </>
      }
    >
      <p className="muted small">{t('plateSettings.intro')}</p>
      <label className="field">
        <span>{t('plateSettings.plateName')}</span>
        <input aria-label={t('plateSettings.plateName')} value={name} placeholder={t('plateSettings.noName')} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('plateSettings.plateType')}</span>
        <Picker
          field
          label={t('plateSettings.plateType')}
          value={draft.bedType ?? ''}
          options={[{ value: '', label: t('plateSettings.projectValue', { value: labelOf('curr_bed_type', project.curr_bed_type) }) }, ...choices('curr_bed_type').map((c) => ({ value: String(c.value), label: c.label }))]}
          onChange={(v) => change({ bedType: v || null })}
        />
      </label>
      <div className="field">
        <span>{t('plateSettings.printSequence')}</span>
        {segmented(t('plateSettings.printSequence'), draft.sequence, [{ value: null, label: t('plateSettings.project') }, ...choices('print_sequence')], (sequence) => change({ sequence }))}
        <span className="muted small">
          {draft.sequence === null ? t('plateSettings.projectPrints', { sequence: labelOf('print_sequence', project.print_sequence).toLowerCase() }) : settingText(options.print_sequence?.tooltip ?? '')}
        </span>
      </div>
      <div className="field">
        <span>{t('plateSettings.spiral')}</span>
        {segmented(
          t('plateSettings.spiral'),
          draft.spiral,
          [
            { value: null, label: projectSpiral ? t('plateSettings.projectOn') : t('plateSettings.projectOff') },
            { value: true, label: t('plateSettings.on') },
            { value: false, label: t('plateSettings.off') },
          ],
          (spiral) => change({ spiral }),
        )}
        {spiralOn && !wasSpiral && (
          <span className="muted small">{t('plateSettings.spiralNote')}</span>
        )}
      </div>
      <div className="field">
        <span>{t('plateSettings.firstLayer')}</span>
        {segmented(t('plateSettings.firstLayer'), draft.firstLayer === null, [{ value: true, label: t('plateSettings.auto') }, { value: false, label: t('plateSettings.custom') }], (auto) =>
          change({ firstLayer: auto ? null : defaultOrder(count) }),
        )}
        {draft.firstLayer && <FilamentOrder label={t('plateSettings.firstLayer')} order={draft.firstLayer} colours={colours} onChange={(firstLayer) => change({ firstLayer })} />}
      </div>
      <div className="field">
        <span>{t('plateSettings.otherLayers')}</span>
        {segmented(t('plateSettings.otherLayers'), draft.otherLayers === null, [{ value: true, label: t('plateSettings.auto') }, { value: false, label: t('plateSettings.custom') }], (auto) =>
          change({ otherLayers: auto ? null : [{ from: FIRST_OTHER_LAYER, to: LAYER_END, order: defaultOrder(count) }] }),
        )}
        {draft.otherLayers && <LayerRanges ranges={draft.otherLayers} colours={colours} count={count} onChange={(otherLayers) => change({ otherLayers: otherLayers.length ? otherLayers : null })} />}
      </div>
    </Dialog>
  );
}

/** The filaments in print order, as desktop's DragCanvas: drag one (mouse, finger or arrow keys) to its new place. */
function FilamentOrder({ label, order, colours, onChange }: { label: string; order: number[]; colours: string[]; onChange(order: number[]): void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const end = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onChange(arrayMove(order, order.indexOf(Number(active.id)), order.indexOf(Number(over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
      <SortableContext items={order} strategy={horizontalListSortingStrategy}>
        <div className="filament-order" role="list" aria-label={label}>
          {order.map((f) => (
            <OrderChip key={f} filament={f} colour={colours[f - 1]} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function OrderChip({ filament, colour }: { filament: number; colour?: string }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: filament });
  return (
    <span
      ref={setNodeRef}
      className={`order-chip${isDragging ? ' dragging' : ''}`}
      title={t('plateSettings.dragTip')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="listitem"
      aria-roledescription={t('plateSettings.draggable')}
      aria-label={t('plateSettings.filamentN', { n: filament })}
    >
      <Swatch colour={colour} number={filament} />
    </span>
  );
}

/** Desktop's OtherLayersSeqPanel: layer ranges (from layer 2), each with its filament order; "End" = the last layer. */
function LayerRanges({ ranges, colours, count, onChange }: { ranges: LayerRange[]; colours: string[]; count: number; onChange(r: LayerRange[]): void }) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<LayerRange>) => onChange(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="layer-ranges">
      {ranges.map((r, i) => (
        <div key={i} className="layer-range">
          <div className="layer-range-head">
            <span>{t('plateSettings.layer')}</span>
            <input
              aria-label={t('plateSettings.rangeFrom', { n: i + 1 })}
              inputMode="numeric"
              value={r.from}
              onChange={(e) => set(i, { from: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              onBlur={() => set(i, { from: Math.max(FIRST_OTHER_LAYER, r.from), to: Math.max(r.to, FIRST_OTHER_LAYER, r.from) })}
            />
            <span>{t('plateSettings.to')}</span>
            {r.to === LAYER_END ? (
              <button type="button" className="secondary small" title={t('plateSettings.pickLastTip')} onClick={() => set(i, { to: Math.max(r.from, FIRST_OTHER_LAYER) })}>
                {t('plateSettings.end')}
              </button>
            ) : (
              <>
                <input
                  aria-label={t('plateSettings.rangeTo', { n: i + 1 })}
                  inputMode="numeric"
                  value={r.to}
                  onChange={(e) => set(i, { to: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  onBlur={() => set(i, { to: Math.max(r.to, r.from) })}
                />
                <button type="button" className="ghost small" title={t('plateSettings.toEndTip')} onClick={() => set(i, { to: LAYER_END })}>
                  {t('plateSettings.end')}
                </button>
              </>
            )}
            <IconButton icon={X} label={t('plateSettings.removeRange')} aria-label={t('plateSettings.removeRangeN', { n: i + 1 })} onClick={() => onChange(ranges.filter((_, j) => j !== i))} />
          </div>
          <FilamentOrder label={t('plateSettings.rangeOrder', { n: i + 1 })} order={fitOrder(r.order, count)} colours={colours} onChange={(order) => set(i, { order })} />
        </div>
      ))}
      <button
        type="button"
        className="secondary small"
        onClick={() => {
          const last = ranges[ranges.length - 1];
          const from = last ? (last.to === LAYER_END ? last.from + 1 : last.to + 1) : FIRST_OTHER_LAYER;
          onChange([...ranges, { from, to: LAYER_END, order: defaultOrder(count) }]);
        }}
      >
        {t('plateSettings.addRange')}
      </button>
    </div>
  );
}
