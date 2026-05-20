import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { nanoid } from 'nanoid';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertRequiredProductionConfig, configuredServices } from './config';
import {
  acceptRequest as storeAcceptRequest,
  addTimeline,
  disputeRequest,
  eventsAfter,
  getProvider,
  getRequest,
  initializeDatabase,
  insertAuditLog,
  insertEvent,
  insertFraudSignal,
  insertMessage,
  insertNotification,
  insertRequest,
  insertSupportDocument,
  listAuditLogs,
  listCategories,
  listDisputes,
  listFraudSignals,
  listHeatPoints,
  listMessages,
  listNotifications,
  listPayments,
  listProviders,
  listRequests,
  listSupportDocuments,
  metrics,
  quoteRequest as storeQuoteRequest,
  resolveDispute,
  reviewRequest,
  updateProviderLocation,
  updateRequestEscrow,
  verifyProvider
} from './db';
import {
  AuthenticatedRequest,
  canSetStatus,
  clearAuthCookies,
  loginWithPassword,
  refreshSession,
  requireAuth
} from './auth';
import {
  applyRefund,
  createCheckout,
  handleMercadoPagoWebhook,
  handleStripeWebhook,
  paymentRuntimeConfig,
  reconcilePendingPayments
} from './payments';
import { oauthCallback, oauthStart } from './oauth';
import { createDocumentUploadTarget } from './uploads';
import { httpLogger, logger, metricsHandler, metricsMiddleware, setActiveSseConnections, startTelemetry } from './observability';
import type {
  ApiEnvelope,
  NotificationEvent,
  Provider,
  RequestStatus,
  Role,
  ServiceRequest,
  UserSession
} from '../src/types';

assertRequiredProductionConfig();
startTelemetry();
await initializeDatabase();

const app = express();
const port = Number(process.env.API_PORT ?? 5174);
const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:5173';

type SseClient = {
  id: string;
  role: Role;
  write: (payload: string) => void;
};

const clients = new Map<string, SseClient>();

function envelope<T>(data: T): ApiEnvelope<T> {
  return { data };
}

function money(value: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0
  }).format(value);
}

function roleFrom(value: unknown): Role {
  if (value === 'cliente' || value === 'proveedor' || value === 'admin') return value;
  return 'cliente';
}

async function audit(req: AuthenticatedRequest, action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  await insertAuditLog({
    actorUserId: req.user?.id,
    actorRole: req.user?.role,
    action,
    entityType,
    entityId,
    metadata,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
}

async function broadcast(notification: Omit<NotificationEvent, 'id' | 'createdAt'>) {
  const saved = await insertNotification(notification);
  const event = await insertEvent('notification', saved.role, saved);
  const payload = `id: ${event.seq}\nevent: notification\ndata: ${JSON.stringify(saved)}\n\n`;

  for (const client of clients.values()) {
    if (saved.role === 'todos' || saved.role === client.role) {
      client.write(payload);
    }
  }
  return saved;
}

function canAccessRequest(user: UserSession, request: ServiceRequest) {
  if (user.role === 'admin') return true;
  if (user.role === 'cliente') return request.clientId === user.id;
  if (user.role === 'proveedor') return request.status === 'abierta' || request.providerId === user.providerId;
  return false;
}

function fraudScoreFor(input: { budget: number; description: string; dateTime: string; address: string }) {
  let score = 8;
  const reasons: string[] = [];
  if (input.budget >= 10000) {
    score += 28;
    reasons.push('Presupuesto inusualmente alto.');
  }
  if (/efectivo|fuera de la app|whatsapp|transferencia directa/i.test(input.description)) {
    score += 35;
    reasons.push('La descripcion sugiere mover la operacion fuera de la plataforma.');
  }
  if (new Date(input.dateTime).getTime() - Date.now() < 2 * 60 * 60 * 1000) {
    score += 15;
    reasons.push('Solicitud de atencion inmediata.');
  }
  if (input.address.trim().length < 8) {
    score += 18;
    reasons.push('Direccion con baja precision.');
  }
  return { score: Math.min(score, 100), reasons };
}

app.set('trust proxy', 1);
app.use(httpLogger);
app.use(metricsMiddleware);

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const result = await handleStripeWebhook(req.body, req.get('stripe-signature') ?? undefined);
    await insertAuditLog({
      action: 'payment.webhook.stripe',
      entityType: 'payment',
      entityId: result?.payment.id,
      metadata: { received: true },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.json(envelope({ received: true }));
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : 'Webhook de Stripe invalido.' });
  }
});

