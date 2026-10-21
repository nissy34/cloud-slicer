/** "#RRGGBB[AA]" -> [r, g, b] in 0..1; unknown -> light grey. */
export function rgb(colour: string | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(colour ?? '');
  if (!m) return [0.8, 0.8, 0.8];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** "#RRGGBBAA" (Bambu Studio writes filament colours with alpha) -> "#RRGGBB"; others unchanged. */
export function solidColour(colour: string): string {
  return /^#[0-9a-f]{8}$/i.test(colour) ? colour.slice(0, 7) : colour;
}

/** Width and depth of an Orca printable_area value ("0x0,270x0,270x270,0x270"). */
export function bedSize(area: string | undefined): { x0: number; y0: number; w: number; d: number } {
  const pts = String(area || '0x0,270x0,270x270,0x270')
    .split(',')
    .map((p) => p.split('x').map(Number));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0, d: Math.max(...ys) - y0 };
}
