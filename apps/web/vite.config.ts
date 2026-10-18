import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The engine runs pthreads on SharedArrayBuffer, which browsers only enable on
// cross-origin-isolated pages. public/_headers sends the same on Cloudflare Pages.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  test: { include: ['src/**/*.test.ts'] },
});
