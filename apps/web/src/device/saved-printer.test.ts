import { describe, expect, it } from 'vitest';
import type { Device } from '../account/api';
import { deviceInput, printerFromDevice, type SavedPrinter } from '../state/device';

const asDevice = (input: { id: string; name: string; url: string; apiKey: string | null; extra: Record<string, unknown> }): Device => ({
  id: input.id,
  name: input.name,
  preset: '',
  url: input.url,
  hasApiKey: Boolean(input.apiKey),
  extra: input.extra,
  version: 1,
  updatedAt: 0,
});

describe('saved printers in the account store', () => {
  it('keeps the secret out of the listed record and restores everything else', () => {
    const bridge: SavedPrinter = { id: 'b', name: 'U1', kind: 'bridge', relay: 'https://relay', bridgeId: 'abc', key: 'secret', printer: 'u1' };
    const direct: SavedPrinter = { id: 'd', name: 'Voron', kind: 'direct', url: 'https://voron.example', apiKey: 'k' };
    expect(deviceInput(bridge).apiKey).toBe('secret');
    expect(JSON.stringify(deviceInput(bridge).extra)).not.toContain('secret');
    expect(printerFromDevice(asDevice(deviceInput(bridge)))).toEqual({ ...bridge, key: '' });
    expect(printerFromDevice(asDevice(deviceInput(direct)))).toEqual({ ...direct, apiKey: '' });
  });

  it('skips account printers without connection details', () => {
    expect(printerFromDevice(asDevice({ id: 'x', name: 'Wizard printer', url: '', apiKey: null, extra: {} }))).toBeNull();
  });
});
