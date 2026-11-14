import { afterAll, describe, expect, it } from 'vitest';
import { loadLanguage, settingText } from '.';

describe('settingText', () => {
  afterAll(() => loadLanguage('en'));
  it('keeps English as the engine gives it', async () => {
    await loadLanguage('en');
    expect(settingText('Layer height')).toBe('Layer height');
  });
  it("shows desktop Orca's own words in its languages", async () => {
    await loadLanguage('de');
    expect(settingText('Layer height')).toBe('Schichthöhe');
    expect(settingText('Quality')).toBe('Qualität');
  });
  it('keeps the number of a numbered page, and English where Orca has no words', async () => {
    await loadLanguage('de');
    expect(settingText('Extruder 2')).toBe(`${settingText('Extruder')} 2`);
    expect(settingText('Something Orca never says')).toBe('Something Orca never says');
    expect(settingText('')).toBe('');
  });
  it('keeps setting names English in Hebrew (desktop has none)', async () => {
    await loadLanguage('he');
    expect(settingText('Layer height')).toBe('Layer height');
  });
});
