import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS, DEFAULT_TEXT, clampStyle, computerFontName, fontFileName, missingLettersHint } from './fonts';

describe('fonts', () => {
  it('gives every bundled font its own name and file', () => {
    expect(new Set(BUNDLED_FONTS.map((f) => f.name)).size).toBe(BUNDLED_FONTS.length);
    expect(new Set(BUNDLED_FONTS.map((f) => f.file)).size).toBe(BUNDLED_FONTS.length);
  });
  it('keeps size and depth in desktop limits', () => {
    expect(clampStyle({ ...DEFAULT_TEXT, size: 0, depth: 5000 })).toMatchObject({ size: 0.1, depth: 1000 });
    expect(clampStyle({ ...DEFAULT_TEXT, size: Number.NaN })).toMatchObject({ size: 0.1 });
  });
  it('names computer fonts by their full name', () => {
    expect(computerFontName({ fullName: 'Arial Bold', family: 'Arial', style: 'Bold' })).toBe('Arial Bold');
    expect(computerFontName({ fullName: '', family: 'Arial', style: 'Regular' })).toBe('Arial');
    expect(computerFontName({ fullName: '', family: 'Arial', style: 'Italic' })).toBe('Arial Italic');
  });
  it('makes a safe engine file name', () => {
    expect(fontFileName('Noto Sans / Bold')).toBe('/fonts/Noto_Sans_Bold.ttf');
  });
  it('says which letters a font lacks, and a built-in font that has them', () => {
    expect(missingLettersHint('')).toBe('');
    expect(missingLettersHint('שלום')).toBe('This font has no letters for ש ל ו ם, so they are left out. Pick a Hebrew font, like Noto Sans Hebrew, Rubik, Heebo.');
    expect(missingLettersHint('漢字')).toMatch(/a font file, or one of this computer's fonts/);
  });
});
