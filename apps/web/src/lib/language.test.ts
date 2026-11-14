import { describe, expect, it } from 'vitest';
import { isLanguageChoice, isRtl, useLanguageStore } from './language';

describe('language', () => {
  it('starts in English, whatever the browser says', () => {
    expect(useLanguageStore.getState().choice).toBe('en');
  });
  it('knows the choices and which run right to left', () => {
    expect(isLanguageChoice('en')).toBe(true);
    expect(isLanguageChoice('he')).toBe(true);
    expect(isLanguageChoice('system')).toBe(false);
    expect(isLanguageChoice('xx')).toBe(false);
    expect(isRtl('he')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(isLanguageChoice('pt-BR')).toBe(true);
    expect(isRtl('de')).toBe(false);
  });
});
