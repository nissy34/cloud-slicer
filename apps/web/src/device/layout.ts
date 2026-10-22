// The Device tab's card layout, arranged by each person and saved in their account (see ui/Arrange.tsx).
// Desktop has zones: a band across the top, 2 or 3 columns, and a band across the bottom.
// Phones are one column, so there only the order, hidden and folded cards are kept.

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

export type CameraSize = 's' | 'm' | 'l';
export type ZoneId = 'top' | 'bottom' | `col${number}`;

export interface DesktopLayout {
  top: CardId[];
  cols: CardId[][];
  bottom: CardId[];
  /** Cards that take half a zone's width, so two sit side by side. */
  half: CardId[];
  hidden: CardId[];
  folded: CardId[];
  camera: CameraSize;
}

export interface PhoneLayout {
  /** null until the person moves a card: the order then follows the print (see phoneOrder). */
  order: CardId[] | null;
  hidden: CardId[];
  folded: CardId[];
}

export interface DeviceLayout {
  v: 1;
  desktop: DesktopLayout;
  phone: PhoneLayout;
}

export const LAYOUT_SETTING = 'device-layout';

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
  };
}

export function defaultPhone(): PhoneLayout {
  return { order: null, hidden: [], folded: [] };
}

export function defaultLayout(): DeviceLayout {
  return { v: 1, desktop: defaultDesktop(), phone: defaultPhone() };
}

/** Phone order until the person changes it: while printing the print sits under the camera, otherwise the move controls do. */
export function phoneOrder(layout: PhoneLayout, busy: boolean): CardId[] {
  if (layout.order) return layout.order;
  return busy ? ['camera', 'job', 'toolheads', 'climate', 'motion', 'alerts', 'files', 'console'] : ['camera', 'motion', 'job', 'toolheads', 'climate', 'alerts', 'files', 'console'];
}

const isCard = (x: unknown): x is CardId => typeof x === 'string' && (CARD_IDS as readonly string[]).includes(x);
const cards = (x: unknown): CardId[] => (Array.isArray(x) ? x.filter(isCard) : []);

/** Reads a saved layout, whatever shape it is in: unknown cards are dropped, each card appears once,
 *  and cards added to the app since it was saved go where the default layout has them. */
export function normalizeLayout(raw: unknown): DeviceLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DeviceLayout, unknown>>;
  return {
    v: 1,
    desktop: normalizeDesktop(r.desktop),
    phone: normalizePhone(r.phone),
  };
}

function normalizeDesktop(raw: unknown): DesktopLayout {
  if (!raw || typeof raw !== 'object') return defaultDesktop();
  const r = raw as Record<string, unknown>;
  const seen = new Set<CardId>();
  const once = (list: CardId[]) => list.filter((id) => !seen.has(id) && seen.add(id));
  const top = once(cards(r.top));
  const rawCols = Array.isArray(r.cols) ? r.cols.slice(0, 3) : [];
  while (rawCols.length < 2) rawCols.push([]);
  const cols = rawCols.map((c) => once(cards(c)));
  const bottom = once(cards(r.bottom));
  const def = defaultDesktop();
  def.cols.forEach((col, i) =>
    col.forEach((id) => {
      if (!seen.has(id)) cols[Math.min(i, cols.length - 1)].push(id);
    }),
  );
  const camera = r.camera === 's' || r.camera === 'm' || r.camera === 'l' ? r.camera : def.camera;
  return {
    top,
    cols,
    bottom,
    half: Array.isArray(r.half) ? cards(r.half) : def.half,
    hidden: cards(r.hidden),
    folded: cards(r.folded),
    camera,
  };
}

function normalizePhone(raw: unknown): PhoneLayout {
  if (!raw || typeof raw !== 'object') return defaultPhone();
  const r = raw as Record<string, unknown>;
  let order: CardId[] | null = null;
  if (Array.isArray(r.order)) {
    order = [...new Set(cards(r.order))];
    for (const id of phoneOrder(defaultPhone(), false)) if (!order.includes(id)) order.push(id);
  }
  return { order, hidden: cards(r.hidden), folded: cards(r.folded) };
}

// ---- zones ------------------------------------------------------------------------

export function zoneIds(d: DesktopLayout): ZoneId[] {
  return ['top', ...d.cols.map((_, i) => `col${i}` as ZoneId), 'bottom'];
}

export function zoneCards(d: DesktopLayout, zone: ZoneId): CardId[] {
  if (zone === 'top') return d.top;
  if (zone === 'bottom') return d.bottom;
  return d.cols[Number(zone.slice(3))] ?? [];
}

export function zoneOf(d: DesktopLayout, id: CardId): ZoneId | undefined {
  return zoneIds(d).find((z) => zoneCards(d, z).includes(id));
}

function withZone(d: DesktopLayout, zone: ZoneId, list: CardId[]): DesktopLayout {
  if (zone === 'top') return { ...d, top: list };
  if (zone === 'bottom') return { ...d, bottom: list };
  const i = Number(zone.slice(3));
  return { ...d, cols: d.cols.map((c, j) => (j === i ? list : c)) };
}

/** Moves a card to `index` in `zone` (the end when index is past it). */
export function moveCard(d: DesktopLayout, id: CardId, zone: ZoneId, index: number): DesktopLayout {
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
export function moveOnPhone(p: PhoneLayout, busy: boolean, id: CardId, index: number): PhoneLayout {
  const order = phoneOrder(p, busy).filter((c) => c !== id);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  return { ...p, order };
}

export function toggle(list: CardId[], id: CardId, on: boolean): CardId[] {
  return on ? (list.includes(id) ? list : [...list, id]) : list.filter((c) => c !== id);
}
