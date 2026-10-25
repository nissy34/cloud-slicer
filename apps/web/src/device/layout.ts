// The Device tab's card layout, arranged by each person for each printer and saved in their account (see ui/Arrange.tsx).
// Desktop has zones: a band across the top, 2 or 3 columns, and a band across the bottom.
// Phones are one column, so there only the order, hidden and folded cards are kept.
// Extra camera cards ("cam:…") each show the cameras the person put in them; the rest stay in the main
// Cameras card. Page cards ("page:…") each show one camera's own page (a camera Moonraker lists as an
// "iframe" page, such as a printer's remote screen), live and tappable; that camera leaves the camera cards.

export const CARD_IDS = ['camera', 'climate', 'motion', 'console', 'job', 'toolheads', 'alerts', 'files'] as const;
export type CardId = (typeof CARD_IDS)[number];

export const CARD_NAMES: Record<CardId, string> = {
  camera: 'Cameras',
  climate: 'Bed and chamber',
  motion: 'Move',
  console: 'Console',
  job: 'Print',
  toolheads: 'Tool heads',
  alerts: 'Alerts',
  files: 'Files',
};

/** An extra camera card, or a page card. */
export type CamCardId = `cam:${string}` | `page:${string}`;
/** Any card: a fixed one or an extra camera card. */
export type SlotId = CardId | CamCardId;
export const MAX_CAMERA_CARDS = 6;

export const isCamCard = (x: unknown): x is CamCardId => typeof x === 'string' && /^(cam|page):[a-z0-9]{1,12}$/.test(x);
export const isPageCard = (x: unknown): x is `page:${string}` => isCamCard(x) && x.startsWith('page:');

export type CameraSize = 's' | 'm' | 'l';
export type ZoneId = 'top' | 'bottom' | `col${number}`;

export interface DesktopLayout {
  top: SlotId[];
  cols: SlotId[][];
  bottom: SlotId[];
  /** Cards that take half a zone's width, so two sit side by side. */
  half: SlotId[];
  hidden: SlotId[];
  folded: SlotId[];
  /** The main Cameras card's size. */
  camera: CameraSize;
  /** Extra camera cards' sizes. */
  camSizes: Record<CamCardId, CameraSize>;
}

export interface PhoneLayout {
  /** null until the person moves a card: the order then follows the print (see phoneOrder). */
  order: SlotId[] | null;
  hidden: SlotId[];
  folded: SlotId[];
}

export interface DeviceLayout {
  v: 1;
  desktop: DesktopLayout;
  phone: PhoneLayout;
  /** Extra camera cards and page cards, on both phone and desktop. */
  cameraCards: CamCardId[];
  /** Which extra camera card or page card shows a camera, by camera name; any other camera is in the main card. */
  cameraHome: Record<string, CamCardId>;
}

/** Before layouts were per printer there was one for every printer; it is deleted once (see ui/Arrange.tsx). */
export const SHARED_LAYOUT_SETTING = 'device-layout';

/** The setting that holds one printer's layout (setting keys are at most 64 characters). */
export function layoutSetting(printerId: string): string {
  return `${SHARED_LAYOUT_SETTING}.${printerId}`.slice(0, 64);
}

/** D3: camera, then Bed and chamber beside Move, then Console on the left; the print and printer state on the right. */
export function defaultDesktop(): DesktopLayout {
  return {
    top: [],
    cols: [
      ['camera', 'climate', 'motion', 'console'],
      ['job', 'toolheads', 'alerts', 'files'],
    ],
    bottom: [],
    half: ['climate', 'motion'],
    hidden: [],
    folded: [],
    camera: 'l',
    camSizes: {},
  };
}

export function defaultPhone(): PhoneLayout {
  return { order: null, hidden: [], folded: [] };
}

export function defaultLayout(): DeviceLayout {
  return { v: 1, desktop: defaultDesktop(), phone: defaultPhone(), cameraCards: [], cameraHome: {} };
}

/** Phone order until the person changes it: while printing the print sits under the camera, otherwise the move controls do. */
export function phoneOrder(layout: PhoneLayout, busy: boolean, cameraCards: CamCardId[] = []): SlotId[] {
  if (layout.order) return layout.order;
  const order: SlotId[] = busy ? ['camera', 'job', 'toolheads', 'climate', 'motion', 'alerts', 'files', 'console'] : ['camera', 'motion', 'job', 'toolheads', 'climate', 'alerts', 'files', 'console'];
  return [order[0], ...cameraCards, ...order.slice(1)];
}

