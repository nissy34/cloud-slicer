import { describe, expect, it } from 'vitest';
import { toolbarShift } from './toolbar-follow';

describe('toolbarShift', () => {
  it('stays put while the whole view shows', () => {
    expect(toolbarShift(0, 400)).toBe(0);
    expect(toolbarShift(-20, 400)).toBe(0);
  });
  it('follows the scroll while part of the view shows', () => {
    expect(toolbarShift(150, 400)).toBe(150);
  });
  it('stops at the bottom of the view, so it scrolls away with it', () => {
    expect(toolbarShift(600, 400)).toBe(400);
    expect(toolbarShift(600, -10)).toBe(0);
  });
});
