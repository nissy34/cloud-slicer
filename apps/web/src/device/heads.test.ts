import { describe, expect, it } from 'vitest';
import { headMood, type HeadMoodInput } from './heads';

const head = (o: Partial<HeadMoodInput>): HeadMoodInput => ({ temp: 25, target: 0, inUse: false, printing: false, loaded: true, ...o });

describe('tool head mood', () => {
  it('reads the temperatures on any printer', () => {
    expect(headMood(head({ loaded: null }))).toBe('napping');
    expect(headMood(head({ loaded: null, inUse: true }))).toBe('ready');
    expect(headMood(head({ loaded: null, temp: 120, target: 210 }))).toBe('heating');
    expect(headMood(head({ loaded: null, temp: 208, target: 210 }))).toBe('hot');
    expect(headMood(head({ loaded: null, temp: 142 }))).toBe('cooling');
    expect(headMood(head({ loaded: null, temp: 49 }))).toBe('napping');
  });

  it('prints only on the head in use', () => {
    expect(headMood(head({ inUse: true, printing: true, temp: 215, target: 215 }))).toBe('printing');
    // A docked head that is kept warm for its next turn.
    expect(headMood(head({ printing: true, temp: 170, target: 170 }))).toBe('hot');
  });

  it('asks for filament and for a look at the dock first', () => {
    expect(headMood(head({ loaded: false, inUse: true, printing: true, temp: 215, target: 215 }))).toBe('hungry');
    expect(headMood(head({ dock: 'unknown', loaded: false }))).toBe('worried');
    expect(headMood(head({ feedError: 'filament jammed' }))).toBe('worried');
  });
});
