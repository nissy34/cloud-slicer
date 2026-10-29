// The owner's Admin page (only accounts in OWNER_EMAILS see it): who may sign
// in, how much each user may store, and how close the site is to
// Cloudflare's free limits. Server side: functions/_lib/admin.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, type AdminBridge, type AdminOverview, type AdminUser, type Meter } from '../account/admin-api';
import { useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import { Card } from './Card';
import { InfoTip } from './InfoTip';
import { Note } from './Note';
import { Picker } from './Picker';

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

type Status = { state: 'idle' | 'saving' | 'saved' } | { state: 'failed'; message: string };
type Patch = (d: AdminOverview) => AdminOverview;
/** Runs a change: the page shows it at once (patch), saves it in the background, then refreshes. */
type Act = (task: () => Promise<unknown>, patch?: Patch) => void;

const patchUser =
  (id: string, f: (u: AdminUser) => AdminUser): Patch =>
  (d) => ({ ...d, users: d.users.map((u) => (u.id === id ? f(u) : u)) });

export function AdminScreen() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  // Changes save one after another, so quick taps can't overtake each other.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
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

  // After changes: fresh lists from the server, keeping the free-tier numbers (slow to fetch).
  const refresh = async () => {
    const fresh = await adminApi.quickOverview();
    setData((d) => (d ? { ...fresh, usage: d.usage } : d));
  };

  const act: Act = (task, patch) => {
    if (patch) setData((d) => (d ? patch(d) : d));
    pending.current++;
    setStatus({ state: 'saving' });
    queue.current = queue.current.then(async () => {
      let failed = '';
      try {
        await task();
      } catch (e) {
        failed = (e as Error).message;
      }
      if (--pending.current > 0 && !failed) return;
      // Last change saved (or one failed): show what the server really has.
      await refresh().catch(() => undefined);
      setStatus(failed ? { state: 'failed', message: failed } : { state: 'saved' });
    });
  };

  return (
    <div className="device admin" data-testid="admin">
      <div className="admin-wrap">
        <header className="admin-head">
          <h1>Admin</h1>
          <SaveStatus status={status} />
          <button className="secondary" onClick={() => useSlicer.getState().setTab('prepare')}>
            Back to the slicer
          </button>
        </header>
        <p className="admin-intro muted">
          Only you see this page. Changes save on their own.
          <InfoTip label="About this page">
            Here you choose who may sign in and how much each person may store, and see how close the site is to Cloudflare's free limits. People who
            are allowed notice nothing.
          </InfoTip>
        </p>
        {error && (
          <Note tone="error">
            {error}
          </Note>
        )}
        {!data ? (
          !error && <p className="muted">Loading…</p>
        ) : (
          <>
            <UsageCard data={data} />
            <AccessCard data={data} act={act} />
            <UsersCard data={data} act={act} />
            <BridgesCard bridges={data.bridges} act={act} />
          </>
        )}
      </div>
    </div>
  );
}

function SaveStatus({ status }: { status: Status }) {
  const [shown, setShown] = useState(status.state);
  // "Saved" fades after a few seconds; "Saving…" and failures stay. The header
  // stays on screen while scrolling, so this is always in view.
  useEffect(() => {
    setShown(status.state);
    if (status.state !== 'saved') return;
    const t = setTimeout(() => setShown('idle'), 3000);
    return () => clearTimeout(t);
  }, [status]);
  return (
    <span className={`admin-status ${shown}`} role="status" aria-live="polite" data-testid="admin-status">
      {shown === 'saving' && (
        <>
          <span className="admin-spinner" aria-hidden /> Saving…
        </>
      )}
      {shown === 'saved' && '✓ Saved'}
      {status.state === 'failed' && shown === 'failed' && `That change didn't save, so this shows what's saved: ${status.message}`}
    </span>
  );
}

