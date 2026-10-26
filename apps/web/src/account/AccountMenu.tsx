import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import type { PresetType, ProviderId } from './api';
import { Note } from '../components/Note';

const PROVIDER_LABEL: Record<ProviderId, string> = { google: 'Google' };
const ALL_PROVIDERS = Object.keys(PROVIDER_LABEL) as ProviderId[];
const TYPE_LABEL: Record<PresetType, [string, string]> = {
  printer: ['printer', 'printers'],
  filament: ['filament', 'filaments'],
  process: ['process', 'processes'],
};

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function presetSummary(counts: Record<PresetType, number>): string {
  const parts = (Object.keys(TYPE_LABEL) as PresetType[])
    .filter((t) => counts[t])
    .map((t) => `${counts[t]} ${TYPE_LABEL[t][counts[t] === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(', ') : 'No saved presets yet';
}

/** The top bar's Sign in button, and the account menu once signed in. */
export function AccountMenu() {
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const error = useAccount((s) => s.error);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => useAccount.getState().init(), []);
  // Close the sign-in panel once the sign-in (popup) finishes.
  const userId = user?.id;
  useEffect(() => setOpen(false), [userId]);
  // A sign-in error should be seen even if the menu was closed.
  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="account" ref={root}>
      {user ? (
        <button
          className="account-button"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={user.name}
          onClick={() => setOpen(!open)}
        >
          <span className="account-avatar" aria-hidden>
            {initials(user.name)}
          </span>
          <span className="account-name">{user.name}</span>
        </button>
      ) : (
        <button className="ghost" aria-haspopup="dialog" aria-expanded={open} disabled={status === 'loading'} onClick={() => setOpen(!open)}>
          Sign in
        </button>
      )}
      {open && (
        <div className="account-pop" role="dialog" aria-label={user ? 'Account' : 'Sign in'}>
          {user ? <SignedIn onDone={() => setOpen(false)} /> : <SignedOut />}
          {error && (
            <Note tone="error">
              {error}{' '}
              <button className="quiet" onClick={() => useAccount.getState().clearError()}>
                Dismiss
              </button>
            </Note>
          )}
        </div>
      )}
    </div>
  );
}

function usePresetCounts() {
  const presets = useAccount((s) => s.presets);
  const counts: Record<PresetType, number> = { printer: 0, filament: 0, process: 0 };
  for (const p of presets) counts[p.type]++;
  return { counts, total: presets.length };
}

function SignedOut() {
  const status = useAccount((s) => s.status);
  const providers = useAccount((s) => s.providers);
  const { total } = usePresetCounts();

  if (status === 'unavailable')
    return (
      <>
        <h3>Sign in</h3>
        <p className="account-muted">Accounts aren't set up on this site yet. Your presets are kept in this browser meanwhile.</p>
      </>
    );
  const none = !ALL_PROVIDERS.some((p) => providers[p]);
  return (
    <>
      <h3>Sign in to Cloud Slicer</h3>
      <p className="account-muted">Keep your printers, filaments and process presets, and use them on any device.</p>
      <div className="account-providers">
        {ALL_PROVIDERS.map((p) => (
          <button
            key={p}
            className="secondary account-provider"
            disabled={!providers[p]}
            title={providers[p] ? undefined : `${PROVIDER_LABEL[p]} sign-in isn't set up yet`}
            onClick={() => void useAccount.getState().signIn(p)}
          >
            Continue with {PROVIDER_LABEL[p]}
          </button>
        ))}
      </div>
      {none && <p className="account-muted">Sign-in isn't set up on this site yet.</p>}
      {total > 0 && (
        <p className="account-muted">
          {total === 1 ? 'The preset' : `The ${total} presets`} saved in this browser will move to your account.
        </p>
      )}
    </>
  );
}

function SignedIn({ onDone }: { onDone: () => void }) {
  const user = useAccount((s) => s.user)!;
  const { counts, total } = usePresetCounts();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div className="account-who">
        <span className="account-avatar large" aria-hidden>
          {initials(user.name)}
        </span>
        <div>
          <div className="account-title">{user.name}</div>
          {user.email && <div className="account-muted">{user.email}</div>}
        </div>
      </div>
      <ul className="account-list">
        {user.identities.map((i) => (
          <li key={i.provider}>
            Signed in with {PROVIDER_LABEL[i.provider]}
            {i.login ? ` as ${i.login}` : i.email ? ` as ${i.email}` : ''}
          </li>
        ))}
        <li>{presetSummary(counts)}</li>
      </ul>
      {user.owner && (
        <button
          className="secondary account-admin"
          onClick={() => {
            useSlicer.getState().setTab('admin');
            onDone();
          }}
        >
          Admin: people and limits
        </button>
      )}
      {confirming ? (
        <div className="account-confirm">
          <p>
            Delete your account{total ? ` and its ${total} saved preset${total === 1 ? '' : 's'}` : ''}? This can't be undone.
          </p>
          <div className="account-actions">
            <button className="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </button>
            <button
              className="primary danger"
              onClick={async () => {
                await useAccount.getState().deleteAccount();
                setConfirming(false);
                onDone();
              }}
            >
              Delete account
            </button>
          </div>
        </div>
      ) : (
        <div className="account-actions">
          <button className="quiet danger" onClick={() => setConfirming(true)}>
            Delete account
          </button>
          <button
            className="secondary"
            onClick={async () => {
              await useAccount.getState().signOut();
              onDone();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </>
  );
}
