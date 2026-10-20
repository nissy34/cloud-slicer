// The owner's Admin page (only accounts in OWNER_EMAILS see it): who may sign
// in, how much each user may store, and how close the site is to
// Cloudflare's free limits. Server side: functions/_lib/admin.ts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, type AdminOverview, type AdminUser, type Meter } from '../account/admin-api';
import { useAccount } from '../state/account';
import { useSlicer } from '../state/store';

const STORAGE_CHOICES = [0, 50, 100, 200, 500, 1000];

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const storageLabel = (mb: number) => (mb === 0 ? 'Presets only' : mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`);

function when(t: number | null): string {
  if (!t) return 'never';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
}

export function AdminScreen() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Signed out (or not the owner): back to the slicer.
  const allowed = useAccount((s) => s.status === 'loading' || !!s.user?.owner);
  useEffect(() => {
    if (!allowed) useSlicer.getState().setTab('prepare');
  }, [allowed]);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.overview());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="device admin" data-testid="admin">
      <div className="admin-wrap">
        <header className="admin-head">
          <h1>Admin</h1>
          <button className="secondary" onClick={() => useSlicer.getState().setTab('prepare')}>
            Back to the slicer
          </button>
        </header>
        <p className="admin-intro muted">
          Only you see this page. Here you choose who may sign in and how much each person may store, and see how close the site is to Cloudflare's
          free limits. People who are allowed notice nothing.
        </p>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        {!data ? (
          !error && <p className="muted">Loading…</p>
        ) : (
          <>
            <UsageCard data={data} />
            <AccessCard data={data} busy={busy} act={act} />
            <UsersCard data={data} busy={busy} act={act} />
          </>
        )}
      </div>
    </div>
  );
}

function UsageCard({ data }: { data: AdminOverview }) {
  const u = data.usage;
  return (
    <section className="dv-card">
      <div className="dv-card-head">
        <h2>Free tier use</h2>
      </div>
      <ul className="admin-meters">
        {u.meters.map((m) => (
          <MeterRow key={m.key} m={m} />
        ))}
      </ul>
      {u.analytics === 'not-set-up' && (
        <p className="muted small">
          Today's request counts (site, relay, database) need a read-only Cloudflare token. In Cloudflare: My Profile, API Tokens, Create Token, "Read
          analytics and logs" template. Add it on GitHub as the repository secret <code>CLOUDFLARE_ANALYTICS_TOKEN</code>; the next deploy picks it up.
        </p>
      )}
      {u.analytics === 'failed' && <p className="muted small">Cloudflare didn't give today's counts: {u.analyticsError}</p>}
      <p className="muted small">Over a daily limit, that part stops until 00:00 UTC; nothing is charged on the free plan.</p>
    </section>
  );
}

function MeterRow({ m }: { m: Meter }) {
  const fmt = (n: number) => (m.unit === 'bytes' ? formatBytes(n) : n.toLocaleString());
  const share = m.limit ? Math.min(1, m.used / m.limit) : 0;
  const level = share >= 0.9 ? 'high' : share >= 0.7 ? 'mid' : 'low';
  return (
    <li className="admin-meter">
      <div className="admin-meter-top">
        <span>{m.label}</span>
        <span className="admin-meter-num">
          {fmt(m.used)}
          {m.limit ? ` of ${fmt(m.limit)}` : ''}
        </span>
      </div>
      {m.limit > 0 && (
        <div className={`admin-bar ${level}`} role="meter" aria-label={m.label} aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${Math.max(share * 100, share ? 1 : 0)}%` }} />
        </div>
      )}
      {m.note && <div className="muted small">{m.note}</div>}
    </li>
  );
}

type Act = (task: () => Promise<unknown>) => Promise<void>;