app.use(
  helmet({
    crossOriginEmbedderPolicy: false
  })
);
app.use(
  cors({
    origin: appOrigin,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.RATE_LIMIT_MAX ?? 180),
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const result = await handleMercadoPagoWebhook(req.body);
    await insertAuditLog({
      action: 'payment.webhook.mercadopago',
      entityType: 'payment',
      entityId: result?.payment.id,
      metadata: { body: req.body },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.json(envelope({ received: true }));
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : 'Webhook de Mercado Pago invalido.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json(envelope({ ok: true, timestamp: new Date().toISOString(), services: configuredServices() }));
});

app.get('/metrics', metricsHandler);

app.get('/api/config', (_req, res) => {
  res.json(envelope(paymentRuntimeConfig()));
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const role = roleFrom(req.body?.role);
    const email = String(req.body?.email ?? '');
    const password = String(req.body?.password ?? process.env.DEMO_PASSWORD ?? 'Demo123!');
    const payload = await loginWithPassword(role, email, password, req, res);
    await insertAuditLog({
      actorUserId: payload.user.id,
      actorRole: payload.user.role,
      action: 'auth.login',
      entityType: 'user',
      entityId: payload.user.id,
      metadata: { email },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.json(envelope(payload));
  } catch (err) {
    res.status(401).json({ message: err instanceof Error ? err.message : 'No pudimos iniciar sesion.' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const payload = await refreshSession(req, res);
    res.json(envelope(payload));
  } catch (err) {
    clearAuthCookies(res);
    res.status(401).json({ message: err instanceof Error ? err.message : 'Sesion expirada.' });
  }
});

app.post('/api/auth/logout', requireAuth(), async (req: AuthenticatedRequest, res) => {
  await audit(req, 'auth.logout', 'user', req.user?.id);
  clearAuthCookies(res);
  res.json(envelope({ ok: true }));
});

app.get('/api/auth/oauth/:provider/start', (req, res) => {
  try {
    const provider = req.params.provider === 'apple' ? 'apple' : 'google';
    res.redirect(oauthStart(provider, req, res));
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : 'OAuth no configurado.' });
  }
});

app.all('/api/auth/oauth/:provider/callback', async (req, res) => {
  try {
    const provider = req.params.provider === 'apple' ? 'apple' : 'google';
    const payload = await oauthCallback(provider, req, res);
    await insertAuditLog({
      actorUserId: payload.user.id,
      actorRole: payload.user.role,
      action: `auth.oauth.${provider}`,
      entityType: 'user',
      entityId: payload.user.id,
      metadata: { email: payload.user.email },
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.redirect(`${appOrigin}/?oauth=success`);
  } catch (err) {
    logger.warn({ err }, 'OAuth callback fallo');
    res.redirect(`${appOrigin}/?oauth=error`);
  }
});

app.get('/api/categories', async (_req, res) => {
  res.json(envelope(await listCategories()));
});

app.get('/api/categories/featured', async (_req, res) => {
  res.json(envelope(await listCategories(true)));
});

app.get('/api/notifications', requireAuth(), async (req: AuthenticatedRequest, res) => {
  res.json(envelope(await listNotifications(req.user!.role)));
});

app.get('/api/requests', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const data = await listRequests({
    role: req.user!.role,
    userId: req.user!.id,
    providerId: req.user!.providerId,
    category: String(req.query.category ?? 'todas'),
    search: String(req.query.search ?? ''),
    maxBudget: req.query.maxBudget ? Number(req.query.maxBudget) : undefined,
    maxDistance: req.query.maxDistance ? Number(req.query.maxDistance) : undefined
  });
  res.json(envelope(data));
});

app.post('/api/requests', requireAuth(['cliente']), async (req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  const categoryId = String(body.categoryId ?? '');
  const category = (await listCategories()).find((item) => item.id === categoryId);

  if (!category) {
    res.status(400).json({ message: 'Selecciona una categoria valida.' });
    return;
  }
  if (!body.title || !body.address || !body.dateTime || Number(body.budget) <= 0) {
    res.status(400).json({ message: 'Completa titulo, fecha, direccion y presupuesto.' });
    return;
  }

  const fraud = fraudScoreFor({
    budget: Number(body.budget),
    description: String(body.description ?? ''),
    dateTime: String(body.dateTime),
    address: String(body.address)
  });
  const request = await insertRequest({
    title: String(body.title),
    categoryId,
    clientId: req.user!.id,
    address: String(body.address),
    city: String(body.city ?? 'Ciudad de Mexico'),
    dateTime: String(body.dateTime),
    budget: Number(body.budget),
    distanceKm: Number(body.distanceKm ?? 4 + Math.random() * 8),
    description: String(body.description ?? ''),
    lat: body.location?.lat,
    lng: body.location?.lng,
    fraudScore: fraud.score
  });
  await Promise.all(fraud.reasons.map((reason) => insertFraudSignal(request.id, fraud.score, reason)));
  await audit(req, 'request.create', 'request', request.id, { fraudScore: fraud.score });
  void broadcast({
    role: 'proveedor',
    title: 'Nueva solicitud abierta',
    message: `${request.title} con presupuesto de ${money(request.budget)}.`
  });
  res.status(201).json(envelope(request));
});

app.get('/api/requests/:id', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  res.json(envelope(request));
});

app.patch('/api/requests/:id/status', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  const status = String(req.body?.status ?? '') as RequestStatus;
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  if (!canSetStatus(req.user!.role, status)) {
    res.status(403).json({ message: 'Tu rol no puede mover la solicitud a ese estado.' });
    return;
  }
  await addTimeline(request.id, status, req.user!.role, String(req.body?.label ?? 'Estado actualizado.'));
  const updated = (await getRequest(request.id))!;
  await audit(req, 'request.status', 'request', request.id, { status });
  void broadcast({
    role: 'todos',
    title: 'Solicitud actualizada',
    message: `${request.title} ahora esta en estado ${status.replace('_', ' ')}.`
  });
  res.json(envelope(updated));
});

app.post('/api/requests/:id/quote', requireAuth(['proveedor']), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  const provider = req.user!.providerId ? await getProvider(req.user!.providerId) : undefined;
  if (!request || !provider || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos la solicitud o el proveedor.' });
    return;
  }
  if (provider.subscription.status !== 'activa') {
    res.status(402).json({ message: 'Necesitas una suscripcion activa para cotizar.' });
    return;
  }
  if (!provider.categoryIds.includes(request.categoryId)) {
    res.status(403).json({ message: 'Tu perfil no cubre la categoria de esta solicitud.' });
    return;
  }
  const updated = await storeQuoteRequest(
    request.id,
    provider,
    Number(req.body?.amount ?? request.budget),
    String(req.body?.message ?? 'Puedo realizar el servicio en la fecha solicitada.')
  );
  await audit(req, 'request.quote', 'request', request.id, { amount: updated.quote?.amount });
  void broadcast({
    role: 'cliente',
    title: 'Cotizacion recibida',
    message: `${provider.name} cotizo ${money(updated.quote?.amount ?? updated.budget)} para ${updated.title}.`
  });
  res.json(envelope(updated));
});

app.post('/api/requests/:id/accept', requireAuth(['proveedor']), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  const provider = req.user!.providerId ? await getProvider(req.user!.providerId) : undefined;
  if (!request || !provider || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos la solicitud o el proveedor.' });
    return;
  }
  if (provider.subscription.status !== 'activa') {
    res.status(402).json({ message: 'La suscripcion debe estar activa para aceptar trabajos.' });
    return;
  }
  if (!provider.categoryIds.includes(request.categoryId)) {
    res.status(403).json({ message: 'Tu perfil no cubre la categoria de esta solicitud.' });
    return;
  }
  const updated = await storeAcceptRequest(
    request.id,
    provider,
    Number(req.body?.amount ?? request.budget),
    String(req.body?.message ?? 'Acepto el trabajo con el presupuesto indicado.')
  );
  await audit(req, 'request.accept', 'request', request.id, { providerId: provider.id });
  void broadcast({
    role: 'cliente',
    title: 'Proveedor asignado',
    message: `${provider.name} acepto tu solicitud ${request.title}.`
  });
  res.json(envelope(updated));
});

