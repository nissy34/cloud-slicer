import { describe, expect, it } from 'vitest';
import { isThemeChoice, resolveTheme } from './theme';

describe('theme', () => {
  it('follows the device for System', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('keeps an explicit choice whatever the device says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('only accepts known choices from storage or the account', () => {
    expect(isThemeChoice('dark')).toBe(true);
    expect(isThemeChoice('blue')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });
});