function AccessCard({ data, busy, act }: { data: AdminOverview; busy: boolean; act: Act }) {
  const s = data.settings;
  const [email, setEmail] = useState('');
  return (
    <section className="dv-card">
      <div className="dv-card-head">
        <h2>Who can sign in</h2>
      </div>
      <label className="admin-switch">
        <input type="checkbox" checked={s.inviteOnly} disabled={busy} onChange={(e) => void act(() => adminApi.saveSettings({ inviteOnly: e.target.checked }))} />
        <span>
          <strong>Invite only</strong>
          <span className="muted small">
            {s.inviteOnly
              ? 'Only people on the list can sign in. Anyone else sees "Cloud Slicer is invite only for now".'
              : 'Anyone with a Google account can sign in. Turning this on keeps everyone who already has an account.'}
          </span>
        </span>
      </label>
      <label className="admin-switch">
        <input
          type="checkbox"
          checked={s.guestRelay && !s.inviteOnly}
          disabled={busy || s.inviteOnly}
          onChange={(e) => void act(() => adminApi.saveSettings({ guestRelay: e.target.checked }))}
        />
        <span>
          <strong>Signed-out people can use bridges</strong>
          <span className="muted small">
            {s.inviteOnly
              ? 'Off while invite only is on.'
              : s.guestRelay
                ? 'Anyone with a pairing link can reach printers through the relay, one camera at a time. They have no account, so they can\u2019t be blocked.'
                : 'Only signed-in people can reach printers through the bridge. Printers reached directly never need an account.'}
          </span>
        </span>
      </label>
      <form
        className="admin-invite"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void act(() => adminApi.invite(email.trim()).then(() => setEmail('')));
        }}
      >
        <label className="admin-field">
          <span className="small muted">Add someone to the list (their Google email)</span>
          <input type="email" value={email} placeholder="name@gmail.com" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !email.trim()}>
          Add
        </button>
      </form>
      {data.invites.length > 0 && (
        <ul className="admin-invites">
          {data.invites.map((i) => (
            <li key={i.email}>
              <span>{i.email}</span>
              <span className="muted small">hasn't signed in yet</span>
              <button className="dv-link" disabled={busy} onClick={() => void act(() => adminApi.uninvite(i.email))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="admin-field">
        <span className="small muted">Online project storage for each person (unless set below)</span>
        <select value={s.storageMb} disabled={busy} onChange={(e) => void act(() => adminApi.saveSettings({ storageMb: Number(e.target.value) }))}>
          {[...new Set([...STORAGE_CHOICES, s.storageMb])].sort((a, b) => a - b).map((mb) => (
            <option key={mb} value={mb}>
              {mb === 0 ? 'Presets only: no online projects' : storageLabel(mb)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        Presets and printers always save to the account. Each account can use up to 3 bridges and watch 2 cameras at a time through a bridge.
      </p>
    </section>
  );
}

function UsersCard({ data, busy, act }: { data: AdminOverview; busy: boolean; act: Act }) {
  const [q, setQ] = useState('');
  const users = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? data.users.filter((u) => u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t)) : data.users;
  }, [data.users, q]);
  return (
    <section className="dv-card">
      <div className="dv-card-head">
        <h2>People ({data.users.length})</h2>
      </div>
      {data.users.length > 5 && <input className="admin-search" type="search" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />}
      <ul className="admin-users">
        {users.map((u) => (
          <UserRow key={u.id} u={u} defaultMb={data.settings.storageMb} inviteOnly={data.settings.inviteOnly} busy={busy} act={act} />
        ))}
      </ul>
    </section>
  );
}

function UserRow({ u, defaultMb, inviteOnly, busy, act }: { u: AdminUser; defaultMb: number; inviteOnly: boolean; busy: boolean; act: Act }) {
  const [confirming, setConfirming] = useState(false);
  const mb = u.storageMb ?? defaultMb;
  const choices = [...new Set([...STORAGE_CHOICES, mb])].sort((a, b) => a - b);
  return (
    <li className={u.blocked ? 'admin-user blocked' : 'admin-user'} data-testid="admin-user">
      <div className="admin-user-who">
        <strong>{u.name || u.email}</strong>
        {u.owner && <span className="admin-tag">You</span>}
        {u.blocked && <span className="admin-tag danger">Blocked</span>}
        {inviteOnly && !u.owner && !u.allowed && !u.blocked && <span className="admin-tag warn">Not on the list</span>}
        <div className="muted small admin-email">{u.email}</div>
      </div>
      <div className="admin-user-stats small">
        <span>Joined {when(u.createdAt)}</span>
        <span>{u.lastSeen ? `Seen ${when(u.lastSeen)}` : 'Not signed in anywhere'}</span>
        <span>
          {formatBytes(u.bytes)} in {u.projects} project{u.projects === 1 ? '' : 's'}
        </span>
        <span>
          {u.presets} preset{u.presets === 1 ? '' : 's'} · {u.printers} printer{u.printers === 1 ? '' : 's'} · {u.bridges} bridge{u.bridges === 1 ? '' : 's'}
        </span>
      </div>
      <div className="admin-user-actions">
        <select
          aria-label={`Storage for ${u.email}`}
          value={u.storageMb === null ? 'default' : String(u.storageMb)}
          disabled={busy}
          onChange={(e) => void act(() => adminApi.setStorage(u.id, e.target.value === 'default' ? null : Number(e.target.value)))}
        >
          <option value="default">Storage: default ({storageLabel(defaultMb)})</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              Storage: {storageLabel(c)}
            </option>
          ))}
        </select>
        {!u.owner && inviteOnly && !u.blocked && (
          <button className="secondary" disabled={busy} onClick={() => void act(() => adminApi.userAction(u.id, u.allowed ? 'disallow' : 'allow'))}>
            {u.allowed ? 'Remove from list' : 'Allow'}
          </button>
        )}
        {!u.owner && !confirming && (
          <button className="secondary admin-danger" disabled={busy} onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
        {!u.owner && (
          <button className={u.blocked ? 'secondary' : 'secondary admin-danger'} disabled={busy} onClick={() => void act(() => adminApi.userAction(u.id, u.blocked ? 'unblock' : 'block'))}>
            {u.blocked ? 'Unblock' : 'Block'}
          </button>
        )}
      </div>
      {confirming && (
        <div className="admin-confirm" role="alert">
          <span>
            Delete {u.name || u.email} and everything they saved ({formatBytes(u.bytes)} of projects, presets, printers, bridges)? This can't be undone.
            They can sign up again later unless the site is invite only.
          </span>
          <div className="admin-user-actions">
            <button className="secondary" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button className="primary admin-delete" disabled={busy} onClick={() => void act(() => adminApi.userAction(u.id, 'delete'))}>
              Delete for good
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
