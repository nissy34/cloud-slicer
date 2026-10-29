// The desktop sidebar's width and whether it is hidden, like desktop Orca's
// sidebar (drag its edge; "Collapse sidebar", Shift+Tab). Kept per browser:
// a convenience of this screen, not of the project or the account.
import { create } from 'zustand';

export const SIDEBAR_DEFAULT = 340;
export const SIDEBAR_MIN = 280;
export const SIDEBAR_MAX = 640;
const KEY = 'cloud-slicer:sidebar:v1';

/** A width within the limits; the 3D view keeps at least half the window. */
export const clampWidth = (w: number, windowWidth = window.innerWidth) =>
  Math.round(Math.max(SIDEBAR_MIN, Math.min(w, SIDEBAR_MAX, Math.max(SIDEBAR_MIN, windowWidth / 2))));

interface Sidebar {
  width: number;
  hidden: boolean;
  setWidth: (w: number) => void;
  toggle: () => void;
}

function load(): { width: number; hidden: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { width?: unknown; hidden?: unknown };
    return { width: typeof v.width === 'number' ? v.width : SIDEBAR_DEFAULT, hidden: v.hidden === true };
  } catch {
    return { width: SIDEBAR_DEFAULT, hidden: false };
  }
}

function keep(s: { width: number; hidden: boolean }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ width: s.width, hidden: s.hidden }));
  } catch {
    // storage unavailable: the next visit starts at the default width
  }
}

export const useSidebar = create<Sidebar>((set, get) => ({
  ...load(),
  setWidth: (w) => {
    set({ width: clampWidth(w) });
    keep(get());
  },
  toggle: () => {
    set({ hidden: !get().hidden });
    keep(get());
  },
}));
