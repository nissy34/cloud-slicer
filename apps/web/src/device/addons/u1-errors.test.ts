import { describe, expect, it } from 'vitest';
import table from './u1-errors.json';
import { describeU1Error, u1ErrorCode, u1Errors, type Words } from './u1-errors';

const words = table as unknown as Words;

describe('U1 errors', () => {
  it('joins level, id, index and code like Snapmaker app does', () => {
    expect(u1ErrorCode({ level: 2, id: 523, index: 1, code: 0 })).toBe('0002 0523 0001 0000');
    expect(u1ErrorCode({})).toBe('0000 0000 0000 0000');
  });

  it("uses Snapmaker's words for a known code", () => {
    const e = describeU1Error({ id: 523, index: 1, code: 0, level: 2, message: 'filament runout' }, words);
    expect(e).toMatchObject({ code: '0002 0523 0001 0000', title: 'Filament Anomaly', once: false });
    expect(e?.text).toMatch(/runout detected in Toolhead 2/);
  });

  it("falls back to the printer's own message for an unknown code", () => {
    const e = describeU1Error({ id: 999, index: 0, code: 7, level: 3, message: 'Something odd' }, words);
    expect(e).toMatchObject({ title: 'Printer error', text: 'Something odd' });
    expect(describeU1Error({ id: 999, level: 3 }, words)?.text).toMatch(/Check its screen/);
    expect(describeU1Error(null, words)).toBeNull();
  });

  it('reads the query result and both notifications', async () => {
    const raw = { id: 528, index: 0, code: 0, level: 2, message: '' };
    expect((await u1Errors.read({ exceptions: [raw, raw] })).map((e) => e.title)).toEqual(['Homing Anomaly']);
    expect(await u1Errors.read({})).toEqual([]);
    expect((await u1Errors.notified('notify_exception_status', [{ exceptions: [raw] }]))?.current?.[0].code).toBe('0002 0528 0000 0000');
    expect(await u1Errors.notified('notify_exception_status', [{ exceptions: [] }])).toEqual({ current: [] });
    const once = await u1Errors.notified('notify_exception_notification', [raw]);
    expect(once?.once?.[0]).toMatchObject({ title: 'Homing Anomaly', once: true });
    expect(u1Errors.notified('notify_status_update', [{}])).toBeNull();
  });

  it('every code in the table has words', () => {
    const entries = Object.entries(words.errors);
    expect(entries.length).toBeGreaterThan(400);
    for (const [code, [title, text]] of entries) {
      expect(code).toMatch(/^\d{16}$/);
      expect(title >= 0 || text.length > 0).toBe(true);
    }
  });
});
