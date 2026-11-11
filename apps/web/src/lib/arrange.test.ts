import { describe, expect, it } from 'vitest';
import { AUTO_SPACING, DEFAULT_ARRANGE, alignYFor, arrangeRequest, cleanArrange } from './arrange';

describe('cleanArrange', () => {
  it('keeps what can be a setting', () => {
    expect(cleanArrange({ spacing: 12.5, rotate: true, multiMaterial: false, alignY: true })).toEqual({ spacing: 12.5, rotate: true, multiMaterial: false, alignY: true });
  });
  it('falls back to the defaults for the rest', () => {
    expect(cleanArrange(null)).toEqual(DEFAULT_ARRANGE);
    expect(cleanArrange({ spacing: -3, rotate: 'yes', alignY: 0 })).toEqual(DEFAULT_ARRANGE);
  });
  it('takes any spacing, even past the slider', () => {
    expect(cleanArrange({ spacing: 250 }).spacing).toBe(250);
  });
});

describe('arrangeRequest', () => {
  it('0 means auto spacing', () => {
    expect(arrangeRequest(DEFAULT_ARRANGE, undefined).spacing).toBe(AUTO_SPACING);
    expect(arrangeRequest({ ...DEFAULT_ARRANGE, spacing: 2 }, undefined).spacing).toBe(2);
  });
  it('object by object, never closer than the clearance', () => {
    expect(arrangeRequest({ ...DEFAULT_ARRANGE, spacing: 2 }, undefined, 35).spacing).toBe(35);
    expect(arrangeRequest({ ...DEFAULT_ARRANGE, spacing: 50 }, undefined, 35).spacing).toBe(50);
  });
  it('passes the options, desktop defaults first', () => {
    expect(arrangeRequest(DEFAULT_ARRANGE, 'corexy').options).toEqual({ rotate: false, alignY: false, multiMaterial: true });
  });
  it('Align to Y axis follows the printer until chosen, and is off with auto rotate', () => {
    expect(alignYFor(DEFAULT_ARRANGE, 'i3')).toBe(true);
    expect(alignYFor({ ...DEFAULT_ARRANGE, alignY: false }, 'i3')).toBe(false);
    expect(arrangeRequest({ ...DEFAULT_ARRANGE, rotate: true }, 'i3').options.alignY).toBe(false);
  });
});
