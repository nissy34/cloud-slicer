import { describe, expect, it, vi } from 'vitest';
import type { UserSetting } from '../account/api';

// Each account save waits until the test answers it.
const replies: { key: string; value: unknown; ok: (s: UserSetting) => void; fail: (e: Error) => void }[] = [];
vi.mock('../account/api', async (orig) => {
  const real = await orig<typeof import('../account/api')>();
  const saveSetting = (key: string, value: unknown) => new Promise<UserSetting>((ok, fail) => replies.push({ key, value, ok, fail }));
  return { ...real, api: { ...real.api, saveSetting } };
});

describe('saveUserSetting signed in', () => {
  it("shows the choice at once, keeps the newest when replies come back out of order, and goes back when the save fails", async () => {
    vi.stubGlobal('location', { hash: '', pathname: '/', search: '' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const { saveUserSetting, getUserSetting, useAccount } = await import('./account');
    useAccount.setState({ status: 'signedIn', settings: {} });
    const reply = (value: unknown, version: number) => ({ key: 'level', value, version, updatedAt: version });

    const first = saveUserSetting('level', 'advanced');
    expect(getUserSetting('level')).toBe('advanced');
    const second = saveUserSetting('level', 'expert');
    expect(getUserSetting('level')).toBe('expert');
    replies[1].ok(reply('expert', 2));
    replies[0].ok(reply('advanced', 1));
    await Promise.all([first, second]);
    expect(useAccount.getState().settings.level).toEqual(reply('expert', 2));

    const failed = saveUserSetting('level', 'simple');
    expect(getUserSetting('level')).toBe('simple');
    replies[2].fail(new Error('offline'));
    await expect(failed).rejects.toThrow('offline');
    expect(getUserSetting('level')).toBe('expert');
  });
});
