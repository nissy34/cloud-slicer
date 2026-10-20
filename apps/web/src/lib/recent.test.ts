import { describe, expect, it } from 'vitest';
import { addRecent, RECENT_FILE_MAX_BYTES, RECENT_MAX, type RecentFile } from './recent';

const file = (name: string, openedAt: number, size = 1000): RecentFile => ({ key: `${name}|${size}|1`, name, size, lastModified: 1, openedAt });

describe('addRecent', () => {
  it('puts the newly opened file first', () => {
    const { list } = addRecent([file('a.stl', 1), file('b.stl', 2)], [file('c.3mf', 3)]);
    expect(list.map((f) => f.name)).toEqual(['c.3mf', 'a.stl', 'b.stl']);
  });

  it('moves a file opened again to the top instead of listing it twice', () => {
    const { list, dropped } = addRecent([file('a.stl', 1), file('b.stl', 2)], [file('b.stl', 5)]);
    expect(list.map((f) => f.name)).toEqual(['b.stl', 'a.stl']);
    expect(list[0].openedAt).toBe(5);
    expect(dropped).toEqual([]);
  });

  it('keeps at most RECENT_MAX files and drops the oldest', () => {
    const old = Array.from({ length: RECENT_MAX }, (_, i) => file(`f${i}.stl`, i));
    const { list, dropped } = addRecent(old, [file('new.stl', 99)]);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].name).toBe('new.stl');
    expect(dropped).toEqual([old[RECENT_MAX - 1].key]);
  });

  it("doesn't keep files that are too big", () => {
    const { list } = addRecent([], [file('huge.3mf', 1, RECENT_FILE_MAX_BYTES + 1)]);
    expect(list).toEqual([]);
  });

  it('drops older files when the total gets too big', () => {
    const big = RECENT_FILE_MAX_BYTES;
    const { list, dropped } = addRecent([file('a.3mf', 1, big), file('b.3mf', 2, big)], [file('c.3mf', 3, big)]);
    expect(list.map((f) => f.name)).toEqual(['c.3mf', 'a.3mf']);
    expect(dropped).toEqual(['b.3mf|' + big + '|1']);
  });
});
