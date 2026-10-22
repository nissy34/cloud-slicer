import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  closestCorners,
  DndContext,
  pointerWithin,
  type CollisionDetection,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { saveUserSetting, useUserSetting } from '../../state/account';
import { useDevice } from '../../state/device';
import {
  CARD_NAMES,
  defaultDesktop,
  defaultPhone,
  LAYOUT_SETTING,
  moveCard,
  moveOnPhone,
  normalizeLayout,
  phoneOrder,
  setColumns,
  toggle,
  zoneCards,
  zoneIds,
  zoneOf,
  type CameraSize,
  type CardId,
  type DesktopLayout,
  type DeviceLayout,
  type PhoneLayout,
  type ZoneId,
} from '../layout';
import { AlertsCard } from './AlertsCard';
import { CameraCard } from './CameraCard';
import { ClimateCard } from './ClimateCard';
import { ConsoleCard } from './ConsoleCard';
import { FilesCard } from './FilesCard';
import { JobCard } from './JobCard';
import { MotionCard } from './MotionCard';
import { SlotContext } from './parts';
import { ToolheadsCard } from './ToolheadsCard';

const VIEWS: Record<CardId, () => ReactNode> = {
  camera: CameraCard,
  climate: ClimateCard,
  motion: MotionCard,
  console: ConsoleCard,
  job: JobCard,
  toolheads: ToolheadsCard,
  alerts: AlertsCard,
  files: FilesCard,
};

const PHONE = '(max-width: 760px)';

