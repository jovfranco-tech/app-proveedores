import * as Sentry from '@sentry/react';
import { ReactNode } from 'react';

function Fallback() {
  return (
    <main className="app-fallback" role="alert">
      <div className="state-block">
        <strong>Algo fallo al cargar la app.</strong>
        <p>Ya registramos el error. Recarga la pagina o intenta de nuevo en unos minutos.</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>
          Recargar
        </button>
      </div>
    </main>
  );
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return <Sentry.ErrorBoundary fallback={<Fallback />}>{children}</Sentry.ErrorBoundary>;
}
