import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/golos-text';
import App from './App';
import Landing from './Landing';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname === '/' && !location.search.includes('demo=1') ? <Landing /> : <App />}
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
