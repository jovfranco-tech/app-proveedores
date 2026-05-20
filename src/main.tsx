import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './ErrorBoundary';
import { initObservability } from './observability';
import './styles.css';

initObservability();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

const isProductionBuild = import.meta.env?.PROD ?? false;

if ('serviceWorker' in navigator && isProductionBuild) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // La app sigue funcionando aunque el navegador bloquee el modo PWA.
    });
  });
}
