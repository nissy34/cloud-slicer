import { describe, expect, it } from 'vitest';
import { addCameraCard, cameraCardOf, defaultDesktop, isPageCard, placeCamera, placePage, removeCameraCard, defaultLayout, layoutSetting, moveCard, moveOnPhone, normalizeLayout, phoneOrder, setColumns, zoneOf } from './layout';

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

describe('camera cards', () => {
  it('adds a camera card right after the main Cameras card, on desktop and on a phone with its own order', () => {
    let l = normalizeLayout({ phone: { order: ['files', 'camera'] } });
    l = addCameraCard(l, 'cam:a1');
    expect(l.cameraCards).toEqual(['cam:a1']);
    expect(l.desktop.cols[0].slice(0, 2)).toEqual(['camera', 'cam:a1']);
    expect(l.phone.order?.slice(0, 3)).toEqual(['files', 'camera', 'cam:a1']);
    expect(phoneOrder(defaultLayout().phone, false, ['cam:a1']).slice(0, 2)).toEqual(['camera', 'cam:a1']);
  });

  it('puts cameras in cards and back', () => {
    let l = addCameraCard(defaultLayout(), 'cam:a1');
    l = placeCamera(l, 'nozzle', 'cam:a1');
    expect(cameraCardOf(l, 'nozzle')).toBe('cam:a1');
    expect(cameraCardOf(l, 'case')).toBe('camera');
    l = placeCamera(l, 'nozzle', 'camera');
    expect(cameraCardOf(l, 'nozzle')).toBe('camera');
  });

  it('removing a camera card sends its cameras back to the main card', () => {
    let l = addCameraCard(defaultLayout(), 'cam:a1');
    l = placeCamera(l, 'nozzle', 'cam:a1');
    l = { ...l, desktop: { ...l.desktop, half: [...l.desktop.half, 'cam:a1'], camSizes: { 'cam:a1': 's' } } };
    l = removeCameraCard(l, 'cam:a1');
    expect(l.cameraCards).toEqual([]);
    expect(cameraCardOf(l, 'nozzle')).toBe('camera');
    expect(l.desktop.cols.flat()).not.toContain('cam:a1');
    expect(l.desktop.half).not.toContain('cam:a1');
    expect(l.desktop.camSizes).toEqual({});
  });

  it('drops camera cards and places that no longer exist, and places a saved card that has no place', () => {
    const l = normalizeLayout({
      cameraCards: ['cam:a1', 'bad id', 'cam:a1'],
      cameraHome: { nozzle: 'cam:a1', case: 'cam:gone' },
      desktop: { cols: [['camera', 'cam:gone'], ['files']], camSizes: { 'cam:a1': 'm', 'cam:gone': 's' } },
    });
    expect(l.cameraCards).toEqual(['cam:a1']);
    expect(l.cameraHome).toEqual({ nozzle: 'cam:a1' });
    expect(l.desktop.cols[0].slice(0, 2)).toEqual(['camera', 'cam:a1']);
    expect(l.desktop.cols.flat()).not.toContain('cam:gone');
    expect(l.desktop.camSizes).toEqual({ 'cam:a1': 'm' });
  });

  it('a page card shows one page: picking another sends the first back to the camera cards', () => {
    let l = addCameraCard(defaultLayout(), 'page:p1');
    l = addCameraCard(l, 'cam:a1');
    expect(isPageCard('page:p1')).toBe(true);
    expect(isPageCard('cam:a1')).toBe(false);
    l = placeCamera(l, 'nozzle', 'cam:a1');
    l = placePage(l, 'gui', 'page:p1');
    expect(cameraCardOf(l, 'gui')).toBe('page:p1');
    l = placePage(l, 'case', 'page:p1');
    expect(cameraCardOf(l, 'case')).toBe('page:p1');
    expect(cameraCardOf(l, 'gui')).toBe('camera');
    expect(cameraCardOf(l, 'nozzle')).toBe('cam:a1');
    // A page in a camera card moves to the page card.
    l = placePage(l, 'nozzle', 'page:p1');
    expect(cameraCardOf(l, 'nozzle')).toBe('page:p1');
    expect(normalizeLayout(l)).toEqual(l);
    l = removeCameraCard(l, 'page:p1');
    expect(cameraCardOf(l, 'nozzle')).toBe('camera');
  });

  it('keeps one layout per printer, under a setting key the account accepts', () => {
    expect(layoutSetting('ab12cd34')).toBe('device-layout.ab12cd34');
    expect(layoutSetting('a')).not.toBe(layoutSetting('b'));
    expect(layoutSetting('x'.repeat(64))).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
  });
});