function usePhone() {
  const [phone, setPhone] = useState(() => typeof matchMedia === 'function' && matchMedia(PHONE).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia(PHONE);
    const on = () => setPhone(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return phone;
}

/** The saved layout, shown at once when changed and saved to the account behind it. */
function useLayout(): [DeviceLayout, (next: DeviceLayout) => void] {
  const saved = useUserSetting<unknown>(LAYOUT_SETTING);
  const fromAccount = useMemo(() => normalizeLayout(saved), [saved]);
  const [local, setLocal] = useState<DeviceLayout | null>(null);
  useEffect(() => setLocal(null), [saved]);
  const save = (next: DeviceLayout) => {
    setLocal(next);
    saveUserSetting(LAYOUT_SETTING, next).catch(() => useDevice.getState().setToast('Could not save the card layout. It is kept until you reload the page.', true));
  };
  return [local ?? fromAccount, save];
}

const ZONE_PREFIX = 'zone:';

/** The card under the pointer, else the zone under it (an empty band), else the nearest card (keyboard). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) return [...hits.filter((h) => !String(h.id).startsWith(ZONE_PREFIX)), ...hits.filter((h) => String(h.id).startsWith(ZONE_PREFIX))];
  return closestCorners(args);
};

export function DeviceCards({ busy, arranging, onDone }: { busy: boolean; arranging: boolean; onDone(): void }) {
  const phone = usePhone();
  const [layout, save] = useLayout();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [drag, setDrag] = useState<{
    id: CardId;
    desktop: DesktopLayout;
  } | null>(null);

  const kind = phone ? 'phone' : 'desktop';
  const screen: PhoneLayout | DesktopLayout = layout[kind];
  const setScreen = (next: Partial<PhoneLayout & DesktopLayout>) => save({ ...layout, [kind]: { ...screen, ...next } });
  const slot = (id: CardId, half = false) => (
    <Slot
      key={id}
      id={id}
      half={half && !phone}
      folded={screen.folded.includes(id)}
      hidden={screen.hidden.includes(id)}
      arranging={arranging}
      phone={phone}
      camera={!phone && id === 'camera' ? layout.desktop.camera : undefined}
      onFold={(on) => setScreen({ folded: toggle(screen.folded, id, on) })}
      onHide={(on) => setScreen({ hidden: toggle(screen.hidden, id, on) })}
      onHalf={(on) =>
        save({
          ...layout,
          desktop: {
            ...layout.desktop,
            half: toggle(layout.desktop.half, id, on),
          },
        })
      }
      onCamera={(size) => save({ ...layout, desktop: { ...layout.desktop, camera: size } })}
    />
  );
  const shown = (ids: CardId[]) => (arranging ? ids : ids.filter((id) => !screen.hidden.includes(id)));

  const bar = arranging && (
    <div className="dv-arrange-bar" data-testid="arrange-bar">
      <p className="muted">{phone ? 'Hold a card by its grip and drag it up or down.' : 'Drag a card by its grip into a column, or across the top or bottom.'} Hidden cards stay here, faded.</p>
      <div className="dv-arrange-actions">
        {!phone && (
          <div className="dv-seg" role="group" aria-label="Columns">
            <span className="muted">Columns</span>
            {([2, 3] as const).map((n) => (
              <button key={n} aria-pressed={layout.desktop.cols.length === n} onClick={() => save({ ...layout, desktop: setColumns(layout.desktop, n) })}>
                {n}
              </button>
            ))}
          </div>
        )}
        <button
          className="dv-link"
          onClick={() =>
            save({
              ...layout,
              [kind]: phone ? defaultPhone() : defaultDesktop(),
            })
          }
          data-testid="arrange-reset"
        >
          Back to default
        </button>
        <button className="primary" onClick={onDone} data-testid="arrange-done">
          Done
        </button>
      </div>
    </div>
  );

  if (phone) {
    const order = phoneOrder(layout.phone, busy);
    const end = ({ active, over }: DragEndEvent) => {
      setDrag(null);
      if (!over || active.id === over.id) return;
      save({
        ...layout,
        phone: moveOnPhone(layout.phone, busy, active.id as CardId, order.indexOf(over.id as CardId)),
      });
    };
    return (
      <>
        {bar}
        <div className={`dv-board dv-board-phone${arranging ? ' dv-arranging' : ''}`} data-testid="device-cards">
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={(e) => setDrag({ id: e.active.id as CardId, desktop: layout.desktop })}
            onDragEnd={end}
            onDragCancel={() => setDrag(null)}
          >
            <SortableContext items={order} strategy={verticalListSortingStrategy} disabled={!arranging}>
              <div className="dv-zone">{shown(order).map((id) => slot(id))}</div>
            </SortableContext>
            <DragOverlay>{drag && <DragChip id={drag.id} />}</DragOverlay>
          </DndContext>
        </div>
      </>
    );
  }

  const desktop = drag?.desktop ?? layout.desktop;
  const targetOf = (overId: string, d: DesktopLayout): { zone: ZoneId; index: number } | null => {
    if (overId.startsWith(ZONE_PREFIX)) {
      const zone = overId.slice(ZONE_PREFIX.length) as ZoneId;
      return { zone, index: zoneCards(d, zone).length };
    }
    const zone = zoneOf(d, overId as CardId);
    return zone ? { zone, index: zoneCards(d, zone).indexOf(overId as CardId) } : null;
  };
  const start = ({ active }: DragStartEvent) => setDrag({ id: active.id as CardId, desktop: layout.desktop });
  // Crossing into another zone moves the card there at once, so the zone makes room for it while dragging.
  const over = ({ active, over: o }: DragOverEvent) => {
    if (!drag || !o) return;
    const id = active.id as CardId;
    const to = targetOf(String(o.id), drag.desktop);
    if (!to || to.zone === zoneOf(drag.desktop, id)) return;
    setDrag({ id, desktop: moveCard(drag.desktop, id, to.zone, to.index) });
  };
  const end = ({ active, over: o }: DragEndEvent) => {
    if (!drag) return;
    const id = active.id as CardId;
    let next = drag.desktop;
    const to = o && targetOf(String(o.id), next);
    if (to && to.zone === zoneOf(next, id) && !String(o.id).startsWith(ZONE_PREFIX)) next = moveCard(next, id, to.zone, to.index);
    setDrag(null);
    if (JSON.stringify(next) !== JSON.stringify(layout.desktop)) save({ ...layout, desktop: next });
  };

  const zone = (z: ZoneId, label: string, band: boolean) => {
    const ids = zoneCards(desktop, z);
    if (!arranging && !shown(ids).length) return null;
    return (
      <Zone key={z} id={z} label={label} band={band} arranging={arranging} empty={!ids.length}>
        <SortableContext items={ids} strategy={rectSortingStrategy} disabled={!arranging}>
          {shown(ids).map((id) => slot(id, desktop.half.includes(id)))}
        </SortableContext>
      </Zone>
    );
  };
  return (
    <>
      {bar}
      <div className={`dv-board${arranging ? ' dv-arranging' : ''}`} data-columns={desktop.cols.length} data-testid="device-cards">
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={start} onDragOver={over} onDragEnd={end} onDragCancel={() => setDrag(null)}>
          {zone('top', 'Across the top', true)}
          <div className="dv-columns">
            {zoneIds(desktop)
              .filter((z) => z.startsWith('col'))
              .map((z, i) => zone(z, `Column ${i + 1}`, false))}
          </div>
          {zone('bottom', 'Across the bottom', true)}
          <DragOverlay>{drag && <DragChip id={drag.id} />}</DragOverlay>
        </DndContext>
      </div>
    </>
  );
}

function Zone({ id, label, band, arranging, empty, children }: { id: ZoneId; label: string; band: boolean; arranging: boolean; empty: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: ZONE_PREFIX + id,
    disabled: !arranging,
  });
  return (
    <div ref={setNodeRef} className={`dv-zone${band ? ' dv-zone-band' : ''}${isOver ? ' dv-zone-over' : ''}`} data-zone={id} aria-label={arranging ? label : undefined}>
      {arranging && empty && <p className="dv-zone-empty">{label}: drop a card here</p>}
      {children}
    </div>
  );
}

const CAMERA_SIZES: { id: CameraSize; label: string }[] = [
  { id: 's', label: 'Small' },
  { id: 'm', label: 'Medium' },
  { id: 'l', label: 'Large' },
];

function Slot(props: {
  id: CardId;
  half: boolean;
  folded: boolean;
  hidden: boolean;
  arranging: boolean;
  phone: boolean;
  camera?: CameraSize;
  onFold(on: boolean): void;
  onHide(on: boolean): void;
  onHalf(on: boolean): void;
  onCamera(size: CameraSize): void;
}) {
  const { id, half, folded, hidden, arranging, phone, camera } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !arranging });
  const View = VIEWS[id];
  const name = CARD_NAMES[id];
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const cls = ['dv-slot', half && 'dv-half', hidden && 'dv-slot-hidden', isDragging && 'dv-slot-dragging', camera && `dv-cam-${camera}`].filter(Boolean).join(' ');
  return (
    <div ref={setNodeRef} style={style} className={cls} data-card={id}>
      {arranging && (
        <div className="dv-slot-bar">
          <button ref={setActivatorNodeRef} className="dv-grip" aria-label={`Move ${name}`} {...attributes} {...listeners} data-testid={`grip-${id}`}>
            <span aria-hidden="true">⠿</span>
          </button>
          <b>{name}</b>
          <span className="dv-slot-tools">
            {!phone && (
              <button className="dv-chip" aria-pressed={half} onClick={() => props.onHalf(!half)} title="Half width: two half cards sit side by side">
                Half width
              </button>
            )}
            {camera && (
              <select value={camera} onChange={(e) => props.onCamera(e.target.value as CameraSize)} aria-label="Camera size">
                {CAMERA_SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <button className="dv-link" onClick={() => props.onHide(!hidden)} data-testid={`hide-${id}`}>
              {hidden ? 'Show' : 'Hide'}
            </button>
          </span>
        </div>
      )}
      {!(arranging && (phone || hidden)) && (
        <SlotContext.Provider value={{ folded, toggleFold: () => props.onFold(!folded) }}>
          {arranging ? (
            <div className="dv-slot-body" {...{ inert: '' }}>
              <View />
            </div>
          ) : (
            <View />
          )}
        </SlotContext.Provider>
      )}
    </div>
  );
}

function DragChip({ id }: { id: CardId }) {
  return (
    <div className="dv-drag-chip">
      <span aria-hidden="true">⠿</span> {CARD_NAMES[id]}
    </div>
  );
}
