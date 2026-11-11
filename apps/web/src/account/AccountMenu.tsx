import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { saveUserSetting, useAccount, useUserSetting } from '../state/account';
import { isLanguageChoice, LANGUAGE_SETTING, setLocalLanguage, useLanguageStore, type LanguageChoice } from '../lib/language';
import { LANGUAGES } from '../i18n';
import { useSlicer } from '../state/store';
import type { PresetType, ProviderId } from './api';
import { Note } from '../components/Note';
import { Menu } from '../components/Menu';

const PROVIDER_LABEL: Record<ProviderId, string> = { google: 'Google' };
const ALL_PROVIDERS = Object.keys(PROVIDER_LABEL) as ProviderId[];
const TYPE_LABEL = { printer: 'account.printers', filament: 'account.filaments', process: 'account.processes' } as const;

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function presetSummary(counts: Record<PresetType, number>): string {
  const parts = (Object.keys(TYPE_LABEL) as PresetType[])
    .filter((t) => counts[t])
    .map((t) => i18n.t(TYPE_LABEL[t], { count: counts[t] }));
  return parts.length ? parts.join(', ') : i18n.t('account.noPresets');
}

/** The top bar's Sign in button, and the account menu once signed in. */
export function AccountMenu() {
  const { t } = useTranslation();
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const error = useAccount((s) => s.error);
  const [open, setOpen] = useState(false);

  useEffect(() => useAccount.getState().init(), []);
  // The account's language (from another device, or after sign-in) wins.
  const savedLanguage = useUserSetting<unknown>(LANGUAGE_SETTING);
  useEffect(() => {
    if (isLanguageChoice(savedLanguage)) setLocalLanguage(savedLanguage);
  }, [savedLanguage]);
  // Close the sign-in panel once the sign-in (popup) finishes.
  const userId = user?.id;
  useEffect(() => setOpen(false), [userId]);
  // A sign-in error should be seen even if the menu was closed.
  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);

  return (
    <div className="account">
      <Menu
        label={user ? t('account.account') : t('account.signIn')}
        role="dialog"
        placement="bottom-end"
        className="account-pop"
        open={open}
        onOpenChange={setOpen}
        button={(props) =>
          user ? (
            <button {...props} className="account-button" title={user.name}>
              <span className="account-avatar" aria-hidden>
                {initials(user.name)}
              </span>
              <span className="account-name">{user.name}</span>
            </button>
          ) : (
            <button {...props} className="ghost" disabled={status === 'loading'}>
              {t('account.signIn')}
            </button>
          )
        }
      >
        {user ? <SignedIn onDone={() => setOpen(false)} /> : <SignedOut />}
        {error && (
          <Note tone="error">
            {error}{' '}
            <button className="quiet" onClick={() => useAccount.getState().clearError()}>
              {t('common.close')}
            </button>
          </Note>
        )}
      </Menu>
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
  const { t } = useTranslation();
  const status = useAccount((s) => s.status);
  const providers = useAccount((s) => s.providers);
  const { total } = usePresetCounts();

  if (status === 'unavailable')
    return (
      <>
        <h3>{t('account.signIn')}</h3>
        <p className="account-muted">{t('account.unavailable')}</p>
        <Legal />
      </>
    );
  const none = !ALL_PROVIDERS.some((p) => providers[p]);
  return (
    <>
      <h3>{t('account.signInTitle')}</h3>
      <p className="account-muted">{t('account.signInWhy')}</p>
      <div className="account-providers">
        {ALL_PROVIDERS.map((p) => (
          <button
            key={p}
            className="secondary account-provider"
            disabled={!providers[p]}
            title={providers[p] ? undefined : t('account.providerNotSetUp', { provider: PROVIDER_LABEL[p] })}
            onClick={() => void useAccount.getState().signIn(p)}
          >
            {t('account.continueWith', { provider: PROVIDER_LABEL[p] })}
          </button>
        ))}
      </div>
      {none && <p className="account-muted">{t('account.noSignIn')}</p>}
      {total > 0 && (
        <p className="account-muted">
          {t('account.presetsMove', { count: total })}
        </p>
      )}
      <Legal />
    </>
  );
}

function SignedIn({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const user = useAccount((s) => s.user)!;
  // Connected once, but Google no longer gives the site a key (the app's access was taken away, or the key ran out).
  const reconnect = useAccount((s) => Boolean(user.drive && (s.driveLost || user.driveReconnect)));
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
            {i.login || i.email
              ? t('account.signedInAs', { provider: PROVIDER_LABEL[i.provider], who: i.login || i.email })
              : t('account.signedInWith', { provider: PROVIDER_LABEL[i.provider] })}
          </li>
        ))}
        <li>{presetSummary(counts)}</li>
        <li>
          {user.projects === false
            ? t('account.projectsOff')
            : reconnect
              ? t('account.driveReconnect')
              : user.drive
                ? t('account.driveOn')
                : t('account.driveOff')}
        </li>
      </ul>
      {(!user.drive || reconnect) && user.projects !== false && (
        <button className="secondary" data-testid="connect-drive" onClick={() => void useAccount.getState().connectDrive()}>
          {t('account.connectDrive')}
        </button>
      )}
      {user.owner && (
        <button
          className="secondary account-admin"
          onClick={() => {
            useSlicer.getState().setTab('admin');
            onDone();
          }}
        >
          {t('account.admin')}
        </button>
      )}
      {confirming ? (
        <div className="account-confirm">
          <p>
            {total ? t('account.deleteAskPresets', { count: total }) : t('account.deleteAsk')}
          </p>
          <p className="account-muted">{t('account.projectsStay')}</p>
          <div className="account-actions">
            <button className="secondary" onClick={() => setConfirming(false)}>
              {t('account.keepIt')}
            </button>
            <button
              className="primary danger"
              onClick={async () => {
                await useAccount.getState().deleteAccount();
                setConfirming(false);
                onDone();
              }}
            >
              {t('account.delete')}
            </button>
          </div>
        </div>
      ) : (
        <div className="account-actions">
          <button className="quiet danger" onClick={() => setConfirming(true)}>
            {t('account.delete')}
          </button>
          <button
            className="secondary"
            onClick={async () => {
              await useAccount.getState().signOut();
              onDone();
            }}
          >
            {t('account.signOut')}
          </button>
        </div>
      )}
      <Legal />
    </>
  );
}

/**
 * The menu's last line: the language (English unless picked here,
 * docs/architecture/languages.md), then what is kept and how (public/privacy.html,
 * public/terms.html).
 */
function Legal() {
  const { t } = useTranslation();
  const language = useLanguageStore((s) => s.choice);
  const pick = (next: LanguageChoice) => {
    setLocalLanguage(next);
    // Signed out, it stays in this browser.
    saveUserSetting(LANGUAGE_SETTING, next).catch(() => {});
  };
  return (
    <div className="account-legal">
      <div className="account-language">
        <span className="account-muted">{t('language.heading')}</span>
        <div className="chooser" role="radiogroup" aria-label={t('language.heading')} data-testid="language-picker">
          {LANGUAGES.map((l) => l.id).map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={language === id}
              className={language === id ? 'active' : ''}
              data-testid={`language-${id}`}
              lang={id}
              onClick={() => pick(id)}
            >
              {LANGUAGES.find((l) => l.id === id)!.name}
            </button>
          ))}
        </div>
      </div>
    <p className="account-muted">
      <a href="/privacy" target="_blank" rel="noopener">
        {t('account.privacy')}
      </a>
      {' · '}
      <a href="/terms" target="_blank" rel="noopener">
        {t('account.terms')}
      </a>
    </p>
    </div>
  );
}
