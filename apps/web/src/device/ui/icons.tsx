/** Line icons for the Device tab, drawn in the text colour. */
const PATHS = {
  load: 'M12 4v13m-5-5 5 5 5-5M5 20h14',
  unload: 'M12 20V7m-5 5 5-5 5 5M5 4h14',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  nozzle: 'M7 4h10v7H7zM9 11h6l-2 6h-2zM12 19v2',
  pickUp: 'M12 3v10M7 8l5 5 5-5M6 15h12v6H6z',
  park: 'M12 21V11M7 16l5-5 5 5M6 3h12v6H6z',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  failed: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 9l6 6m0-6-6 6',
  paused: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM10 8v8m4-8v8',
  error: 'M12 3 2 20h20zM12 10v4m0 3v.5',
  started: 'M8 5v14l11-7z',
  layer: 'M12 4 3 9l9 5 9-5zM3 14l9 5 9-5',
  progress: 'M7 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM17 14.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM18 6 6 18',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2',
  almost: 'M5 21V4h11l-2 4 2 4H5',
  finished: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8 12.5l3 3 5-6',
  resumed: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
  cooled: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9',
  camera: 'M3 7h18v13H3zM15.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM9 7l1.5-3h3L15 7',
  offline: 'M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M3 3l18 18',
  ok: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8 12.5l3 3 5-6',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 11v6m0-9.5v.5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="dv-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
