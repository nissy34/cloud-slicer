import { useEffect, useState } from 'react';
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
      throw new Error('This code has expired. Ask your AI app to sign in again for a new one.');
    if (code === 'invalid_request' || r.status === 404 || r.status === 400) throw new Error("This code isn't valid. Check it against the one your AI app shows, or ask it to sign in again.");
    throw new Error(String(body.error_description ?? body.message ?? `The site answered ${r.status}`));
  }
  return body;
}

/**
 * "Connect an AI app": the person approves (or turns down) a sign-in an AI app's add-on
 * on their computer asked for. Signed out, it asks them to sign in first.
 */
export function LinkProgramDialog() {
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
      Close
    </button>
  );
  if (status === 'loading') body = <p className="muted">Checking your account…</p>;
  else if (!user)
    body = (
      <>
        <p>Sign in to Cloud Slicer first. Then this window asks you to connect your AI app.</p>
        {providers.google ? null : <Note tone="warn">Sign-in isn't set up on this site.</Note>}
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
          <span>The code your AI app shows</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} placeholder="ABCD1234" />
        </label>
      </form>
    );
  else if (stage.kind === 'checking') body = <p className="muted">Checking the code…</p>;
  else if (stage.kind === 'error') body = <Note tone="error">{stage.message}</Note>;
  else if (stage.kind === 'done')
    body = stage.approved ? (
      <p>Connected. Go back to your AI app: it's signed in as {user.name}.</p>
    ) : (
      <p>Turned down. Your AI app isn't signed in.</p>
    );
  else
    body = (
      <>
        <p>
          An AI app on your computer (the Cloud Slicer add-on) asks to use your account, <b>{user.email}</b>. Check that it shows this code:
        </p>
        <p className="link-code" data-testid="link-code">
          {code}
        </p>
        <p className="muted small">
          It will see your saved presets and printers, and can check your printers and upload to them. It asks you every time before it starts a
          print. You can sign it out from the AI app.
        </p>
      </>
    );

  if (!user && status !== 'loading' && providers.google)
    footer = (
      <>
        <button className="secondary" onClick={close}>
          Not now
        </button>
        <button className="primary" onClick={() => void useAccount.getState().signIn('google')}>
          Continue with Google
        </button>
      </>
    );
  else if (user && !code)
    footer = (
      <>
        <button className="secondary" onClick={close}>
          Cancel
        </button>
        <button type="submit" form="link-code-form" className="primary" disabled={!typed.trim()}>
          Next
        </button>
      </>
    );
  else if (user && stage.kind === 'ask')
    footer = (
      <>
        <button className="secondary" onClick={() => void answer(false)}>
          Don't connect
        </button>
        <button className="primary" onClick={() => void answer(true)}>
          Connect
        </button>
      </>
    );
  else if (stage.kind === 'done')
    footer = (
      <button className="primary" onClick={close}>
        Done
      </button>
    );

  return (
    <Dialog title="Connect an AI app" testId="link-program-dialog" onClose={close} footer={footer}>
      <div className="link-program">{body}</div>
    </Dialog>
  );
}
