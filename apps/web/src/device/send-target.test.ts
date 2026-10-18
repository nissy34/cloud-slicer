import { describe, expect, it } from 'vitest';
import { pickSendTarget, type SavedPrinter } from '../state/device';

const printer = (id: string, preset?: string): SavedPrinter => ({ id, name: id, kind: 'direct', url: `https://${id}.example`, apiKey: '', ...(preset && { preset }) });
const U1 = 'Snapmaker U1 (0.4 nozzle)';
const J1 = 'Snapmaker J1 (0.4 nozzle)';

describe('which printer sliced G-code is sent to', () => {
  const printers = [printer('a', J1), printer('b', U1), printer('c', U1)];

  it('is the one last sent to', () => {
    expect(pickSendTarget(printers, 'a', 'c')).toBe('c');
    expect(pickSendTarget(printers, 'a', 'c', U1)).toBe('c');
  });

  it('skips the last one when another printer is set up with the sliced profile', () => {
    expect(pickSendTarget(printers, 'b', 'a', U1)).toBe('b');
    expect(pickSendTarget(printers, 'a', 'a', U1)).toBe('b');
  });

  it('falls back to the one on screen when nothing matches or was sent before', () => {
    expect(pickSendTarget(printers, 'a', null, 'Some other printer')).toBe('a');
    expect(pickSendTarget(printers, 'b', 'gone')).toBe('b');
    expect(pickSendTarget([printer('x')], null, null, U1)).toBe('x');
    expect(pickSendTarget([], null, 'a', U1)).toBeNull();
  });
});
