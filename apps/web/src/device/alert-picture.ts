// One picture from several cameras, for an alert from a printer the browser
// reaches directly: a notification shows only one picture, so two cameras sit
// side by side and three or four in a 2×2 grid, each fitted into its cell and
// named in its corner. The bridge joins them the same way (alert_picture.go).

/** Each camera's share of a joined picture. */
export const CELL_W = 640;
export const CELL_H = 480;

/** Columns and rows for `n` cameras. */
export function pictureGrid(n: number): { cols: number; rows: number } {
  return n <= 1 ? { cols: 1, rows: 1 } : n === 2 ? { cols: 2, rows: 1 } : { cols: 2, rows: 2 };
}

/** The largest rectangle with the picture's shape, centred in its cell. */
export function fitIn(w: number, h: number, cell: { x: number; y: number; w: number; h: number }) {
  if (w <= 0 || h <= 0) return cell;
  let fw = cell.w;
  let fh = Math.round((cell.w * h) / w);
  if (fh > cell.h) {
    fw = Math.round((cell.h * w) / h);
    fh = cell.h;
  }
  return { x: cell.x + Math.round((cell.w - fw) / 2), y: cell.y + Math.round((cell.h - fh) / 2), w: fw, h: fh };
}

/** Joins camera pictures into one JPEG; one picture comes back as it was. */
export async function joinPictures(pics: { name: string; blob: Blob }[]): Promise<Blob> {
  if (pics.length === 1) return pics[0].blob;
  const { cols, rows } = pictureGrid(pics.length);
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL_W;
  canvas.height = rows * CELL_H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = 'bold 22px system-ui, sans-serif';
  g.textBaseline = 'middle';
  for (const [i, p] of pics.slice(0, 4).entries()) {
    const cell = { x: (i % cols) * CELL_W, y: Math.floor(i / cols) * CELL_H, w: CELL_W, h: CELL_H };
    const img = await createImageBitmap(p.blob).catch(() => null);
    if (img) {
      const r = fitIn(img.width, img.height, cell);
      g.drawImage(img, r.x, r.y, r.w, r.h);
      img.close();
    }
    const name = p.name.slice(0, 24);
    g.fillStyle = 'rgb(0 0 0 / 60%)';
    g.fillRect(cell.x + 8, cell.y + 8, g.measureText(name).width + 16, 34);
    g.fillStyle = '#fff';
    g.fillText(name, cell.x + 16, cell.y + 25);
  }
  return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('no picture'))), 'image/jpeg', 0.8));
}
