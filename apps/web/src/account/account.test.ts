import { describe, expect, it } from 'vitest';
import { hostAllowed, safeReturnPath } from '../../functions/_lib/auth';
import { initials } from './AccountMenu';
import { mergeSetting, presetNameError, signInUrl, toOrcaPresetJson } from './api';

const ALLOWED = 'slicer.awesomestuff.qzz.io,cloud-slicer.pages.dev,*.cloud-slicer.pages.dev,localhost';
const AUTH = 'https://cloud-slicer.pages.dev';

describe('sign-in hosts', () => {
  it('allows production, pages.dev, branch previews and localhost', () => {
    expect(hostAllowed('slicer.awesomestuff.qzz.io', ALLOWED, AUTH)).toBe(true);
    expect(hostAllowed('cloud-slicer.pages.dev', ALLOWED, AUTH)).toBe(true);
    expect(hostAllowed('phase-3-accounts.cloud-slicer.pages.dev', ALLOWED, AUTH)).toBe(true);
    expect(hostAllowed('localhost:8788', ALLOWED, AUTH)).toBe(true);
  });
  it('refuses look-alikes', () => {
    expect(hostAllowed('evil-cloud-slicer.pages.dev', ALLOWED, AUTH)).toBe(false);
    expect(hostAllowed('cloud-slicer.pages.dev.evil.com', ALLOWED, AUTH)).toBe(false);
    expect(hostAllowed('other.pages.dev', ALLOWED, AUTH)).toBe(false);
  });
  it('always allows the auth host itself', () => {
    expect(hostAllowed('cloud-slicer.pages.dev', '', AUTH)).toBe(true);
  });
});

describe('return paths', () => {
  it('keeps paths on the site', () => {
    expect(safeReturnPath('/?tab=preview')).toBe('/?tab=preview');
  });
  it.each([null, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'x'])('turns %s into /', (v) => {
    expect(safeReturnPath(v)).toBe('/');
  });
});

describe('account helpers', () => {
  it('builds sign-in URLs', () => {
    expect(signInUrl('google', { returnTo: '/a?b=1', popup: true })).toBe('/api/auth/google/start?return=%2Fa%3Fb%3D1&popup=1');
    expect(signInUrl('google', { returnTo: '/', link: true })).toBe('/api/auth/google/start?return=%2F&link=1');
  });
  it('checks preset names like the server', () => {
    expect(presetNameError('My PLA @U1')).toBeNull();
    expect(presetNameError('a/b')).not.toBeNull();
    expect(presetNameError('  ')).not.toBeNull();
    expect(presetNameError('x'.repeat(129))).not.toBeNull();
  });
  it('writes Orca user preset JSON', () => {
    expect(toOrcaPresetJson({ type: 'filament', name: 'My PLA', inherits: 'Snapmaker PLA', config: { nozzle_temperature: '215' } })).toEqual({
      nozzle_temperature: '215',
      name: 'My PLA',
      inherits: 'Snapmaker PLA',
      from: 'User',
      is_custom_defined: '0',
    });
  });
  it('makes initials', () => {
    expect(initials('Alice Smith')).toBe('AS');
    expect(initials('bob')).toBe('BO');
    expect(initials('Ada Lovelace Byron')).toBe('AB');
  });
});

describe('merging this browser into the account at sign-in', () => {
  it('unions lists of names', () => {
    expect(mergeSetting(['U1'], ['U1', 'J1'])).toEqual(['U1', 'J1']);
    expect(mergeSetting(['U1'], ['U1'])).toBeUndefined();
  });
  it('unions lists inside a setup object and adds missing fields', () => {
    expect(mergeSetting({ printers: ['U1'], filaments: ['PLA'] }, { printers: ['J1'], filaments: ['PLA'], nozzle: '0.4' })).toEqual({
      printers: ['U1', 'J1'],
      filaments: ['PLA'],
      nozzle: '0.4',
    });
  });
  it("keeps the account's value otherwise", () => {
    expect(mergeSetting('dark', 'light')).toBeUndefined();
    expect(mergeSetting({ mode: 'a' }, { mode: 'b' })).toBeUndefined();
  });
});
