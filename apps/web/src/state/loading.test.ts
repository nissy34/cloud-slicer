import { describe, expect, it } from 'vitest';
import { loadingState } from './loading';

const idle = { kind: 'idle' } as const;
const ready = { stage: 'setup', loaded: 0, total: 0 } as const;

describe('loadingState', () => {
  it('shows the engine download with its bytes, then its set-up stages', () => {
    expect(loadingState('starting', { stage: 'download', loaded: 5e6, total: 20e6 }, idle, null)).toEqual({
      label: 'Downloading the slicing engine',
      loaded: 5e6,
      total: 20e6,
    });
    expect(loadingState('starting', ready, idle, null)?.label).toBe('Starting the slicing engine');
    expect(loadingState('starting', { stage: 'printers', loaded: 0, total: 0 }, idle, null)?.label).toBe('Loading your printers and presets');
  });

  it('shows a project download, then the file opening', () => {
    expect(loadingState('ready', ready, idle, { name: 'Benchy', loaded: 10, total: 0 })).toEqual({ label: 'Downloading “Benchy”', loaded: 10, total: 0 });
    expect(loadingState('ready', ready, { kind: 'loading', name: 'Benchy.3mf' }, null)?.label).toBe('Opening Benchy.3mf');
    expect(loadingState('ready', ready, { kind: 'loading', name: 'Bambu', label: 'Converting to U1' }, null)?.label).toBe('Converting to U1');
  });

  it('is gone when idle, slicing, or the engine failed', () => {
    expect(loadingState('ready', ready, idle, null)).toBeNull();
    expect(loadingState('ready', ready, { kind: 'slicing', pct: 10, stage: '' }, null)).toBeNull();
    expect(loadingState('failed', ready, idle, null)).toBeNull();
  });
});
