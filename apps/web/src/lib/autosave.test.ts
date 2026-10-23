import { describe, expect, it } from 'vitest';
import type { OnlineProject } from '../account/api';
import { autosaveDelay, autosaveGap, BIG_PROJECT_BYTES, continueOffer, deviceNameFrom, goneText, QUIET_MS, yourDevice } from './autosave';

const project = (p: Partial<OnlineProject>): OnlineProject => ({
  id: 'p',
  name: 'Benchy',
  size: 1000,
  hasThumbnail: false,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  engine: 'snapmaker',
  draft: false,
  device: null,
  deviceName: null,
  ...p,
});

describe('AutoSave timing', () => {
  it('waits for a quiet moment after the last change', () => {
    // Never saved before (lastSave 0): only the quiet time counts.
    expect(autosaveDelay(1e6, 1e6, 0, 100)).toBe(QUIET_MS);
    expect(autosaveDelay(1e6 + 10_000, 1e6, 0, 100)).toBe(0);
  });
  it('saves big projects less often, on the person’s own data', () => {
    expect(autosaveGap(BIG_PROJECT_BYTES - 1)).toBe(30_000);
    expect(autosaveGap(BIG_PROJECT_BYTES)).toBe(180_000);
    // Saved 10 s ago, changed 10 s ago: a small project waits 20 s more, a big one 170 s.
    expect(autosaveDelay(100_000, 90_000, 90_000, 1000)).toBe(20_000);
    expect(autosaveDelay(100_000, 90_000, 90_000, BIG_PROJECT_BYTES * 2)).toBe(170_000);
  });
});

describe('device names', () => {
  it('names devices the way people call them', () => {
    expect(deviceNameFrom('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36')).toBe('phone');
    expect(deviceNameFrom('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131 Safari/537.36')).toBe('tablet');
    expect(deviceNameFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('phone');
    expect(deviceNameFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('iPad');
    expect(deviceNameFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
    expect(deviceNameFrom('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows computer');
    expect(deviceNameFrom('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux computer');
    expect(yourDevice('phone')).toBe('your phone');
    expect(yourDevice(null)).toBe('another device');
  });
});

describe('the Continue card', () => {
  const now = 100 * 3600_000;
  it('offers the draft first, from any device', () => {
    const offer = continueOffer([project({ id: 'a', updatedAt: now - 1000, device: 'other' }), project({ id: 'd', draft: true, device: 'me' })], 'me', now);
    expect(offer).toEqual({ kind: 'draft', project: expect.objectContaining({ id: 'd' }) });
  });
  it('offers the newest draft when devices have one each', () => {
    const list = [project({ id: 'laptop', draft: true, updatedAt: now - 60_000, device: 'laptop' }), project({ id: 'phone', draft: true, updatedAt: now - 1000, device: 'phone' })];
    expect(continueOffer(list, 'me', now)?.project.id).toBe('phone');
  });
  it('offers the newest project changed on another device in the last day', () => {
    const list = [project({ id: 'old', updatedAt: now - 2 * 3600_000, device: 'other' }), project({ id: 'new', updatedAt: now - 60_000, device: 'other', deviceName: 'phone' })];
    expect(continueOffer(list, 'me', now)?.project.id).toBe('new');
  });
  it('offers nothing when the newest change was here, or long ago', () => {
    expect(continueOffer([project({ updatedAt: now - 60_000, device: 'me' }), project({ id: 'b', updatedAt: now - 120_000, device: 'other' })], 'me', now)).toBeNull();
    expect(continueOffer([project({ updatedAt: now - 30 * 3600_000, device: 'other' })], 'me', now)).toBeNull();
    expect(continueOffer([project({ updatedAt: now - 60_000, device: null })], 'me', now)).toBeNull();
  });
  it('offers the saved project that was open here first, however long ago', () => {
    const list = [project({ id: 'mine', updatedAt: now - 30 * 24 * 3600_000, device: 'me' }), project({ id: 'd', draft: true, updatedAt: now - 1000, device: 'phone' })];
    expect(continueOffer(list, 'me', now, 'mine')).toEqual({ kind: 'here', project: expect.objectContaining({ id: 'mine' }) });
  });
  it('falls back to the usual rules when the project open here is gone or became a draft', () => {
    const list = [project({ id: 'd', draft: true, device: 'me' })];
    expect(continueOffer(list, 'me', now, 'deleted')?.kind).toBe('draft');
    expect(continueOffer(list, 'me', now, 'd')?.kind).toBe('draft');
    expect(continueOffer([], 'me', now, 'deleted')).toBeNull();
  });
});

describe('a project deleted on another device', () => {
  it('says the draft was discarded and that it is still here', () => {
    expect(goneText({ name: 'Benchy', draft: true }, null, true)).toBe(
      'Your unsaved project was discarded on another device. It’s still open here, and AutoSave keeps it as a new draft.',
    );
    expect(goneText({ name: 'Benchy', draft: false }, 'phone', false)).toBe('“Benchy” was deleted on your phone. It’s still open here, not saved.');
  });
});