app.get('/api/requests/:id/messages', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  res.json(envelope(await listMessages(request.id)));
});

app.post('/api/requests/:id/messages', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  if (!req.body?.message) {
    res.status(400).json({ message: 'Escribe un mensaje para enviarlo.' });
    return;
  }
  const message = await insertMessage({
    requestId: request.id,
    senderRole: req.user!.role,
    senderName: req.user!.name,
    message: String(req.body.message)
  });
  await audit(req, 'chat.message', 'request', request.id);
  void broadcast({
    role: 'todos',
    title: 'Nuevo mensaje',
    message: `Mensaje nuevo en ${request.title}.`
  });
  res.status(201).json(envelope(message));
});

app.post('/api/requests/:id/escrow', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  const action = String(req.body?.action ?? '');
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }

  try {
    if (action === 'pay') {
      if (req.user!.role !== 'cliente') {
        res.status(403).json({ message: 'Solo el cliente puede pagar en escrow.' });
        return;
      }
      const checkout = await createCheckout({
        kind: 'escrow',
        title: `Escrow App Proveedores: ${request.title}`,
        amount: Number(req.body?.amount ?? request.quote?.amount ?? request.budget),
        user: req.user!,
        request
      });
      await audit(req, 'payment.escrow.create', 'request', request.id, { paymentId: checkout.payment.id, provider: checkout.payment.provider });
      void broadcast({
        role: 'todos',
        title: 'Escrow actualizado',
        message: `${request.title}: pago ${checkout.payment.status === 'paid' ? 'confirmado' : 'pendiente de checkout'}.`
      });
      res.json(envelope(checkout));
      return;
    }

    if (action === 'release' && ['cliente', 'admin'].includes(req.user!.role)) {
      const updated = await updateRequestEscrow(
        request.id,
        request.escrow.amount || request.quote?.amount || request.budget,
        'liberado',
        'cerrada',
        req.user!.role,
        'Pago liberado al proveedor.'
      );
      await audit(req, 'payment.escrow.release', 'request', request.id);
      void broadcast({ role: 'todos', title: 'Pago liberado', message: `${request.title}: pago liberado al proveedor.` });
      res.json(envelope({ payment: undefined, request: updated }));
      return;
    }

    if (action === 'refund' && req.user!.role === 'admin') {
      const updated = await updateRequestEscrow(
        request.id,
        request.escrow.amount || request.quote?.amount || request.budget,
        'reembolsado',
        'reembolso',
        'admin',
        'Admin resolvio reembolso al cliente.'
      );
      await applyRefund(String(req.body?.paymentId ?? ''));
      await audit(req, 'payment.escrow.refund', 'request', request.id);
      void broadcast({ role: 'todos', title: 'Reembolso aplicado', message: `${request.title}: admin marco reembolso.` });
      res.json(envelope({ payment: undefined, request: updated }));
      return;
    }

    res.status(403).json({ message: 'No tienes permisos para esta accion de pago.' });
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : 'No pudimos crear el pago.' });
  }
});

