import { describe, expect, it } from 'vitest';
import { editKey, scaledBy } from './transform';

describe('scaledBy', () => {
  it('scales all three axes together when uniform', () => {
    expect(scaledBy([1, 2, 0.5], 1, 3, true)).toEqual([1.5, 3, 0.75]);
  });
  it('changes one axis otherwise', () => {
    expect(scaledBy([1, 2, 0.5], 2, 1, false)).toEqual([1, 2, 1]);
  });
});

describe('editKey', () => {
  const press = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    editKey({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  it('maps desktop editing keys', () => {
    expect(press('Delete')).toBe('delete');
    expect(press('Backspace')).toBe('delete');
    expect(press('c', { ctrlKey: true })).toBe('copy');
    expect(press('V', { metaKey: true })).toBe('paste');
    expect(press('k', { ctrlKey: true })).toBe('clone');
    expect(press('+')).toBe('addCopy');
    expect(press('-')).toBe('removeCopy');
  });
  it('leaves other keys alone', () => {
    expect(press('c')).toBeNull();
    expect(press('k')).toBeNull();
    expect(press('z', { ctrlKey: true })).toBeNull();
    expect(press('Delete', { altKey: true })).toBeNull();
  });
});
