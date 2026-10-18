import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/theme';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Lets phones install the site as an app (see public/sw.js). Not in dev, where
// it would only get in the way of Vite's reloads.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