app.post('/api/requests/:id/review', requireAuth(['cliente']), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  const updated = await reviewRequest(request.id, Number(req.body?.rating ?? 5), String(req.body?.comment ?? 'Servicio completado correctamente.'));
  await audit(req, 'request.review', 'request', request.id, { rating: updated.review?.rating });
  res.json(envelope(updated));
});

app.post('/api/requests/:id/dispute', requireAuth(['cliente']), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  const updated = await disputeRequest(request.id, String(req.body?.reason ?? 'El cliente solicito revision del servicio.'));
  await audit(req, 'request.dispute', 'request', request.id);
  void broadcast({
    role: 'admin',
    title: 'Disputa abierta',
    message: `${request.title} requiere resolucion del equipo admin.`
  });
  res.json(envelope(updated));
});

app.get('/api/requests/:id/documents', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  res.json(envelope(await listSupportDocuments(request.id)));
});

app.post('/api/requests/:id/documents', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  const doc = await insertSupportDocument({
    requestId: request.id,
    uploadedBy: req.user!.id,
    docType: req.body?.docType ?? 'evidencia',
    fileName: String(req.body?.fileName ?? 'evidencia'),
    fileUrl: String(req.body?.fileUrl ?? ''),
    storageProvider: req.body?.storageProvider ?? 'url',
    objectKey: req.body?.objectKey,
    uploadStatus: req.body?.uploadStatus ?? 'attached'
  });
  await audit(req, 'support.document.create', 'request', request.id, { documentId: doc.id });
  res.status(201).json(envelope(doc));
});

