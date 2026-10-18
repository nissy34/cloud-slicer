// Every /api/* request: sign-in (Better Auth) and what each user saves.
//
//   *      /api/auth/*                      Better Auth: sign-in/social, callback/google,
//                                           sign-out, delete-user, get-session, ...
//   GET    /api/signin-done                 where a sign-in ends (?popup=1, ?return=/path)
//   GET    /api/me                          who is signed in + which providers exist
//   GET    /api/presets[?type=]             the user's presets
//   PUT    /api/presets/<type>/<name>       save one ({ inherits, config, baseVersion? })
//   DELETE /api/presets/<type>/<name>
//   GET    /api/settings                    setup choices ({ key, value, version })
//   PUT    /api/settings/<key>              save one ({ value, baseVersion? })
//   DELETE /api/settings/<key>
//   GET    /api/devices                     the user's printers (no API keys)
//   GET    /api/devices/<id>/secret         one printer's API key
//   PUT    /api/devices/<id>                save ({ name, preset, url, apiKey?, extra?, baseVersion? })
//   DELETE /api/devices/<id>
import * as auth from '../_lib/auth';
import { HttpError, json } from '../_lib/http';
import * as presets from '../_lib/presets';
import type { Env, PagesContext } from '../_lib/types';
import * as userdata from '../_lib/userdata';

/** Tests only: Google's token endpoint goes to the mock server instead. */
function useTestGoogle(env: Env) {
  const base = env.OAUTH_TEST_BASE;
  const g = globalThis as { __testGoogle?: boolean };
  if (!base || g.__testGoogle) return;
  g.__testGoogle = true;
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return real(`${base}/google/token`, init);
    return real(input, init);
  };
}

export async function onRequest({ request, env }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const m = request.method;
  try {
    useTestGoogle(env);
    const [a, b, c] = parts;
    if (a === 'auth') return await auth.handle(env, request);
    if (a === 'signin-done' && m === 'GET') return auth.signInDone(request);
    if (a === 'me' && parts.length === 1 && m === 'GET') return await auth.me(env, request);
    if (a === 'presets') {
      if (parts.length === 1 && m === 'GET') return await presets.list(env, request);
      if (parts.length === 3 && m === 'PUT') return await presets.put(env, request, b, c);
      if (parts.length === 3 && m === 'DELETE') return await presets.remove(env, request, b, c);
    }
    if (a === 'settings') {
      if (parts.length === 1 && m === 'GET') return await userdata.listSettings(env, request);
      if (parts.length === 2 && m === 'PUT') return await userdata.putSetting(env, request, b);
      if (parts.length === 2 && m === 'DELETE') return await userdata.deleteSetting(env, request, b);
    }
    if (a === 'devices') {
      if (parts.length === 1 && m === 'GET') return await userdata.listDevices(env, request);
      if (parts.length === 3 && c === 'secret' && m === 'GET') return await userdata.deviceSecret(env, request, b);
      if (parts.length === 2 && m === 'PUT') return await userdata.putDevice(env, request, b);
      if (parts.length === 2 && m === 'DELETE') return await userdata.deleteDevice(env, request, b);
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof HttpError ? e.message : 'Something went wrong on the server';
    if (!(e instanceof HttpError)) console.error(e);
    return json({ error: message, ...(e instanceof HttpError ? e.body : {}) }, status);
  }
}
