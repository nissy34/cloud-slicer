import { describe, expect, it } from 'vitest';
import { menuPosition, stlName, unitConversions } from './objectMenu';

describe('object menu', () => {
  it('offers converting from inches and meters, or back once converted', () => {
    expect(unitConversions('').map((c) => c.to)).toEqual(['fromInch', 'fromMeter']);
    expect(unitConversions('inch').map((c) => c.to)).toEqual(['toInch']);
    expect(unitConversions('meter').map((c) => c.to)).toEqual(['toMeter']);
  });

  it('names the STL after the object', () => {
    expect(stlName('3DBenchy.stl')).toBe('3DBenchy.stl');
    expect(stlName('Part: A/B')).toBe('Part_ A_B.stl');
    expect(stlName('  ')).toBe('object.stl');
  });

  it('keeps the menu on screen', () => {
    expect(menuPosition(100, 100, 200, 300, 1000, 800)).toEqual({ left: 100, top: 100 });
    expect(menuPosition(950, 700, 200, 300, 1000, 800)).toEqual({ left: 796, top: 496 });
    expect(menuPosition(-5, -5, 200, 300, 150, 200)).toEqual({ left: 4, top: 4 });
  });
});