app.post('/api/requests/:id/upload-target', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !canAccessRequest(req.user!, request)) {
    res.status(404).json({ message: 'No encontramos esta solicitud.' });
    return;
  }
  try {
    const target = await createDocumentUploadTarget({
      user: req.user!,
      requestId: request.id,
      fileName: String(req.body?.fileName ?? 'evidencia'),
      contentType: String(req.body?.contentType ?? 'application/octet-stream'),
      provider: req.body?.provider
    });
    await audit(req, 'support.document.uploadTarget', 'request', request.id, { provider: target.provider, objectKey: target.objectKey });
    res.json(envelope(target));
  } catch (err) {
    res.status(400).json({ message: err instanceof Error ? err.message : 'Storage no configurado.' });
  }
});

app.get('/api/providers/me', requireAuth(['proveedor']), async (req: AuthenticatedRequest, res) => {
  const provider = req.user!.providerId ? await getProvider(req.user!.providerId) : undefined;
  if (!provider) {
    res.status(404).json({ message: 'No encontramos el proveedor.' });
    return;
  }
  res.json(envelope(provider));
});

app.get('/api/providers', requireAuth(['admin']), async (_req, res) => {
  res.json(envelope(await listProviders()));
});

app.patch('/api/providers/:id/location', requireAuth(['proveedor', 'admin']), async (req: AuthenticatedRequest, res) => {
  if (req.user!.role === 'proveedor' && req.params.id !== req.user!.providerId) {
    res.status(403).json({ message: 'Solo puedes actualizar tu propia ubicacion.' });
    return;
  }
  const provider = await getProvider(req.params.id);
  if (!provider) {
    res.status(404).json({ message: 'No encontramos el proveedor.' });
    return;
  }
  const updated = await updateProviderLocation(
    provider.id,
    Number(req.body?.lat ?? provider.location.lat),
    Number(req.body?.lng ?? provider.location.lng),
    String(req.body?.address ?? provider.location.address)
  );
  await audit(req, 'provider.location.update', 'provider', provider.id);
  void broadcast({
    role: 'proveedor',
    title: 'Ubicacion actualizada',
    message: 'Tu radio de solicitudes se recalculo con la nueva ubicacion.'
  });
  res.json(envelope(updated));
});

app.post('/api/providers/:id/subscription/pay', requireAuth(['proveedor']), async (req: AuthenticatedRequest, res) => {
  if (req.params.id !== req.user!.providerId) {
    res.status(403).json({ message: 'Solo puedes pagar tu propia suscripcion.' });
    return;
  }
  const provider = await getProvider(req.params.id);
  if (!provider) {
    res.status(404).json({ message: 'No encontramos el proveedor.' });
    return;
  }
  try {
    const plan = String(req.body?.plan ?? provider.subscription.plan) as Provider['subscription']['plan'];
    const price = Number(req.body?.price ?? provider.subscription.price);
    const checkout = await createCheckout({
      kind: 'subscription',
      title: `Suscripcion App Proveedores ${plan}`,
      amount: price,
      user: req.user!,
      provider,
      plan,
      price
    });
    await audit(req, 'payment.subscription.create', 'provider', provider.id, { paymentId: checkout.payment.id });
    void broadcast({
      role: 'proveedor',
      title: checkout.payment.status === 'paid' ? 'Suscripcion activa' : 'Checkout de suscripcion creado',
      message:
        checkout.payment.status === 'paid'
          ? `Tu plan ${plan} quedo activo.`
          : `Completa el checkout para activar tu plan ${plan}.`
    });
    res.json(envelope(checkout));
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : 'No pudimos crear la suscripcion.' });
  }
});

