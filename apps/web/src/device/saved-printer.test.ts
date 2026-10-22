import { describe, expect, it } from 'vitest';
import type { Device } from '../account/api';
import { bridgeFromDevice, bridgeInput, bridgeLabel, deviceInput, printerFromDevice, type SavedBridge, type SavedPrinter } from '../state/device';

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

  it('keeps the cameras the user hid', () => {
    const direct: SavedPrinter = { id: 'd', name: 'U1', kind: 'direct', url: 'https://u1.example', apiKey: '', hiddenCameras: ['usb'] };
    expect(deviceInput(direct).extra).toEqual({ kind: 'direct', hiddenCameras: ['usb'] });
    expect(printerFromDevice(asDevice(deviceInput(direct)))).toEqual(direct);
    expect(printerFromDevice(asDevice({ id: 'x', name: 'n', url: 'https://x', apiKey: null, extra: { kind: 'direct', hiddenCameras: ['a', 3] } }))?.hiddenCameras).toEqual(['a']);
  });

  it('reaches printers saved on the relay\'s first address at its own one', () => {
    const extra = { kind: 'bridge', relay: 'https://cloud-slicer-relay.nissy34.workers.dev', bridgeId: 'abc', printer: 'u1' };
    expect(printerFromDevice(asDevice({ id: 'b', name: 'U1', url: '', apiKey: null, extra }))).toMatchObject({ kind: 'bridge', relay: 'https://cloud-slicer-relay.awesomestuff.qzz.io' });
    const agent = { kind: 'bridge-agent', relay: 'https://cloud-slicer-relay-test.nissy34.workers.dev/', bridgeId: 'abc' };
    expect(bridgeFromDevice(asDevice({ id: 'x', name: 'Bridge', url: '', apiKey: null, extra: agent }))?.relay).toBe('https://cloud-slicer-relay-test.awesomestuff.qzz.io');
  });

  it('skips account printers without connection details', () => {
    expect(printerFromDevice(asDevice({ id: 'x', name: 'Wizard printer', url: '', apiKey: null, extra: {} }))).toBeNull();
  });
});

describe('saved bridges', () => {
  it('are their own records, never printers, with the key kept out of the listing', () => {
    const b: SavedBridge = { id: 'x', name: 'Bridge on NIssy-PC', relay: 'https://relay', bridgeId: 'abc', key: 'secret' };
    const d = asDevice({ ...bridgeInput(b), apiKey: b.key });
    expect(JSON.stringify(bridgeInput(b).extra)).not.toContain('secret');
    expect(bridgeFromDevice(d)).toEqual({ ...b, key: '' });
    expect(printerFromDevice(d)).toBeNull();
    expect(bridgeFromDevice(asDevice(deviceInput({ id: 'p', name: 'U1', kind: 'bridge', relay: 'r', bridgeId: 'abc', key: 'k', printer: 'u1' })))).toBeNull();
  });

  it('are named after their computer, else its system', () => {
    expect(bridgeLabel({ host: 'NIssy-PC', system: 'win32' })).toBe('Bridge on NIssy-PC');
    expect(bridgeLabel({ system: 'darwin' })).toBe('Bridge on a Mac');
    expect(bridgeLabel(null)).toBe('Bridge');
  });
});
