import { describe, expect, it } from 'vitest';
import { decodeString, encodeString, slotEntryIndex, slotPart, slotSegment, splitStrings } from './slot-values';

describe('quoted lists', () => {
  it('splits on semicolons outside quotes and round-trips Orca escaping', () => {
    expect(splitStrings('"a;b";"c"')).toEqual(['"a;b"', '"c"']);
    const text = 'M104 S"200"\nG1 X0 ; \\ done';
    expect(decodeString(encodeString(text))).toBe(text);
    expect(encodeString('a\nb')).toBe('"a\\nb"');
  });
});

describe('slot segments', () => {
  const twoFlows = { filament_flow_step_size: '2,2', filament_flow_support: 'standard,high_flow,standard,high_flow', process_flow_support: 'standard,high_flow' };
  it('uses one entry per slot, or filament_flow_step_size segments for flow options', () => {
    expect(slotSegment(2, 1, 2, {}, false)).toEqual([1, 1]);
    expect(slotSegment(4, 1, 2, twoFlows, true)).toEqual([2, 2]);
    expect(slotSegment(3, 1, 2, {}, false)).toBeNull();
  });
  it('picks the entry of the flow variant shown, by name', () => {
    expect(slotEntryIndex('220,225,230,235', 1, 2, twoFlows, true, 0)).toBe(2);
    expect(slotEntryIndex('220,225,230,235', 1, 2, twoFlows, true, 1)).toBe(3);
    expect(slotEntryIndex('220,230', 1, 2, {}, false, 1)).toBe(1);
  });
  it('takes one slot out of a full-config value for saving its preset', () => {
    expect(slotPart('220,225,230,235', 'ints', 1, 2, twoFlows, true)).toBe('230,235');
    expect(slotPart('"G1";"G2"', 'strings', 0, 2, {}, false)).toBe('"G1"');
    expect(slotPart('0.2', 'float', 1, 2, {}, false)).toBe('0.2');
    expect(slotPart('220,230', 'ints', 0, 1, {}, false)).toBe('220,230');
  });
});