app.get('/api/admin/metrics', requireAuth(['admin']), async (_req, res) => {
  res.json(envelope(await metrics()));
});

app.get('/api/admin/disputes', requireAuth(['admin']), async (_req, res) => {
  res.json(envelope(await listDisputes()));
});

app.patch('/api/admin/providers/:id/verify', requireAuth(['admin']), async (req: AuthenticatedRequest, res) => {
  const provider = await getProvider(req.params.id);
  if (!provider) {
    res.status(404).json({ message: 'No encontramos el proveedor.' });
    return;
  }
  const updated = await verifyProvider(provider.id, Boolean(req.body?.verified ?? true));
  await audit(req, 'admin.provider.verify', 'provider', provider.id, { verified: updated.verified });
  void broadcast({
    role: 'proveedor',
    title: updated.verified ? 'Proveedor verificado' : 'Verificacion pausada',
    message: `${updated.name} cambio su estatus de verificacion.`
  });
  res.json(envelope(updated));
});

app.patch('/api/admin/disputes/:id', requireAuth(['admin']), async (req: AuthenticatedRequest, res) => {
  const request = await getRequest(req.params.id);
  if (!request || !request.dispute) {
    res.status(404).json({ message: 'No encontramos esta disputa.' });
    return;
  }
  const resolution = req.body?.resolution === 'refund' ? 'refund' : 'release';
  const updated = await resolveDispute(request.id, resolution);
  await audit(req, 'admin.dispute.resolve', 'request', request.id, { resolution });
  void broadcast({
    role: 'todos',
    title: 'Disputa resuelta',
    message: `${request.title} fue resuelta por operaciones.`
  });
  res.json(envelope(updated));
});

app.get('/api/admin/audit', requireAuth(['admin']), async (_req, res) => {
  res.json(envelope(await listAuditLogs()));
});

app.get('/api/admin/fraud', requireAuth(['admin']), async (_req, res) => {
  res.json(envelope(await listFraudSignals()));
});

app.get('/api/admin/payments', requireAuth(['admin']), async (_req, res) => {
  res.json(envelope(await listPayments()));
});

app.post('/api/admin/payments/reconcile', requireAuth(['admin']), async (req: AuthenticatedRequest, res) => {
  const result = await reconcilePendingPayments();
  await audit(req, 'admin.payments.reconcile', 'payment', undefined, { reconciled: result.length });
  res.json(envelope(result));
});

app.get('/api/admin/support-documents', requireAuth(['admin']), async (_req, res) => {
  res.json(envelope(await listSupportDocuments()));
});

app.get('/api/admin/runtime-config', requireAuth(['admin']), (_req, res) => {
  res.json(envelope({ services: configuredServices(), nodeEnv: process.env.NODE_ENV ?? 'development' }));
});

app.get('/api/insights/heatmap', requireAuth(), async (_req, res) => {
  res.json(envelope(await listHeatPoints()));
});

app.get('/events', requireAuth(), async (req: AuthenticatedRequest, res) => {
  const role = req.user!.role;
  const id = nanoid();
  const lastEventId = Number(req.get('last-event-id') ?? req.query.lastEventId ?? 0);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ id, role, timestamp: new Date().toISOString() })}\n\n`);

  if (Number.isFinite(lastEventId) && lastEventId > 0) {
    const missedEvents = await eventsAfter(lastEventId, role);
    missedEvents.forEach((event) => {
      res.write(`id: ${event.seq}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    });
  }

  clients.set(id, {
    id,
    role,
    write: (payload) => res.write(payload)
  });

  req.on('close', () => {
    clients.delete(id);
    setActiveSseConnections(clients.size);
  });
  setActiveSseConnections(clients.size);
});

const distDir = join(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/metrics' || req.path === '/events') {
      next();
      return;
    }
    res.sendFile(join(distDir, 'index.html'));
  });
}

setInterval(() => {
  for (const client of clients.values()) {
    client.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
  }
}, 25_000).unref();

app.listen(port, () => {
  logger.info(`API App Proveedores lista en http://localhost:${port}`);
});
