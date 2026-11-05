import { describe, expect, it } from 'vitest';
import { endNotice, slicingTitle } from './backgroundSlice';

describe('background slicing', () => {
  it('puts the progress first in the tab title', () => {
    expect(slicingTitle(41.6, 'Cloud Slicer')).toBe('42% · Slicing · Cloud Slicer');
    expect(slicingTitle(-3, 'X')).toBe('0% · Slicing · X');
    expect(slicingTitle(130, 'X')).toBe('100% · Slicing · X');
  });

  it('names the plate only when there is more than one', () => {
    expect(endNotice({ kind: 'done', plate: 2 }, 4)).toEqual({ title: 'Slicing done', body: 'Plate 3 is sliced. Tap to see it.' });
    expect(endNotice({ kind: 'done', plate: 0 }, 1)).toEqual({ title: 'Slicing done', body: 'Tap to see it.' });
  });

  it('shows the first line of a failure, kept short', () => {
    expect(endNotice({ kind: 'failed', message: 'Nothing to print.\nmore detail' }, 1).body).toBe('Nothing to print.');
    expect(endNotice({ kind: 'failed', message: 'x'.repeat(300) }, 1).body).toHaveLength(140);
    expect(endNotice({ kind: 'failed', message: '' }, 1).body).toBe('Tap to see why.');
    expect(endNotice({ kind: 'question' }, 1).title).toBe('Slicing needs you');
  });
});
