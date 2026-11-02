import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/golos-text';
import App from './App';
import Landing from './Landing';
import Admin from './Admin';
import './styles.css';
import './theme';
import { Capacitor } from '@capacitor/core';
import { UpdateProvider } from './updates';
import { trackViewport } from './viewport';
const stopTrackingViewport = trackViewport();
if (import.meta.hot) import.meta.hot.dispose(stopTrackingViewport);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
