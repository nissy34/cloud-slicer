import { describe, expect, it } from 'vitest';
import { guessSystem } from './BridgeSetup';

describe('guessSystem', () => {
  it('reads the system from the browser', () => {
    expect(guessSystem('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36')).toBe('windows');
    expect(guessSystem('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('mac');
    expect(guessSystem('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36')).toBe('linux');
  });
  it('phones are never where the bridge runs', () => {
    expect(guessSystem('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36')).toBe('other');
    expect(guessSystem('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')).toBe('other');
  });
});