const isCard = (x: unknown): x is CardId => typeof x === 'string' && (CARD_IDS as readonly string[]).includes(x);
const slots = (x: unknown, camCards: CamCardId[]): SlotId[] => (Array.isArray(x) ? x.filter((id): id is SlotId => isCard(id) || (isCamCard(id) && camCards.includes(id))) : []);

/** Reads a saved layout, whatever shape it is in: unknown cards are dropped, each card appears once,
 *  and cards added to the app since it was saved go where the default layout has them. */
export function normalizeLayout(raw: unknown): DeviceLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DeviceLayout, unknown>>;
  const cameraCards = Array.isArray(r.cameraCards) ? [...new Set(r.cameraCards.filter(isCamCard))].slice(0, MAX_CAMERA_CARDS) : [];
  const cameraHome: Record<string, CamCardId> = {};
  if (r.cameraHome && typeof r.cameraHome === 'object') for (const [name, card] of Object.entries(r.cameraHome)) if (isCamCard(card) && cameraCards.includes(card)) cameraHome[name] = card;
  return {
    v: 1,
    desktop: normalizeDesktop(r.desktop, cameraCards),
    phone: normalizePhone(r.phone, cameraCards),
    cameraCards,
    cameraHome,
  };
}

const isSize = (x: unknown): x is CameraSize => x === 's' || x === 'm' || x === 'l';

function normalizeDesktop(raw: unknown, camCards: CamCardId[]): DesktopLayout {
  const r = (raw && typeof raw === 'object' ? raw : defaultDesktop()) as Record<string, unknown>;
  const seen = new Set<SlotId>();
  const once = (list: SlotId[]) => list.filter((id) => !seen.has(id) && seen.add(id));
  const top = once(slots(r.top, camCards));
  const rawCols = Array.isArray(r.cols) ? r.cols.slice(0, 3) : [];
  while (rawCols.length < 2) rawCols.push([]);
  const cols = rawCols.map((c) => once(slots(c, camCards)));
  const bottom = once(slots(r.bottom, camCards));
  const def = defaultDesktop();
  def.cols.forEach((col, i) =>
    col.forEach((id) => {
      if (!seen.has(id) && seen.add(id)) cols[Math.min(i, cols.length - 1)].push(id);
    }),
  );
  // An extra camera card that has no place yet goes right after the main Cameras card.
  for (const id of camCards) if (!seen.has(id)) insertAfterCamera({ top, cols, bottom }, id);
  const camSizes: Record<CamCardId, CameraSize> = {};
  if (r.camSizes && typeof r.camSizes === 'object') for (const [id, size] of Object.entries(r.camSizes)) if (isCamCard(id) && camCards.includes(id) && isSize(size)) camSizes[id] = size;
  return {
    top,
    cols,
    bottom,
    half: Array.isArray(r.half) ? slots(r.half, camCards) : def.half,
    hidden: slots(r.hidden, camCards),
    folded: slots(r.folded, camCards),
    camera: isSize(r.camera) ? r.camera : def.camera,
    camSizes,
  };
}

function insertAfterCamera(d: Pick<DesktopLayout, 'top' | 'cols' | 'bottom'>, id: SlotId) {
  const list = [d.top, ...d.cols, d.bottom].find((l) => l.includes('camera')) ?? d.cols[0];
  list.splice(list.indexOf('camera') + 1, 0, id);
}

function normalizePhone(raw: unknown, camCards: CamCardId[]): PhoneLayout {
  if (!raw || typeof raw !== 'object') return defaultPhone();
  const r = raw as Record<string, unknown>;
  let order: SlotId[] | null = null;
  if (Array.isArray(r.order)) {
    order = [...new Set(slots(r.order, camCards))];
    for (const id of phoneOrder(defaultPhone(), false)) if (!order.includes(id)) order.push(id);
    for (const id of camCards) if (!order.includes(id)) order.splice(order.indexOf('camera') + 1, 0, id);
  }
  return { order, hidden: slots(r.hidden, camCards), folded: slots(r.folded, camCards) };
}

// ---- camera cards -----------------------------------------------------------------

/** Adds an empty camera card (or page card) right after the main Cameras card, on phone and desktop. */
export function addCameraCard(l: DeviceLayout, id: CamCardId): DeviceLayout {
  if (l.cameraCards.length >= MAX_CAMERA_CARDS || l.cameraCards.includes(id)) return l;
  const desktop = { ...l.desktop, top: [...l.desktop.top], cols: l.desktop.cols.map((c) => [...c]), bottom: [...l.desktop.bottom] };
  insertAfterCamera(desktop, id);
  let phone = l.phone;
  if (phone.order) {
    const order = [...phone.order];
    order.splice(order.indexOf('camera') + 1, 0, id);
    phone = { ...phone, order };
  }
  return { ...l, desktop, phone, cameraCards: [...l.cameraCards, id] };
}

