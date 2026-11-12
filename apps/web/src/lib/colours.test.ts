import { describe, expect, it } from 'vitest';
import { BUILT_IN_COLOURS, colourName, MAX_RECENT, parseHex, toHex6, withRecent } from './colours';

describe('colours', () => {
  it('has desktop Orca’s 24 colours, all distinct #RRGGBB', () => {
    expect(BUILT_IN_COLOURS).toHaveLength(24);
    expect(new Set(BUILT_IN_COLOURS.map((c) => c.hex)).size).toBe(24);
    for (const c of BUILT_IN_COLOURS) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('reads hex codes as typed', () => {
    expect(parseHex('40a040')).toBe('#40A040');
    expect(parseHex(' #4a4 ')).toBe('#44AA44');
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('red')).toBeNull();
    expect(toHex6('#11223344')).toBe('#112233');
    expect(toHex6(undefined)).toBe('#FFFFFF');
  });

  it('names built-in colours, else shows the code', () => {
    expect(colourName('#f72323')).toBe('Red');
    expect(colourName('#123456')).toBe('#123456');
  });

  it('keeps your own colours newest first, without built-ins or repeats', () => {
    let list: string[] = [];
    list = withRecent(list, '#123456');
    list = withRecent(list, '#FFFFFF');
    list = withRecent(list, '#abcdef');
    list = withRecent(list, '#123456');
    expect(list).toEqual(['#123456', '#ABCDEF']);
    for (let i = 0; i < 20; i++) list = withRecent(list, `#0000${(i + 16).toString(16)}`);
    expect(list).toHaveLength(MAX_RECENT);
  });
});
