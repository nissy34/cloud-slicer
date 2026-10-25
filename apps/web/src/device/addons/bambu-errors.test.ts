import { describe, expect, it } from 'vitest';
import { bambuErrors, describeBambuErrors, type BambuWords } from './bambu-errors';
import words from './bambu-errors.json';

const w = words as unknown as BambuWords;

describe('Bambu Lab errors', () => {
  it('joins a health message the way Bambu does and finds its words', () => {
    // attr's last byte is left out, as in Bambu's apps.
    const [e] = describeBambuErrors({ hms: [{ attr: 0x030001ff, code: 0x00010007 }] }, w);
    expect(e).toMatchObject({ id: '0300010000010007', code: '0300_0100_0001_0007', title: 'Motion system problem', once: false });
    expect(e.text).toBe('The heatbed temperature is abnormal; the sensor may have an open circuit.');
  });

  it("puts the stopped print's error first, then the health messages", () => {
    const list = describeBambuErrors({ print_error: 0x03008008, hms: [{ attr: 0x07002000, code: 0x00020001 }] }, w);
    expect(list.map((e) => e.code)).toEqual(['0300_8008', '0700_2000_0002_0001']);
    expect(list[0].text).toBe('Nozzle temperature malfunction');
    expect(list[1].title).toBe('AMS problem');
  });

  it('keeps an unknown code with a pointer to the screen, and skips junk', () => {
    const list = describeBambuErrors({ print_error: 0, hms: [{ attr: 0x99000000, code: 1 }, { attr: 'x', code: 1 }, null, { attr: 1 }] }, w);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: '9900_0000_0000_0001', title: 'Printer problem' });
    expect(list[0].text).toMatch(/Check its screen/);
    expect(describeBambuErrors(undefined, w)).toEqual([]);
  });

  it('reads them from the report the session has, and says when they changed', async () => {
    const o = { bambu: { print_error: 0, hms: [], mc_percent: 5 } };
    expect(await bambuErrors.read(o)).toEqual([]);
    const later = { bambu: { ...o.bambu, mc_percent: 6 } };
    expect(bambuErrors.key(later)).toBe(bambuErrors.key(o));
    const failed = { bambu: { ...o.bambu, print_error: 0x03008008 } };
    expect(bambuErrors.key(failed)).not.toBe(bambuErrors.key(o));
    expect((await bambuErrors.read(failed))[0].code).toBe('0300_8008');
  });

  it('has the codes from every printer family OrcaSlicer ships', () => {
    expect(Object.keys(w.hms).length).toBeGreaterThan(4000);
    expect(Object.keys(w.error).length).toBeGreaterThan(500);
    for (const code of [...Object.keys(w.hms), ...Object.keys(w.error)]) expect(code).toMatch(/^([0-9A-F]{8}|[0-9A-F]{16})$/);
  });
});
