import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/unbounded';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource-variable/golos-text';
const App = React.lazy(() => import('./App'));
const Landing = React.lazy(() => import('./Landing'));
const Admin = React.lazy(() => import('./Admin'));
import './styles.css';
import './experience.css';
import './gestures.css';
import './theme';
import './motion';
import { Capacitor } from '@capacitor/core';
import { UpdateProvider } from './updates';
import { trackViewport } from './viewport';
const stopTrackingViewport = trackViewport();
if (import.meta.hot) import.meta.hot.dispose(stopTrackingViewport);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense
      fallback={
        <div className="app-loading" role="status">
          <img src="/icon.svg" width="48" height="48" alt="" />
          <span>Galinka</span>
        </div>
      }
    >
      {location.pathname === '/admin' || location.pathname.startsWith('/admin/') ? (
        <Admin />
      ) : !Capacitor.isNativePlatform() &&
        location.pathname === '/' &&
        !location.search.includes('demo=1') ? (
        <Landing />
      ) : (
        <UpdateProvider>
          <App />
        </UpdateProvider>
      )}
    </React.Suspense>
  </React.StrictMode>,
);
if (
  !Capacitor.isNativePlatform() &&
  !window.galinkaDesktop &&
  'serviceWorker' in navigator &&
  import.meta.env.PROD
)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
