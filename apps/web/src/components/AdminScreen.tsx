// The owner's Admin page (only accounts in OWNER_EMAILS see it): who may sign
// in, who may save projects online (in their own Google Drive), and how close the site is to
// Cloudflare's free limits. Server side: functions/_lib/admin.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { adminApi, bridgeCount, NO_LIMIT, type AdminBridge, type AdminOverview, type AdminUser, type Meter } from '../account/admin-api';
import { useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import { Card } from './Card';
import { InfoTip } from './InfoTip';
import { Note } from './Note';
import { Picker } from './Picker';

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function when(at: number | null): string {
  if (!at) return i18n.t('adminPage.never');
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return i18n.t('adminPage.today');
  if (days === 1) return i18n.t('adminPage.yesterday');
  if (days < 60) return i18n.t('adminPage.daysAgo', { count: days });
  return new Date(at).toLocaleDateString(i18n.language);
}

type Status = { state: 'idle' | 'saving' | 'saved' } | { state: 'failed'; message: string };
type Patch = (d: AdminOverview) => AdminOverview;
/** Runs a change: the page shows it at once (patch), saves it in the background, then refreshes. */
type Act = (task: () => Promise<unknown>, patch?: Patch) => void;

const patchUser =
  (id: string, f: (u: AdminUser) => AdminUser): Patch =>
  (d) => ({ ...d, users: d.users.map((u) => (u.id === id ? f(u) : u)) });

export function AdminScreen() {
  const { t } = useTranslation();
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
          <h1>{t('adminPage.title')}</h1>
          <SaveStatus status={status} />
          <button className="secondary" onClick={() => useSlicer.getState().setTab('prepare')}>
            {t('adminPage.back')}
          </button>
        </header>
        <p className="admin-intro muted">
          {t('adminPage.intro')}
          <InfoTip label={t('adminPage.aboutPage')}>{t('adminPage.aboutPageText')}</InfoTip>
        </p>
        {error && (
          <Note tone="error">
            {error}
          </Note>
        )}
        {!data ? (
          !error && <p className="muted">{t('adminPage.loading')}</p>
        ) : (
          <>
            <UsageCard data={data} />
            <AccessCard data={data} act={act} />
            <UsersCard data={data} act={act} />
            <BridgesCard data={data} act={act} />
          </>
        )}
      </div>
    </div>
  );
}

