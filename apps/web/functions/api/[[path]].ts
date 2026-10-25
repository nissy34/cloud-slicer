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
//   GET    /api/projects                    the user's online projects, usage and limits
//   GET    /api/projects/<id>                one project (its version and the device editing it)
//   POST   /api/projects/<id>/device         this device edits it from now on ({ device, deviceName })
//   GET    /api/projects/<id>/file          the project's 3MF
//   GET    /api/projects/<id>/thumbnail     its PNG thumbnail
//   PUT    /api/projects/<id>?name=&baseVersion=&engine=&draft=&device=&deviceName=   save (body: the 3MF)
//   PUT    /api/projects/<id>/thumbnail     set the thumbnail (body: PNG)
//   PATCH  /api/projects/<id>               rename ({ name, baseVersion? })
//   DELETE /api/projects/<id>
//   GET    /api/projects/<id>/prints        its print history (functions/_lib/prints.ts)
//   POST   /api/projects/<id>/prints        a send or a mark ({ plate, status, printer?, printerName?, file?, fingerprint?, summary? })
//   POST   /api/projects/<id>/prints/plates plates deleted or reordered ({ order: old index per new index })
//   POST   /api/projects/<id>/prints/copy   a saved copy takes the original's history ({ from })
//   GET    /api/prints/open                 prints still waiting for their printer, every project
//   PATCH  /api/prints/<id>                 how a print went, or "Keep as printed" ({ status?, duration?, progress?, fingerprint?, summary? })
//   POST   /api/relay/ticket                a ticket for the bridge relay ({ relay, bridgeId })
//   GET    /api/relay/key                   the public key that checks this site's tickets
//   DELETE /api/relay/bridges/<id>          a removed bridge stops counting against the cap
//   POST   /api/relay/setup                 a setup code for adding a bridge ({ relay })
//   GET    /api/relay/setup/<code>          whether a bridge has used it yet
//   POST   /api/relay/claim                 the relay, for a bridge spending a setup code
//   POST   /api/relay/release               the relay, for a bridge removed on its own computer
//   *      /api/admin/...                   the owner's Admin page (functions/_lib/admin.ts)
import * as admin from '../_lib/admin';
import * as auth from '../_lib/auth';
import { HttpError, json } from '../_lib/http';
import * as presets from '../_lib/presets';
import * as prints from '../_lib/prints';
import * as projects from '../_lib/projects';
import * as relay from '../_lib/relay';
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
    if (a === 'projects') {
      if (parts.length === 1 && m === 'GET') return await projects.list(env, request);
      if (parts.length === 2 && m === 'GET') return await projects.get(env, request, b);
      if (parts.length === 3 && c === 'device' && m === 'POST') return await projects.takeOver(env, request, b);
      if (parts.length === 3 && c === 'file' && m === 'GET') return await projects.file(env, request, b);
      if (parts.length === 3 && c === 'thumbnail' && m === 'GET') return await projects.thumbnail(env, request, b);
      if (parts.length === 3 && c === 'thumbnail' && m === 'PUT') return await projects.putThumbnail(env, request, b);
      if (parts.length === 3 && c === 'prints' && m === 'GET') return await prints.list(env, request, b);
      if (parts.length === 3 && c === 'prints' && m === 'POST') return await prints.add(env, request, b);
      if (parts.length === 4 && c === 'prints' && parts[3] === 'plates' && m === 'POST') return await prints.plates(env, request, b);
      if (parts.length === 4 && c === 'prints' && parts[3] === 'copy' && m === 'POST') return await prints.copy(env, request, b);
      if (parts.length === 2 && m === 'PUT') return await projects.put(env, request, b);
      if (parts.length === 2 && m === 'PATCH') return await projects.rename(env, request, b);
      if (parts.length === 2 && m === 'DELETE') return await projects.remove(env, request, b);
    }
    if (a === 'prints') {
      if (b === 'open' && parts.length === 2 && m === 'GET') return await prints.open(env, request);
      if (parts.length === 2 && m === 'PATCH') return await prints.update(env, request, b);
    }
    if (a === 'relay') {
      if (b === 'ticket' && parts.length === 2 && m === 'POST') return await relay.ticket(env, request);
      if (b === 'key' && parts.length === 2 && m === 'GET') return await relay.publicKey(env);
      if (b === 'bridges' && parts.length === 3 && m === 'DELETE') return await relay.forget(env, request, c);
      if (b === 'setup' && parts.length === 2 && m === 'POST') return await relay.setup(env, request);
      if (b === 'setup' && parts.length === 3 && m === 'GET') return await relay.setupState(env, request, c);
      if (b === 'claim' && parts.length === 2 && m === 'POST') return await relay.claim(env, request);
      if (b === 'release' && parts.length === 2 && m === 'POST') return await relay.release(env, request);
    }
    if (a === 'admin') {
      if (parts.length === 1 && m === 'GET') return await admin.overview(env, request);
      if (b === 'settings' && parts.length === 2 && m === 'PUT') return await admin.putSettings(env, request);
      if (b === 'users' && parts.length === 4 && parts[3] === 'storage' && m === 'PUT') return await admin.putUserStorage(env, request, c);
      if (b === 'users' && parts.length === 4 && parts[3] === 'bridges' && m === 'PUT') return await admin.putUserBridges(env, request, c);
      if (b === 'users' && parts.length === 4 && m === 'POST') return await admin.userAction(env, request, c, parts[3]);
      if (b === 'bridges' && parts.length === 4 && m === 'POST') return await admin.bridgeAction(env, request, c, parts[3]);
      if (b === 'invites' && parts.length === 2 && m === 'POST') return await admin.addInvite(env, request);
      if (b === 'invites' && parts.length === 3 && m === 'DELETE') return await admin.removeInvite(env, request, c);
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof HttpError ? e.message : 'Something went wrong on the server';
    if (!(e instanceof HttpError)) console.error(e);
    return json({ error: message, ...(e instanceof HttpError ? e.body : {}) }, status);
  }
}
