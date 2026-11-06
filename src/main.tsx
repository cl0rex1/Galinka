import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/golos-text';
const App = React.lazy(() => import('./App'));
const Landing = React.lazy(() => import('./Landing'));
const Admin = React.lazy(() => import('./Admin'));
const Changelog = React.lazy(() => import('./Changelog'));
import './styles.css';
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
      ) : location.pathname === '/changelog' ? (
        <Changelog />
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
