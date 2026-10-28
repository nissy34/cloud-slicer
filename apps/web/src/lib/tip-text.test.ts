import { describe, expect, it } from 'vitest';
import { withoutKeys } from './tip-text';

describe('withoutKeys', () => {
  it('drops the shortcut in brackets', () => {
    expect(withoutKeys('Copies of this object, as new objects (Ctrl+K)')).toBe('Copies of this object, as new objects');
    expect(withoutKeys('Delete (Del)')).toBe('Delete');
    expect(withoutKeys('Paste makes it a new object (Ctrl+C)')).toBe('Paste makes it a new object');
  });
  it('keeps other words in brackets', () => {
    expect(withoutKeys('Drop it (the lower part)')).toBe('Drop it (the lower part)');
    expect(withoutKeys('Snap to 5 mm (or hold Shift)')).toBe('Snap to 5 mm (or hold Shift)');
  });
});
