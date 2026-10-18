import { describe, expect, it } from 'vitest';
import { DETAIL_LEVELS, simplifyBy } from './simplify';

describe('simplify', () => {
  it('asks for a detail level or a ratio, within range', () => {
    expect(simplifyBy('level', 2, 50)).toEqual({ level: 2 });
    expect(simplifyBy('level', 7, 50)).toEqual({ level: 4 });
    expect(simplifyBy('ratio', 2, 120)).toEqual({ ratio: 100 });
    expect(simplifyBy('ratio', 2, -3)).toEqual({ ratio: 0 });
    expect(DETAIL_LEVELS).toHaveLength(5);
  });
});
