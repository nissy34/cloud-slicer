import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { engineBytes, engineReleases, engineVersion } from './scripts/engine-version.mjs';

// The engine runs pthreads on SharedArrayBuffer, which browsers only enable on
// cross-origin-isolated pages. public/_headers sends the same on Cloudflare Pages.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Google's file window (public/drive-picker.html) must not be isolated: _headers detaches the headers there, and so does this. */
const pickerUnisolated: Plugin = {
  name: 'drive-picker-unisolated',
  configureServer: (server) => void server.middlewares.use(unisolate),
  configurePreviewServer: (server) => void server.middlewares.use(unisolate),
};
const unisolate: Connect.NextHandleFunction = (req, res, next) => {
  if (!(req as { url?: string }).url?.startsWith('/drive-picker')) return next();
  // Vite may set the isolation headers after this runs: ignore them on this page, and take off any already set.
  const set = res.setHeader.bind(res);
  res.setHeader = (k: string, v: number | string | readonly string[]) => (k.toLowerCase().startsWith('cross-origin-') ? res : set(k, v));
  for (const k of Object.keys(isolation)) res.removeHeader(k);
  next();
};

export default defineConfig({
  plugins: [react(), pickerUnisolated],
  define: {
    'import.meta.env.VITE_ENGINE_VERSION': JSON.stringify(engineVersion()),
    'import.meta.env.VITE_ENGINE_BYTES': JSON.stringify(engineBytes()),
    'import.meta.env.VITE_ENGINE_ORCA_BYTES': JSON.stringify(engineBytes('engine-orca')),
    'import.meta.env.VITE_ENGINE_RELEASES': JSON.stringify(engineReleases()),
  },
  server: { headers: isolation },
  preview: { headers: isolation },
  // Stylesheets reach tests as text (src/lib/stylesheets.test.ts checks them).
  test: { include: ['src/**/*.test.ts'], css: { include: [/\.css/] } },
});
