// Every /api/* request: accounts (sign-in, session) and the user's saved presets.
//
//   GET    /api/me                          who is signed in + which providers exist
//   DELETE /api/me                          delete the account and its data
//   GET    /api/auth/<google|github>/start  begin a sign-in (?return=/path&popup=1&link=1)
//   GET    /api/auth/<provider>/callback    the provider's redirect (on AUTH_ORIGIN)
//   GET    /api/auth/finish                 set the session on the starting host
//   POST   /api/auth/logout
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
import type { PagesContext } from '../_lib/types';
import * as userdata from '../_lib/userdata';

function errorPage(status: number, message: string): Response {
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cloud Slicer</title>
<body style="font:15px system-ui;padding:24px"><p>${escape(message)}</p><p><a href="/">Back to the slicer</a></p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

export async function onRequest({ request, env }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const m = request.method;
  try {
    const [a, b, c] = parts;
    if (a === 'me' && parts.length === 1) {
      if (m === 'GET') return await auth.me(env, request);
      if (m === 'DELETE') return await auth.deleteAccount(env, request);
    }
    if (a === 'auth') {
      if (b === 'finish' && m === 'GET') return await auth.finish(env, request);
      if (b === 'logout' && m === 'POST') return await auth.logout(env, request);
      if (c === 'start' && m === 'GET') return await auth.start(env, request, b);
      if (c === 'callback' && m === 'GET') return await auth.callback(env, request, b);
    }
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
    // Sign-in steps are page navigations: show a page, not JSON.
    if (parts[0] === 'auth' && m === 'GET') return errorPage(status, message);
    return json({ error: message, ...(e instanceof HttpError ? e.body : {}) }, status);
  }
}
