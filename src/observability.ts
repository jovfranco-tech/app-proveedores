import * as Sentry from '@sentry/react';
import type { Role, UserSession } from './types';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const sentryEnvironment = (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE;

export function initObservability() {
  if (!sentryDsn) return;

  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })],
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.15),
    replaysSessionSampleRate: Number(import.meta.env.VITE_SENTRY_REPLAY_SAMPLE_RATE ?? 0.02),
    replaysOnErrorSampleRate: 1,
    beforeSend(event) {
      if (event.request?.headers) delete event.request.headers.Authorization;
      return event;
    }
  });
}

export function setObservabilityUser(session: UserSession | null) {
  if (!sentryDsn) return;
  Sentry.setUser(session ? { id: session.id, email: session.email, username: session.name } : null);
  Sentry.setTag('role', session?.role ?? 'anonymous');
}

export function captureAppError(error: unknown, context: string, metadata: Record<string, unknown> = {}) {
  if (!sentryDsn) return;
  Sentry.captureException(error, { tags: { context }, extra: metadata });
}

export function addAppBreadcrumb(message: string, data: Record<string, unknown> = {}) {
  if (!sentryDsn) return;
  Sentry.addBreadcrumb({ category: 'app', message, data, level: 'info' });
}

export function trackRoleNavigation(role: Role | 'anonymous', view: string) {
  addAppBreadcrumb('navigate', { role, view });
}
