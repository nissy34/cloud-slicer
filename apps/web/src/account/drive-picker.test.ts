import { afterEach, describe, expect, it, vi } from 'vitest';

const downloads: string[] = [];
vi.mock('./drive', () => ({
  downloadFromDrive: async (id: string, onProgress?: (loaded: number, total: number) => void) => {
    downloads.push(id);
    const bytes = new TextEncoder().encode(`file ${id}`);
    onProgress?.(bytes.byteLength, bytes.byteLength);
    return bytes.buffer;
  },
}));
const { canOpen, downloadPicked } = await import('./drive-picker');

afterEach(() => (downloads.length = 0));

describe('Open from Google Drive', () => {
  it('opens what Open from this device opens, by name (Drive calls most of them octet-stream)', () => {
    expect(canOpen('Benchy.3MF')).toBe(true);
    expect(canOpen('bracket.step')).toBe(true);
    expect(canOpen('part.stl')).toBe(true);
    expect(canOpen('notes.pdf')).toBe(false);
    expect(canOpen('stl')).toBe(false);
  });

  it('downloads only the files it can open, names the rest, and counts progress over all of them', async () => {
    const progress: [number, number][] = [];
    const { files, skipped } = await downloadPicked(
      [
        { id: 'a', name: 'a.stl', mimeType: 'application/octet-stream', sizeBytes: 6 },
        { id: 'p', name: 'notes.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
        { id: 'b', name: 'b.3mf', mimeType: 'model/3mf', sizeBytes: 6 },
      ],
      (loaded, total) => progress.push([loaded, total]),
    );
    expect(downloads).toEqual(['a', 'b']);
    expect(files.map((f) => f.name)).toEqual(['a.stl', 'b.3mf']);
    expect(files[0].type).toBe('');
    expect(files[1].type).toBe('model/3mf');
    expect(await files[1].text()).toBe('file b');
    expect(skipped).toEqual(['notes.pdf']);
    expect(progress.at(-1)).toEqual([12, 12]);
  });
});
