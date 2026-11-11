import { describe, expect, it } from 'vitest';
import { browserLanguage, isLanguageChoice, isRtl, resolveLanguage } from './language';

describe('language', () => {
  it('follows the first browser language the site speaks', () => {
    expect(browserLanguage(['fr-FR', 'he-IL', 'en'])).toBe('he');
    expect(browserLanguage(['en-GB', 'he'])).toBe('en');
    expect(browserLanguage(['iw'])).toBe('he');
    expect(browserLanguage(['de', 'fr'])).toBe('en');
    expect(browserLanguage([])).toBe('en');
  });
  it('a picked language wins over the browser', () => {
    expect(resolveLanguage('en', ['he'])).toBe('en');
    expect(resolveLanguage('he', ['en'])).toBe('he');
    expect(resolveLanguage('system', ['he-IL'])).toBe('he');
  });
  it('knows the choices and which run right to left', () => {
    expect(isLanguageChoice('system')).toBe(true);
    expect(isLanguageChoice('he')).toBe(true);
    expect(isLanguageChoice('xx')).toBe(false);
    expect(isRtl('he')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});
