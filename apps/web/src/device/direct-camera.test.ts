import { describe, expect, it } from 'vitest';
import { pictureAssembler } from './direct-camera';

describe('pictureAssembler', () => {
  it('joins pieces until the one marked last', () => {
    const add = pictureAssembler();
    expect(add(new Uint8Array([0, 1, 2]))).toBeNull();
    expect(add(new Uint8Array([0, 3]))).toBeNull();
    expect(Array.from(add(new Uint8Array([1, 4, 5]))!)).toEqual([1, 2, 3, 4, 5]);
    // The next picture starts fresh.
    expect(Array.from(add(new Uint8Array([1, 9]))!)).toEqual([9]);
  });
});
