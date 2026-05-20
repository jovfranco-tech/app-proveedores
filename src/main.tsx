import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
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
