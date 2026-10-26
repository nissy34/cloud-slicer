import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/theme';
import { App } from './App';
import { useDevice } from './state/device';
import { useSlicer } from './state/store';
import '@fontsource-variable/inter';
import './styles/index.css';

// #design: every token and shared part, light and dark (docs/architecture/design-system.md).
const DesignPage = lazy(() => import('./components/DesignPage').then((m) => ({ default: m.DesignPage })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.hash === '#design' ? (
      <Suspense fallback={null}>
        <DesignPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

// Lets phones install the site as an app (see public/sw.js). Not in dev, where
// it would only get in the way of Vite's reloads.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// A print alert tapped while a tab is open (public/sw.js): show its printer.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const key = (e.data as { alert?: unknown } | null)?.alert;
    if (typeof key !== 'string') return;
    useSlicer.getState().setTab('device');
    useDevice.getState().openAlert(key);
  });
}
