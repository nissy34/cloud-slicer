import { describe, expect, it } from 'vitest';

// Every list to pick from is the app's Picker (components/Picker.tsx), never the
// browser's own drop-down (docs/architecture/design-system.md): it is drawn in
// the theme, the same on every phone, and filaments show their numbered square.
const CODE = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });

describe('pickers', () => {
  it('finds the code', () => {
    expect(Object.keys(CODE).length).toBeGreaterThan(50);
  });
  it('uses no browser drop-downs', () => {
    const found = Object.entries(CODE).flatMap(([file, code]) =>
      code.split('\n').flatMap((line, i) => (/<(select|option|optgroup|datalist)[\s>]/.test(line) && !/^\s*(\/\/|\*)/.test(line) ? [`${file}:${i + 1} ${line.trim()}`] : [])),
    );
    expect(found).toEqual([]);
  });
});
