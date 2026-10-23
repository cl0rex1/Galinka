import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/golos-text';
import App from './App';
import Landing from './Landing';
import './styles.css';
import './theme';
import { Capacitor } from '@capacitor/core';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {!Capacitor.isNativePlatform() &&
    location.pathname === '/' &&
    !location.search.includes('demo=1') ? (
      <Landing />
    ) : (
      <App />
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