function UsageCard({ data }: { data: AdminOverview }) {
  const u = data.usage;
  return (
    <Card title="Free tier use">
      <ul className="admin-meters">
        {u.meters.map((m) => (
          <MeterRow key={m.key} m={m} />
        ))}
      </ul>
      {u.analytics === 'not-set-up' && (
        <p className="muted small">
          Today's request counts (site, relay, database) need a read-only Cloudflare token. In Cloudflare: My Profile, API Tokens, Create Token, "Read
          analytics and logs" template. Add it on GitHub as the repository secret <code>CLOUDFLARE_ANALYTICS_TOKEN</code>; the next deploy picks it
          up.
        </p>
      )}
      {u.analytics === 'failed' && <p className="muted small">Cloudflare didn't give today's counts: {u.analyticsError}</p>}
      <p className="muted small">Over a daily limit, that part stops until 00:00 UTC; nothing is charged on the free plan.</p>
    </Card>
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
        <div
          className={`admin-bar ${level}`}
          role="meter"
          aria-label={m.label}
          aria-valuenow={Math.round(share * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${Math.max(share * 100, share ? 1 : 0)}%` }} />
        </div>
      )}
      {m.note && <div className="muted small">{m.note}</div>}
    </li>
  );
}

function AccessCard({ data, act }: { data: AdminOverview; act: Act }) {
  const s = data.settings;
  const [email, setEmail] = useState('');
  return (
    <Card title="Who can sign in">
      <label className="admin-switch">
        <input
          className="switch"
          type="checkbox"
          checked={s.inviteOnly}
          onChange={(e) => {
            const on = e.target.checked;
            act(
              () => adminApi.saveSettings({ inviteOnly: on }),
              (d) => ({
                ...d,
                settings: { ...d.settings, inviteOnly: on },
                users: on ? d.users.map((u) => ({ ...u, allowed: true })) : d.users,
              }),
            );
          }}
        />
        <span>
          <strong>Invite only</strong>
          <span className="muted small">
            {s.inviteOnly
              ? 'Only people on the list can sign in. Anyone else sees "Cloud Slicer is invite only for now".'
              : 'Anyone with a Google account can sign in. Turning this on keeps everyone who already has an account.'}
          </span>
        </span>
      </label>
      <form
        className="admin-invite"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) {
            const add = email.trim().toLowerCase();
            setEmail('');
            act(
              () => adminApi.invite(add),
              (d) => ({
                ...d,
                invites: d.invites.some((i) => i.email === add) ? d.invites : [{ email: add, addedAt: Date.now() }, ...d.invites],
              }),
            );
          }
        }}
      >
        <label className="admin-field">
          <span className="small muted">Add someone to the list (their Google email)</span>
          <input type="email" value={email} placeholder="name@gmail.com" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button className="primary" disabled={!email.trim()}>
          Add
        </button>
      </form>
      {data.invites.length > 0 && (
        <ul className="admin-invites">
          {data.invites.map((i) => (
            <li key={i.email}>
              <span>{i.email}</span>
              <span className="muted small">hasn't signed in yet</span>
              <button
                className="quiet"
                onClick={() =>
                  act(
                    () => adminApi.uninvite(i.email),
                    (d) => ({
                      ...d,
                      invites: d.invites.filter((x) => x.email !== i.email),
                    }),
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="admin-field">
        <span className="small muted">Online project storage for each person (unless set below)</span>
        <Picker
          field
          label="Online project storage for each person"
          value={String(s.storageMb)}
          options={[...new Set([...STORAGE_CHOICES, s.storageMb])]
            .sort((x, y) => x - y)
            .map((mb) => ({ value: String(mb), label: mb === 0 ? 'Presets only: no online projects' : storageLabel(mb) }))}
          onChange={(v) => {
            const mb = Number(v);
            act(
              () => adminApi.saveSettings({ storageMb: mb }),
              (d) => ({ ...d, settings: { ...d.settings, storageMb: mb } }),
            );
          }}
        />
      </label>
      <p className="muted small">
        Presets and printers always save to the account. Each account can use up to 3 bridges and watch 2 cameras at a time through a bridge.
      </p>
    </Card>
  );
}

function UsersCard({ data, act }: { data: AdminOverview; act: Act }) {
  const [q, setQ] = useState('');
  const users = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? data.users.filter((u) => u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t)) : data.users;
  }, [data.users, q]);
  return (
    <Card title={`People (${data.users.length})`}>
      {data.users.length > 5 && (
        <input className="admin-search" type="search" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <ul className="admin-users">
        {users.map((u) => (
          <UserRow key={u.id} u={u} defaultMb={data.settings.storageMb} inviteOnly={data.settings.inviteOnly} act={act} />
        ))}
      </ul>
    </Card>
  );
}

function UserRow({ u, defaultMb, inviteOnly, act }: { u: AdminUser; defaultMb: number; inviteOnly: boolean; act: Act }) {
  const [confirming, setConfirming] = useState(false);
  const mb = u.storageMb ?? defaultMb;
  const choices = [...new Set([...STORAGE_CHOICES, mb])].sort((a, b) => a - b);
  return (
    <li className={u.blocked ? 'admin-user blocked' : 'admin-user'} data-testid="admin-user">
      <div className="admin-user-who">
        <strong>{u.name || u.email}</strong>
        {u.owner && <span className="tag">You</span>}
        {u.blocked && <span className="tag danger">Blocked</span>}
        {inviteOnly && !u.owner && !u.allowed && !u.blocked && <span className="tag warn">Not on the list</span>}
        <div className="muted small admin-email">{u.email}</div>
      </div>
      <div className="admin-user-stats small">
        <span>Joined {when(u.createdAt)}</span>
        <span>{u.lastSeen ? `Seen ${when(u.lastSeen)}` : 'Not signed in anywhere'}</span>
        <span>
          {formatBytes(u.bytes)} in {u.projects} project
          {u.projects === 1 ? '' : 's'}
        </span>
        <span>
          {!u.bridgesAllowed && <span className="tag warn">No bridges</span>} {u.presets} preset{u.presets === 1 ? '' : 's'} · {u.printers}{' '}
          printer
          {u.printers === 1 ? '' : 's'} · {u.bridges} bridge
          {u.bridges === 1 ? '' : 's'}
        </span>
      </div>
      <div className="admin-user-actions">
        <Picker
          field
          label={`Storage for ${u.email}`}
          value={u.storageMb === null ? 'default' : String(u.storageMb)}
          options={[{ value: 'default', label: `Storage: default (${storageLabel(defaultMb)})` }, ...choices.map((c) => ({ value: String(c), label: `Storage: ${storageLabel(c)}` }))]}
          onChange={(v) => {
            const mb = v === 'default' ? null : Number(v);
            act(
              () => adminApi.setStorage(u.id, mb),
              patchUser(u.id, (x) => ({ ...x, storageMb: mb })),
            );
          }}
        />
        {!u.owner && (
          <Picker
            field
            label={`Bridges for ${u.email}`}
            value={u.bridgesAllowed ? 'yes' : 'no'}
            options={[
              { value: 'yes', label: 'Bridges: allowed' },
              { value: 'no', label: 'Bridges: not allowed' },
            ]}
            onChange={(v) => {
              const yes = v === 'yes';
              act(
                () => adminApi.setBridges(u.id, yes),
                patchUser(u.id, (x) => ({ ...x, bridgesAllowed: yes })),
              );
            }}
          />
        )}
        {!u.owner && inviteOnly && !u.blocked && (
          <button
            className="secondary"
            onClick={() =>
              act(
                () => adminApi.userAction(u.id, u.allowed ? 'disallow' : 'allow'),
                patchUser(u.id, (x) => ({ ...x, allowed: !u.allowed })),
              )
            }
          >
            {u.allowed ? 'Remove from list' : 'Allow'}
          </button>
        )}
        {!u.owner && !confirming && (
          <button className="secondary danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
        {!u.owner && (
          <button
            className={u.blocked ? 'secondary' : 'secondary danger'}
            onClick={() =>
              act(
                () => adminApi.userAction(u.id, u.blocked ? 'unblock' : 'block'),
                patchUser(u.id, (x) => ({ ...x, blocked: !u.blocked })),
              )
            }
          >
            {u.blocked ? 'Unblock' : 'Block'}
          </button>
        )}
      </div>
      {confirming && (
        <div className="admin-confirm" role="alert">
          <span>
            Delete {u.name || u.email} and everything they saved ({formatBytes(u.bytes)} of projects, presets, printers, bridges)? This can't be
            undone. They can sign up again later unless the site is invite only.
          </span>
          <div className="admin-user-actions">
            <button className="secondary" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button
              className="primary admin-delete"
              onClick={() =>
                act(
                  () => adminApi.userAction(u.id, 'delete'),
                  (d) => ({
                    ...d,
                    users: d.users.filter((x) => x.id !== u.id),
                  }),
                )
              }
            >
              Delete for good
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function BridgesCard({ bridges, act }: { bridges: AdminBridge[]; act: Act }) {
  return (
    <Card title={`Bridges (${bridges.length})`}>
      <p className="muted small admin-note">
        Every bridge someone reached a printer through.
        <InfoTip label="About turning a bridge off">
          Turning one off closes it for everyone at once, and the bridge app is refused until you turn it on again.
        </InfoTip>
      </p>
      {bridges.length === 0 ? (
        <p className="muted small">No bridges yet.</p>
      ) : (
        <ul className="admin-users">
          {bridges.map((b) => (
            <li key={b.id} className={b.off ? 'admin-user blocked' : 'admin-user'} data-testid="admin-bridge">
              <div className="admin-user-who">
                <strong className="admin-bridge-id">{b.id}</strong>
                {b.off && <span className="tag danger">Off</span>}
                <div className="muted small admin-email">
                  {b.people || 'nobody yet'}
                </div>
              </div>
              <div className="admin-user-stats small">
                <span>Used {when(b.lastUsed)}</span>
              </div>
              <div className="admin-user-actions">
                <button
                  className={b.off ? 'secondary' : 'secondary danger'}
                  onClick={() =>
                    act(
                      () => adminApi.bridge(b.id, b.off ? 'on' : 'off'),
                      (d) => ({
                        ...d,
                        bridges: d.bridges.map((x) => (x.id === b.id ? { ...x, off: !b.off } : x)),
                      }),
                    )
                  }
                >
                  {b.off ? 'Turn on' : 'Turn off'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