/** Removes a camera card; its cameras go back to the main Cameras card. */
export function removeCameraCard(l: DeviceLayout, id: CamCardId): DeviceLayout {
  const drop = (list: SlotId[]) => list.filter((c) => c !== id);
  const { [id]: _size, ...camSizes } = l.desktop.camSizes;
  void _size;
  return {
    ...l,
    desktop: {
      ...l.desktop,
      top: drop(l.desktop.top),
      cols: l.desktop.cols.map(drop),
      bottom: drop(l.desktop.bottom),
      half: drop(l.desktop.half),
      hidden: drop(l.desktop.hidden),
      folded: drop(l.desktop.folded),
      camSizes,
    },
    phone: { order: l.phone.order && drop(l.phone.order), hidden: drop(l.phone.hidden), folded: drop(l.phone.folded) },
    cameraCards: l.cameraCards.filter((c) => c !== id),
    cameraHome: Object.fromEntries(Object.entries(l.cameraHome).filter(([, c]) => c !== id)),
  };
}

/** Puts a camera in a card: an extra camera card, or the main Cameras card ('camera'). */
export function placeCamera(l: DeviceLayout, name: string, card: 'camera' | CamCardId): DeviceLayout {
  const cameraHome = { ...l.cameraHome };
  if (card === 'camera') delete cameraHome[name];
  else cameraHome[name] = card;
  return { ...l, cameraHome };
}

/** Shows a page in a page card; the page it showed before goes back to the main Cameras card. */
export function placePage(l: DeviceLayout, name: string, card: CamCardId): DeviceLayout {
  const cameraHome = Object.fromEntries(Object.entries(l.cameraHome).filter(([n, c]) => c !== card && n !== name));
  return { ...l, cameraHome: { ...cameraHome, [name]: card } };
}

/** The card a camera shows in. */
export function cameraCardOf(l: Pick<DeviceLayout, 'cameraHome'>, name: string): 'camera' | CamCardId {
  return l.cameraHome[name] ?? 'camera';
}

// ---- zones ------------------------------------------------------------------------

export function zoneIds(d: DesktopLayout): ZoneId[] {
  return ['top', ...d.cols.map((_, i) => `col${i}` as ZoneId), 'bottom'];
}

export function zoneCards(d: DesktopLayout, zone: ZoneId): SlotId[] {
  if (zone === 'top') return d.top;
  if (zone === 'bottom') return d.bottom;
  return d.cols[Number(zone.slice(3))] ?? [];
}

export function zoneOf(d: DesktopLayout, id: SlotId): ZoneId | undefined {
  return zoneIds(d).find((z) => zoneCards(d, z).includes(id));
}

function withZone(d: DesktopLayout, zone: ZoneId, list: SlotId[]): DesktopLayout {
  if (zone === 'top') return { ...d, top: list };
  if (zone === 'bottom') return { ...d, bottom: list };
  const i = Number(zone.slice(3));
  return { ...d, cols: d.cols.map((c, j) => (j === i ? list : c)) };
}

/** Moves a card to `index` in `zone` (the end when index is past it). */
export function moveCard(d: DesktopLayout, id: SlotId, zone: ZoneId, index: number): DesktopLayout {
  const from = zoneOf(d, id);
  if (!from) return d;
  let next = withZone(
    d,
    from,
    zoneCards(d, from).filter((c) => c !== id),
  );
  const target = zoneCards(next, zone).slice();
  target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  next = withZone(next, zone, target);
  return next;
}

/** 2 or 3 columns. Going back to 2 puts the third column's cards under the second's. */
export function setColumns(d: DesktopLayout, count: 2 | 3): DesktopLayout {
  if (d.cols.length === count) return d;
  if (count === 3) return { ...d, cols: [...d.cols, []] };
  return { ...d, cols: [d.cols[0], [...d.cols[1], ...d.cols.slice(2).flat()]] };
}

/** Phone: moves a card to `index` in the one column. */
export function moveOnPhone(p: PhoneLayout, busy: boolean, id: SlotId, index: number, cameraCards: CamCardId[] = []): PhoneLayout {
  const order = phoneOrder(p, busy, cameraCards).filter((c) => c !== id);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  return { ...p, order };
}

export function toggle<T extends string>(list: T[], id: T, on: boolean): T[] {
  return on ? (list.includes(id) ? list : [...list, id]) : list.filter((c) => c !== id);
}
