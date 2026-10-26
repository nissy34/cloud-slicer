import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
import { accountReady, deleteUserSetting, getUserSetting, saveUserSetting, useUserSetting } from '../../state/account';
import { useDevice, type SavedPrinter } from '../../state/device';
import { takesCommands } from '../addons';
import {
  addCameraCard,
  CARD_NAMES,
  defaultDesktop,
  isCamCard,
  isPageCard,
  MAX_CAMERA_CARDS,
  placeCamera,
  placePage,
  removeCameraCard,
  defaultPhone,
  layoutSetting,
  SHARED_LAYOUT_SETTING,
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
  type CamCardId,
  type CardId,
  type DesktopLayout,
  type DeviceLayout,
  type PhoneLayout,
  type SlotId,
  type ZoneId,
} from '../layout';
import { AlertsCard } from './AlertsCard';
import { CameraCard } from './CameraCard';
import { ClimateCard } from './ClimateCard';
import { ConsoleCard } from './ConsoleCard';
import { FilesCard } from './FilesCard';
import { JobCard } from './JobCard';
import { MotionCard } from './MotionCard';
import { PageCard } from './PrinterPage';
import { SlotContext } from './parts';
import { ToolheadsCard } from './ToolheadsCard';
import { PHONE } from '../../lib/breakpoints';

const VIEWS: Record<Exclude<CardId, 'camera'>, () => ReactNode> = {
  climate: ClimateCard,
  motion: MotionCard,
  console: ConsoleCard,
  job: JobCard,
  toolheads: ToolheadsCard,
  alerts: AlertsCard,
  files: FilesCard,
};


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

/** The old layout shared by every printer is dropped once: each printer now starts from the default. */
let droppedShared = false;
function dropShared() {
  if (droppedShared) return;
  droppedShared = true;
  void accountReady()
    .then(() => (getUserSetting(SHARED_LAYOUT_SETTING) === undefined ? undefined : deleteUserSetting(SHARED_LAYOUT_SETTING)))
    .catch(() => {
      droppedShared = false;
    });
}

/** This printer's saved layout, shown at once when changed and saved to the account behind it. Saves go one
 *  at a time, and the account's copy only replaces what is shown once none are left on their way: otherwise
 *  the answer to an earlier save (a card folded) would briefly undo a quick later change (unfolded). */