function SaveStatus({ status }: { status: Status }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(status.state);
  // "Saved" fades after a few seconds; "Saving…" and failures stay. The header
  // stays on screen while scrolling, so this is always in view.
  useEffect(() => {
    setShown(status.state);
    if (status.state !== 'saved') return;
    const timer = setTimeout(() => setShown('idle'), 3000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <span className={`admin-status ${shown}`} role="status" aria-live="polite" data-testid="admin-status">
      {shown === 'saving' && (
        <>
          <span className="admin-spinner" aria-hidden /> {t('adminPage.saving')}
        </>
      )}
      {shown === 'saved' && `✓ ${t('adminPage.saved')}`}
      {status.state === 'failed' && shown === 'failed' && t('adminPage.saveFailed', { error: status.message })}
    </span>
  );
}

function UsageCard({ data }: { data: AdminOverview }) {
  const { t } = useTranslation();
  const u = data.usage;
  return (
    <Card title={t('adminPage.usage')}>
      <ul className="admin-meters">
        {u.meters.map((m) => (
          <MeterRow key={m.key} m={m} />
        ))}
      </ul>
      {u.analytics === 'not-set-up' && (
        <p className="muted small">
          {t('adminPage.tokenNeeded')} <code>CLOUDFLARE_ANALYTICS_TOKEN</code>
          {t('adminPage.tokenNeededEnd')}
        </p>
      )}
      {u.analytics === 'failed' && <p className="muted small">{t('adminPage.analyticsFailed', { error: u.analyticsError })}</p>}
      <p className="muted small">{t('adminPage.overLimit')}</p>
    </Card>
  );
}

function MeterRow({ m }: { m: Meter }) {
  const { t } = useTranslation();
  const fmt = (n: number) => (m.unit === 'bytes' ? formatBytes(n) : n.toLocaleString(i18n.language));
  const share = m.limit ? Math.min(1, m.used / m.limit) : 0;
  const level = share >= 0.9 ? 'high' : share >= 0.7 ? 'mid' : 'low';
  return (
    <li className="admin-meter">
      <div className="admin-meter-top">
        <span>{m.label}</span>
        <span className="admin-meter-num">
          {fmt(m.used)}
          {m.limit ? ` ${t('adminPage.ofLimit', { limit: fmt(m.limit) })}` : ''}
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
  const { t } = useTranslation();
  const s = data.settings;
  const [email, setEmail] = useState('');
  return (
    <Card title={t('adminPage.whoCanSignIn')}>
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
          <strong>{t('adminPage.inviteOnly')}</strong>
          <span className="muted small">{s.inviteOnly ? t('adminPage.inviteOnlyOn') : t('adminPage.inviteOnlyOff')}</span>
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
          <span className="small muted">{t('adminPage.addSomeone')}</span>
          <input type="email" value={email} placeholder="name@gmail.com" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button className="primary" disabled={!email.trim()}>
          {t('adminPage.add')}
        </button>
      </form>
      {data.invites.length > 0 && (
        <ul className="admin-invites">
          {data.invites.map((i) => (
            <li key={i.email}>
              <span>{i.email}</span>
              <span className="muted small">{t('adminPage.notSignedInYet')}</span>
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
                {t('adminPage.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{t('adminPage.storageNote')}</p>
    </Card>
  );
}

function UsersCard({ data, act }: { data: AdminOverview; act: Act }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const users = useMemo(() => {
    const find = q.trim().toLowerCase();
    return find ? data.users.filter((u) => u.name.toLowerCase().includes(find) || u.email.toLowerCase().includes(find)) : data.users;
  }, [data.users, q]);
  return (
    <Card title={t('adminPage.people', { n: data.users.length })}>
      {data.users.length > 5 && (
        <input className="admin-search" type="search" placeholder={t('adminPage.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <ul className="admin-users">
        {users.map((u) => (
          <UserRow key={u.id} u={u} inviteOnly={data.settings.inviteOnly} siteBridges={data.settings.bridgesPerPerson} act={act} />
        ))}
      </ul>
    </Card>
  );
}

function UserRow({ u, inviteOnly, siteBridges, act }: { u: AdminUser; inviteOnly: boolean; siteBridges: number; act: Act }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={u.blocked ? 'admin-user blocked' : 'admin-user'} data-testid="admin-user">
      <div className="admin-user-who">
        <strong>{u.name || u.email}</strong>
        {u.owner && <span className="tag">{t('adminPage.you')}</span>}
        {u.blocked && <span className="tag danger">{t('adminPage.blocked')}</span>}
        {inviteOnly && !u.owner && !u.allowed && !u.blocked && <span className="tag warn">{t('adminPage.notOnList')}</span>}
        <div className="muted small admin-email">{u.email}</div>
      </div>
      <div className="admin-user-stats small">
        <span>{t('adminPage.joined', { when: when(u.createdAt) })}</span>
        <span>{u.lastSeen ? t('adminPage.seen', { when: when(u.lastSeen) }) : t('adminPage.notSignedIn')}</span>
        <span>
          {!u.projectsAllowed && <span className="tag warn">{t('adminPage.noOnlineProjects')}</span>} {t('adminPage.projects', { count: u.projects })}
        </span>
        <span>
          {!u.bridgesAllowed && <span className="tag warn">{t('adminPage.noBridges')}</span>} {t('adminPage.presets', { count: u.presets })} ·{' '}
          {t('adminPage.printers', { count: u.printers })} · {t('adminPage.bridges', { count: u.bridges })}
        </span>
      </div>
      <div className="admin-user-actions">
        <Picker
          field
          label={t('adminPage.projectsFor', { email: u.email })}
          value={u.projectsAllowed ? 'yes' : 'no'}
          options={[
            { value: 'yes', label: t('adminPage.projectsOn') },
            { value: 'no', label: t('adminPage.projectsOff') },
          ]}
          onChange={(v) => {
            const yes = v === 'yes';
            act(
              () => adminApi.setProjects(u.id, yes),
              patchUser(u.id, (x) => ({ ...x, projectsAllowed: yes })),
            );
          }}
        />
        {!u.owner && (
          <div className="admin-bridge-limit">
            <label className="admin-switch">
              <input
                className="switch"
                type="checkbox"
                aria-label={t('adminPage.bridgesSameFor', { email: u.email })}
                checked={u.bridgesLimit === null}
                onChange={(e) => {
                  const n = e.target.checked ? null : siteBridges;
                  act(
                    () => adminApi.setBridges(u.id, n),
                    patchUser(u.id, (x) => ({ ...x, bridgesLimit: n, bridgesAllowed: n !== 0 })),
                  );
                }}
              />
              <span>{t('adminPage.bridgesSame', { n: bridgeCount(siteBridges) })}</span>
            </label>
            {u.bridgesLimit !== null && (
              <BridgeLimit
                label={t('adminPage.bridgesFor', { email: u.email })}
                value={u.bridgesLimit}
                min={0}
                onSave={(n) =>
                  act(
                    () => adminApi.setBridges(u.id, n),
                    patchUser(u.id, (x) => ({ ...x, bridgesLimit: n, bridgesAllowed: n !== 0 })),
                  )
                }
              />
            )}
          </div>
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
            {u.allowed ? t('adminPage.removeFromList') : t('adminPage.allow')}
          </button>
        )}
        {!u.owner && !confirming && (
          <button className="secondary danger" onClick={() => setConfirming(true)}>
            {t('adminPage.delete')}
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
            {u.blocked ? t('adminPage.unblock') : t('adminPage.block')}
          </button>
        )}
      </div>
      {confirming && (
        <div className="admin-confirm" role="alert">
          <span>{t('adminPage.deleteConfirm', { name: u.name || u.email })}</span>
          <div className="admin-user-actions">
            <button className="secondary" onClick={() => setConfirming(false)}>
              {t('adminPage.keep')}
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
              {t('adminPage.deleteForGood')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * A bridge number: a number box (saved when it loses focus or on Enter) and a
 * No limit switch that grays the box out. min 0 means "no bridges" is allowed.
 */
/** A bridge nobody opened for this long stops counting (functions/_lib/relay.ts UNUSED_MS). */
const UNUSED_MS = 30 * 24 * 3600_000;

function BridgeLimit({ label, value, min, onSave }: { label: string; value: number; min: number; onSave: (n: number) => void }) {
  const { t } = useTranslation();
  const unlimited = value === NO_LIMIT;
  const [text, setText] = useState(unlimited ? '' : String(value));
  useEffect(() => setText(value === NO_LIMIT ? '' : String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isInteger(n) && n >= min) {
      if (n !== value) onSave(n);
    } else setText(unlimited ? '' : String(value));
  };
  return (
    <div className="admin-bridge-number">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        step={1}
        disabled={unlimited}
        placeholder={unlimited ? t('adminPage.noLimit') : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <label className="admin-switch">
        <input
          className="switch"
          type="checkbox"
          aria-label={t('adminPage.noLimitFor', { label })}
          checked={unlimited}
          onChange={(e) => onSave(e.target.checked ? NO_LIMIT : Math.max(min, 1))}
        />
        <span>{t('adminPage.noLimit')}</span>
      </label>
    </div>
  );
}

function BridgesCard({ data, act }: { data: AdminOverview; act: Act }) {
  const { t } = useTranslation();
  const bridges: AdminBridge[] = data.bridges;
  const perPerson = data.settings.bridgesPerPerson;
  return (
    <Card title={t('adminPage.bridgesTitle', { n: bridges.length })}>
      <div className="admin-field">
        <span className="small muted">{t('adminPage.perPerson')}</span>
        <BridgeLimit
          label={t('adminPage.perPerson')}
          value={perPerson}
          min={1}
          onSave={(n) =>
            act(
              () => adminApi.saveSettings({ bridgesPerPerson: n }),
              (d) => ({ ...d, settings: { ...d.settings, bridgesPerPerson: n } }),
            )
          }
        />
        <span className="muted small">{t('adminPage.perPersonNote')}</span>
      </div>
      <p className="muted small admin-note">
        {t('adminPage.everyBridge')}
        <InfoTip label={t('adminPage.aboutOff')}>{t('adminPage.aboutOffText')}</InfoTip>
      </p>
      {bridges.length === 0 ? (
        <p className="muted small">{t('adminPage.noBridgesYet')}</p>
      ) : (
        <ul className="admin-users">
          {bridges.map((b) => (
            <li key={b.id} className={b.off ? 'admin-user blocked' : 'admin-user'} data-testid="admin-bridge">
              <div className="admin-user-who">
                <strong>{b.name || t('adminPage.notSaved')}</strong>
                {b.off && <span className="tag danger">{t('adminPage.off')}</span>}
                {!b.off && b.lastUsed !== null && Date.now() - b.lastUsed > UNUSED_MS && <span className="tag">{t('adminPage.unused30')}</span>}
                <div className="muted small admin-email">
                  {b.people || t('adminPage.nobodyYet')} · <span className="admin-bridge-id">{b.id}</span>
                </div>
              </div>
              <div className="admin-user-stats small">
                <span>{t('adminPage.used', { when: when(b.lastUsed) })}</span>
                <span>{b.printers ? t('adminPage.printersList', { list: b.printers }) : t('adminPage.noPrinters')}</span>
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
                  {b.off ? t('adminPage.turnOn') : t('adminPage.turnOff')}
                </button>
                {!b.off && (
                  <button
                    className="quiet"
                    onClick={() =>
                      act(
                        () => adminApi.removeBridge(b.id),
                        (d) => ({ ...d, bridges: d.bridges.filter((x) => x.id !== b.id) }),
                      )
                    }
                  >
                    {t('adminPage.remove')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
