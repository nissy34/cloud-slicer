import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { Dialog } from '../components/Dialog';
import { Note } from '../components/Note';
import { useAccount } from '../state/account';

/**
 * The code an AI app's add-on (apps/mcp) shows when it signs in, from the link it
 * gives: <site>/?user_code=ABCDEFGH#link (Better Auth's device-authorization plugin,
 * functions/_lib/auth.ts). '' for a bare #link (the person types the code), null
 * when the page wasn't opened from such a link.
 */
export function linkCode(search: string, hash: string): string | null {
  if (!/^#link(?:$|[?&])/.test(hash)) return null;
  const code = new URLSearchParams(search).get('user_code') ?? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('user_code');
  return code ? code.trim().toUpperCase() : '';
}

type Stage =
  | { kind: 'checking' }
  | { kind: 'ask' }
  | { kind: 'done'; approved: boolean }
  | { kind: 'error'; message: string };

async function authCall(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(`/api/auth${path}`, { credentials: 'include', ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const code = String(body.error ?? body.code ?? '');
    if (code === 'expired_token' || /expired/i.test(String(body.error_description ?? body.message ?? '')))
      throw new Error(i18n.t('linkProgram.expired'));
    if (code === 'invalid_request' || r.status === 404 || r.status === 400) throw new Error(i18n.t('linkProgram.invalid'));
    throw new Error(String(body.error_description ?? body.message ?? i18n.t('linkProgram.siteAnswered', { status: r.status })));
  }
  return body;
}

/**
 * "Connect an AI app": the person approves (or turns down) a sign-in an AI app's add-on
 * on their computer asked for. Signed out, it asks them to sign in first.
 */
export function LinkProgramDialog() {
  const { t } = useTranslation();
  const [code, setCode] = useState(() => (typeof location === 'undefined' ? null : linkCode(location.search, location.hash)));
  const [typed, setTyped] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const providers = useAccount((s) => s.providers);

  // Signed in with a code: claim it for this account (the plugin's verify step), then ask.
  useEffect(() => {
    if (!code || !user) return;
    let live = true;
    setStage({ kind: 'checking' });
    authCall(`/device?user_code=${encodeURIComponent(code)}`)
      .then((r) => {
        if (!live) return;
        if (r.status === 'approved') setStage({ kind: 'done', approved: true });
        else if (r.status === 'denied') setStage({ kind: 'done', approved: false });
        else setStage({ kind: 'ask' });
      })
      .catch((e: Error) => live && setStage({ kind: 'error', message: e.message }));
    return () => {
      live = false;
    };
  }, [code, user]);

  if (code === null) return null;
  const close = () => {
    const search = new URLSearchParams(location.search);
    search.delete('user_code');
    history.replaceState(null, '', location.pathname + (search.size ? `?${search}` : ''));
    setCode(null);
  };
  const answer = async (approve: boolean) => {
    try {
      await authCall(approve ? '/device/approve' : '/device/deny', { method: 'POST', body: JSON.stringify({ userCode: code }) });
      setStage({ kind: 'done', approved: approve });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  };

  let body: React.ReactNode;
  let footer: React.ReactNode = (
    <button className="secondary" onClick={close}>
      {t('common.close')}
    </button>
  );
  if (status === 'loading') body = <p className="muted">{t('linkProgram.checkingAccount')}</p>;
  else if (!user)
    body = (
      <>
        <p>{t('linkProgram.signInFirst')}</p>
        {providers.google ? null : <Note tone="warn">{t('linkProgram.noSignIn')}</Note>}
      </>
    );
  else if (!code)
    body = (
      <form
        id="link-code-form"
        className="win-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) setCode(typed.trim().toUpperCase());
        }}
      >
        <label className="field">
          <span>{t('linkProgram.codeLabel')}</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} placeholder="ABCD1234" />
        </label>
      </form>
    );
  else if (stage.kind === 'checking') body = <p className="muted">{t('linkProgram.checkingCode')}</p>;
  else if (stage.kind === 'error') body = <Note tone="error">{stage.message}</Note>;
  else if (stage.kind === 'done')
    body = stage.approved ? (
      <p>{t('linkProgram.connected', { name: user.name })}</p>
    ) : (
      <p>{t('linkProgram.turnedDown')}</p>
    );
  else
    body = (
      <>
        <p>
          <Trans i18nKey={'linkProgram.asks'} values={{ email: user.email }} components={{ b: <b /> }} />
        </p>
        <p className="link-code" data-testid="link-code">
          {code}
        </p>
        <p className="muted small">
          {t('linkProgram.willSee')}
        </p>
      </>
    );

  if (!user && status !== 'loading' && providers.google)
    footer = (
      <>
        <button className="secondary" onClick={close}>
          {t('common.notNow')}
        </button>
        <button className="primary" onClick={() => void useAccount.getState().signIn('google')}>
          {t('linkProgram.continueGoogle')}
        </button>
      </>
    );
  else if (user && !code)
    footer = (
      <>
        <button className="secondary" onClick={close}>
          {t('common.cancel')}
        </button>
        <button type="submit" form="link-code-form" className="primary" disabled={!typed.trim()}>
          {t('common.next')}
        </button>
      </>
    );
  else if (user && stage.kind === 'ask')
    footer = (
      <>
        <button className="secondary" onClick={() => void answer(false)}>
          {t('linkProgram.dontConnect')}
        </button>
        <button className="primary" onClick={() => void answer(true)}>
          {t('linkProgram.connect')}
        </button>
      </>
    );
  else if (stage.kind === 'done')
    footer = (
      <button className="primary" onClick={close}>
        {t('common.done')}
      </button>
    );

  return (
    <Dialog title={t('linkProgram.title')} testId="link-program-dialog" onClose={close} footer={footer}>
      <div className="link-program">{body}</div>
    </Dialog>
  );
}