function useLayout(printerId: string): [DeviceLayout, (next: DeviceLayout) => void] {
  const key = layoutSetting(printerId);
  const saved = useUserSetting<unknown>(key);
  const fromAccount = useMemo(() => normalizeLayout(saved), [saved]);
  const [local, setLocal] = useState<DeviceLayout | null>(null);
  const pending = useRef(0);
  const queue = useRef(Promise.resolve());
  useEffect(dropShared, []);
  useEffect(() => {
    if (!pending.current) setLocal(null);
  }, [saved]);
  const save = (raw: DeviceLayout) => {
    const next = normalizeLayout(raw);
    setLocal(next);
    pending.current++;
    queue.current = queue.current
      .then(() => saveUserSetting(key, next))
      .catch(() => useDevice.getState().setToast('Could not save the card layout. It is kept until you reload the page.', true))
      .finally(() => {
        pending.current--;
      });
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

export function DeviceCards({ printer, busy, arranging }: { printer: SavedPrinter; busy: boolean; arranging: boolean }) {
  const phone = usePhone();
  const [layout, save] = useLayout(printer.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [drag, setDrag] = useState<{
    id: SlotId;
    desktop: DesktopLayout;
  } | null>(null);

  const kind = phone ? 'phone' : 'desktop';
  const screen: PhoneLayout | DesktopLayout = layout[kind];
  const setScreen = (next: Partial<PhoneLayout & DesktopLayout>) => save({ ...layout, [kind]: { ...screen, ...next } });
  const nameOf = (id: SlotId) =>
    isPageCard(id)
      ? `Page card ${layout.cameraCards.filter(isPageCard).indexOf(id) + 1}`
      : isCamCard(id)
        ? `Camera card ${layout.cameraCards.filter((c) => !isPageCard(c)).indexOf(id) + 2}`
        : CARD_NAMES[id];
  const view = (id: SlotId) =>
    isPageCard(id) ? (
      <PageCard card={id} home={layout.cameraHome} onPick={(name) => save(placePage(layout, name, id))} />
    ) : id === 'camera' || isCamCard(id) ? (
      <CameraCard card={id} home={layout.cameraHome} onPlace={(name, card) => save(placeCamera(layout, name, card))} />
    ) : (
      (() => {
        const View = VIEWS[id];
        return <View />;
      })()
    );
  const camSize = (id: SlotId) => (phone ? undefined : id === 'camera' ? layout.desktop.camera : isCamCard(id) ? (layout.desktop.camSizes[id] ?? 'l') : undefined);
  const slot = (id: SlotId, half = false) => (
    <Slot
      key={id}
      id={id}
      name={nameOf(id)}
      view={view(id)}
      half={half && !phone}
      folded={screen.folded.includes(id)}
      hidden={screen.hidden.includes(id)}
      arranging={arranging}
      phone={phone}
      camera={camSize(id)}
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
      onCamera={(size) => save({ ...layout, desktop: id === 'camera' ? { ...layout.desktop, camera: size } : { ...layout.desktop, camSizes: { ...layout.desktop.camSizes, [id]: size } } })}
      onRemove={isCamCard(id) ? () => save(removeCameraCard(layout, id)) : undefined}
    />
  );
  // Cards that only send commands are left out for printers that take none (Prusa through PrusaLink),
  // and camera cards for printers whose camera can't be reached.
  const commands = useDevice((s) => takesCommands(s.addons));
  const camera = useDevice((s) => !s.addons.some((a) => a.noCamera));
  const usable = (id: SlotId) => (commands || (id !== 'motion' && id !== 'console')) && (camera || (id !== 'camera' && !isCamCard(id)));
  const shown = (ids: SlotId[]) => (arranging ? ids : ids.filter((id) => !screen.hidden.includes(id))).filter(usable);

  const bar = arranging && (
    <div className="dv-arrange-bar" data-testid="arrange-bar">
      <p>
        <strong>Arranging cards for {printer.name}.</strong>{' '}
        <span className="muted">
          {phone ? 'Hold a card by its grip and drag it up or down.' : 'Drag a card by its grip into a column, or across the top or bottom.'} Hidden cards stay here, faded. Other printers keep their own layout.
        </span>
      </p>
      <div className="dv-arrange-actions">
        {!phone && (
          <div className="dv-columns-pick">
            <span className="muted">Columns</span>
            <div className="chooser" role="group" aria-label="Columns">
              {([2, 3] as const).map((n) => (
                <button key={n} aria-pressed={layout.desktop.cols.length === n} onClick={() => save({ ...layout, desktop: setColumns(layout.desktop, n) })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        {layout.cameraCards.length < MAX_CAMERA_CARDS && (
          <button className="quiet" onClick={() => save(addCameraCard(layout, `cam:${Math.random().toString(36).slice(2, 8)}` as CamCardId))} data-testid="add-camera-card">
            Add a camera card
          </button>
        )}
        {layout.cameraCards.length < MAX_CAMERA_CARDS && (
          <button className="quiet" onClick={() => save(addCameraCard(layout, `page:${Math.random().toString(36).slice(2, 8)}` as CamCardId))} data-testid="add-page-card">
            Add a page card
          </button>
        )}
        <button
          className="quiet"
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
      </div>
    </div>
  );

  if (phone) {
    const order = phoneOrder(layout.phone, busy, layout.cameraCards);
    const end = ({ active, over }: DragEndEvent) => {
      setDrag(null);
      if (!over || active.id === over.id) return;
      save({
        ...layout,
        phone: moveOnPhone(layout.phone, busy, active.id as SlotId, order.indexOf(over.id as SlotId), layout.cameraCards),
      });
    };
    return (
      <>
        {bar}
        <div className={`dv-board dv-board-phone${arranging ? ' dv-arranging' : ''}`} data-testid="device-cards">
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={(e) => setDrag({ id: e.active.id as SlotId, desktop: layout.desktop })}
            onDragEnd={end}
            onDragCancel={() => setDrag(null)}
          >
            <SortableContext items={order} strategy={verticalListSortingStrategy} disabled={!arranging}>
              <div className="dv-zone">{shown(order).map((id) => slot(id))}</div>
            </SortableContext>
            <DragOverlay>{drag && <DragChip name={nameOf(drag.id)} />}</DragOverlay>
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
    const zone = zoneOf(d, overId as SlotId);
    return zone ? { zone, index: zoneCards(d, zone).indexOf(overId as SlotId) } : null;
  };
  const start = ({ active }: DragStartEvent) => setDrag({ id: active.id as SlotId, desktop: layout.desktop });
  // Crossing into another zone moves the card there at once, so the zone makes room for it while dragging.
  const over = ({ active, over: o }: DragOverEvent) => {
    if (!drag || !o) return;
    const id = active.id as SlotId;
    const to = targetOf(String(o.id), drag.desktop);
    if (!to || to.zone === zoneOf(drag.desktop, id)) return;
    setDrag({ id, desktop: moveCard(drag.desktop, id, to.zone, to.index) });
  };
  const end = ({ active, over: o }: DragEndEvent) => {
    if (!drag) return;
    const id = active.id as SlotId;
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
          <DragOverlay>{drag && <DragChip name={nameOf(drag.id)} />}</DragOverlay>
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
  id: SlotId;
  name: string;
  view: ReactNode;
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
  onRemove?(): void;
}) {
  const { id, name, half, folded, hidden, arranging, phone, camera } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !arranging });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const cls = ['dv-slot', half && 'dv-half', hidden && 'dv-slot-hidden', folded && 'dv-slot-folded', isDragging && 'dv-slot-dragging', camera && `dv-cam-${camera}`].filter(Boolean).join(' ');
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
              <label className="switch-row" title="Half width: two half cards sit side by side">
                <input className="switch" type="checkbox" checked={half} onChange={(e) => props.onHalf(e.target.checked)} />
                Half width
              </label>
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
            <button className="quiet" onClick={() => props.onHide(!hidden)} data-testid={`hide-${id}`}>
              {hidden ? 'Show' : 'Hide'}
            </button>
            {props.onRemove && (
              <button className="quiet danger" onClick={props.onRemove} data-testid={`remove-${id}`}>
                Remove
              </button>
            )}
          </span>
        </div>
      )}
      {!(arranging && (phone || hidden)) && (
        <SlotContext.Provider value={{ folded, toggleFold: () => props.onFold(!folded) }}>
          {arranging ? (
            <div className="dv-slot-body" {...{ inert: '' }}>
              {props.view}
            </div>
          ) : (
            props.view
          )}
        </SlotContext.Provider>
      )}
    </div>
  );
}

function DragChip({ name }: { name: string }) {
  return (
    <div className="dv-drag-chip">
      <span aria-hidden="true">⠿</span> {name}
    </div>
  );
}
