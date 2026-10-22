import { describe, expect, it } from 'vitest';
import { defaultDesktop, defaultLayout, moveCard, moveOnPhone, normalizeLayout, phoneOrder, setColumns, zoneOf } from './layout';

describe('device layout', () => {
  it('starts as the D3 layout', () => {
    const d = defaultLayout().desktop;
    expect(d.cols).toEqual([
      ['camera', 'climate', 'motion', 'console'],
      ['job', 'toolheads', 'alerts', 'files'],
    ]);
    expect(d.half).toEqual(['climate', 'motion']);
    expect(d.top).toEqual([]);
  });

  it('reads anything saved: junk gives the default', () => {
    expect(normalizeLayout(null)).toEqual(defaultLayout());
    expect(normalizeLayout('x')).toEqual(defaultLayout());
    expect(normalizeLayout({ desktop: 5, phone: [] })).toEqual(defaultLayout());
  });

  it('drops unknown and repeated cards, and adds cards it did not know about where D3 has them', () => {
    const l = normalizeLayout({
      desktop: {
        top: ['camera', 'robot'],
        cols: [['camera', 'motion'], ['files']],
        bottom: ['job'],
        half: [],
        hidden: ['console'],
      },
    });
    expect(l.desktop.top).toEqual(['camera']);
    expect(l.desktop.cols[0]).toEqual(['motion', 'climate', 'console']);
    expect(l.desktop.cols[1]).toEqual(['files', 'toolheads', 'alerts']);
    expect(l.desktop.bottom).toEqual(['job']);
    expect(l.desktop.half).toEqual([]);
    expect(l.desktop.hidden).toEqual(['console']);
    const all = [...l.desktop.top, ...l.desktop.cols.flat(), ...l.desktop.bottom];
    expect(all.sort()).toEqual(['alerts', 'camera', 'climate', 'console', 'files', 'job', 'motion', 'toolheads']);
  });

  it('keeps a third column and never more', () => {
    const l = normalizeLayout({
      desktop: { cols: [['camera'], ['job'], ['files'], ['alerts']] },
    });
    expect(l.desktop.cols).toHaveLength(3);
    expect(l.desktop.cols[2]).toContain('files');
    expect(zoneOf(l.desktop, 'alerts')).toBe('col1');
  });

  it('moves a card across zones', () => {
    let d = moveCard(defaultDesktop(), 'camera', 'top', 0);
    expect(d.top).toEqual(['camera']);
    expect(d.cols[0]).toEqual(['climate', 'motion', 'console']);
    d = moveCard(d, 'files', 'col0', 1);
    expect(d.cols[0]).toEqual(['climate', 'files', 'motion', 'console']);
    expect(d.cols[1]).toEqual(['job', 'toolheads', 'alerts']);
    d = moveCard(d, 'job', 'col1', 99);
    expect(d.cols[1]).toEqual(['toolheads', 'alerts', 'job']);
  });

  it('switches between 2 and 3 columns without losing cards', () => {
    let d = setColumns(defaultDesktop(), 3);
    expect(d.cols).toHaveLength(3);
    d = moveCard(d, 'files', 'col2', 0);
    d = setColumns(d, 2);
    expect(d.cols).toHaveLength(2);
    expect(d.cols[1]).toEqual(['job', 'toolheads', 'alerts', 'files']);
  });

  it('phone order follows the print until the person moves a card', () => {
    const p = defaultLayout().phone;
    expect(phoneOrder(p, false).slice(0, 2)).toEqual(['camera', 'motion']);
    expect(phoneOrder(p, true).slice(0, 2)).toEqual(['camera', 'job']);
    const moved = moveOnPhone(p, true, 'files', 0);
    expect(phoneOrder(moved, false)[0]).toBe('files');
    expect(phoneOrder(moved, false)).toHaveLength(8);
  });

  it('a saved phone order gains new cards at the end', () => {
    const l = normalizeLayout({ phone: { order: ['files', 'camera'] } });
    expect(l.phone.order?.slice(0, 2)).toEqual(['files', 'camera']);
    expect(l.phone.order).toHaveLength(8);
  });
});
