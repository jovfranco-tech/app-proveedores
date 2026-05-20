import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import Stripe from 'stripe';

initializeApp();

const appOrigin = defineString('APP_ORIGIN', { default: 'https://app-proveedores.vercel.app' });
const paymentProvider = defineString('PAYMENT_PROVIDER', { default: 'local' });
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const mercadoPagoAccessToken = defineSecret('MERCADOPAGO_ACCESS_TOKEN');
const mercadoPagoWebhookSecret = defineSecret('MERCADOPAGO_WEBHOOK_SECRET');

type Role = 'cliente' | 'proveedor' | 'admin';
type EscrowAction = 'pay' | 'release' | 'refund';
type PaymentStatus = 'pending' | 'requires_action' | 'paid' | 'failed' | 'refunded';

interface ServiceRequestData {
  clientId?: string;
  providerId?: string;
  budget?: number;
  status?: string;
  quote?: {
    amount?: number;
  };
  escrow?: {
    amount?: number;
    status?: string;
  };
}

interface PaymentRecord {
  id: string;
  kind: 'escrow' | 'subscription';
  requestId?: string;
  providerId?: string | null;
  userId?: string;
  provider: 'local' | 'stripe' | 'mercadopago';
  providerRef?: string;
  amount: number;
  currency: 'MXN';
  status: PaymentStatus;
  checkoutUrl?: string | null;
  rawPayload?: unknown;
  createdAt: string;
  updatedAt: string;
}

async function requireUser(req: Request) {
  const header = req.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) throw new Error('missing-auth-token');
  return getAuth().verifyIdToken(token);
}

function json(res: Parameters<Parameters<typeof onRequest>[0]>[1], status: number, payload: unknown) {
  res.status(status).json(payload);
}

function rawBody(req: Request) {
  const body = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!body) throw new Error('Raw body no disponible para validar firma.');
  return body;
}

function getStripe() {
  const secret = stripeSecretKey.value();
  if (!secret) throw new Error('STRIPE_SECRET_KEY no esta configurado.');
  return new Stripe(secret, { apiVersion: '2026-04-22.dahlia' });
}

async function writeAudit(input: {
  actorUserId?: string;
  actorRole?: Role;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  await getFirestore().collection('auditLogs').add({
    ...input,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
    createdAtServer: FieldValue.serverTimestamp()
  });
}

function paymentAmount(serviceRequest: ServiceRequestData, requestedAmount?: number) {
  return requestedAmount ?? serviceRequest.escrow?.amount ?? serviceRequest.quote?.amount ?? serviceRequest.budget ?? 0;
}

function applyEscrowTransaction(
  transaction: Transaction,
  requestRef: DocumentReference,
  paymentRef: DocumentReference,
  serviceRequest: ServiceRequestData,
  payment: PaymentRecord,
  escrowStatus: 'retenido' | 'liberado' | 'reembolsado'
) {
  transaction.set(paymentRef, payment, { merge: true });
  transaction.update(requestRef, {
    escrow: { amount: payment.amount, status: escrowStatus },
    updatedAt: new Date().toISOString()
  });
}

async function createLocalEscrowPayment(actorUid: string, requestId: string, serviceRequest: ServiceRequestData, action: EscrowAction, amount?: number) {
  const db = getFirestore();
  const paymentRef = db.collection('payments').doc();
  const requestRef = db.collection('serviceRequests').doc(requestId);
  const nextEscrow = action === 'pay' ? 'retenido' : action === 'release' ? 'liberado' : 'reembolsado';
  const payment: PaymentRecord = {
    id: paymentRef.id,
    kind: 'escrow',
    requestId,
    providerId: serviceRequest.providerId ?? null,
    userId: actorUid,
    provider: 'local',
    amount: paymentAmount(serviceRequest, amount),
    currency: 'MXN',
    status: action === 'refund' ? 'refunded' : 'paid',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await db.runTransaction(async (transaction) => {
    applyEscrowTransaction(transaction, requestRef, paymentRef, serviceRequest, payment, nextEscrow);
  });

  return payment;
}

async function createStripeCheckout(actorUid: string, requestId: string, serviceRequest: ServiceRequestData, amount?: number) {
  const db = getFirestore();
  const stripe = getStripe();
  const paymentRef = db.collection('payments').doc();
  const total = paymentAmount(serviceRequest, amount);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: `${appOrigin.value()}/?payment=success&requestId=${encodeURIComponent(requestId)}`,
    cancel_url: `${appOrigin.value()}/?payment=cancelled&requestId=${encodeURIComponent(requestId)}`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'mxn',
          unit_amount: Math.round(total * 100),
          product_data: { name: `Escrow App Proveedores ${requestId}` }
        }
      }
    ],
    metadata: {
      paymentId: paymentRef.id,
      requestId,
      userId: actorUid,
      providerId: serviceRequest.providerId ?? ''
    },
    payment_intent_data: {
      metadata: {
        paymentId: paymentRef.id,
        requestId,
        userId: actorUid,
        providerId: serviceRequest.providerId ?? ''
      }
    }
  });

  const payment: PaymentRecord = {
    id: paymentRef.id,
    kind: 'escrow',
    requestId,
    providerId: serviceRequest.providerId ?? null,
    userId: actorUid,
    provider: 'stripe',
    providerRef: session.id,
    amount: total,
    currency: 'MXN',
    status: 'requires_action',
    checkoutUrl: session.url,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await paymentRef.set(payment);
  return payment;
}

async function createMercadoPagoCheckout(actorUid: string, requestId: string, serviceRequest: ServiceRequestData, amount?: number) {
  const accessToken = mercadoPagoAccessToken.value();
  if (!accessToken) throw new Error('MERCADOPAGO_ACCESS_TOKEN no esta configurado.');

  const db = getFirestore();
  const paymentRef = db.collection('payments').doc();
  const total = paymentAmount(serviceRequest, amount);
  const preference = {
    items: [
      {
        title: `Escrow App Proveedores ${requestId}`,
        quantity: 1,
        unit_price: total,
        currency_id: 'MXN'
      }
    ],
    back_urls: {
      success: `${appOrigin.value()}/?payment=success&requestId=${encodeURIComponent(requestId)}`,
      failure: `${appOrigin.value()}/?payment=failure&requestId=${encodeURIComponent(requestId)}`,
      pending: `${appOrigin.value()}/?payment=pending&requestId=${encodeURIComponent(requestId)}`
    },
    metadata: {
      payment_id: paymentRef.id,
      request_id: requestId,
      user_id: actorUid,
      provider_id: serviceRequest.providerId ?? ''
    },
    external_reference: paymentRef.id
  };

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(preference)
  });
  const payload = (await response.json()) as { id?: string; init_point?: string; sandbox_init_point?: string; message?: string };
  if (!response.ok || !payload.id) throw new Error(payload.message ?? 'Mercado Pago no pudo crear la preferencia.');

  const payment: PaymentRecord = {
    id: paymentRef.id,
    kind: 'escrow',
    requestId,
    providerId: serviceRequest.providerId ?? null,
    userId: actorUid,
    provider: 'mercadopago',
    providerRef: payload.id,
    amount: total,
    currency: 'MXN',
    status: 'requires_action',
    checkoutUrl: payload.init_point ?? payload.sandbox_init_point ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await paymentRef.set(payment);
  return payment;
}

async function markEscrowPaidFromTrustedProvider(paymentId: string, providerRef: string, rawPayload: unknown) {
  const db = getFirestore();
  const paymentRef = db.collection('payments').doc(paymentId);

  return db.runTransaction(async (transaction) => {
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists) throw new Error('Pago no encontrado.');
    const payment = paymentSnap.data() as PaymentRecord;
    if (!payment.requestId) throw new Error('Pago sin solicitud asociada.');

    const requestRef = db.collection('serviceRequests').doc(payment.requestId);
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists) throw new Error('Solicitud no encontrada para pago.');

    const updatedPayment: PaymentRecord = {
      ...payment,
      providerRef,
      status: 'paid',
      rawPayload,
      updatedAt: new Date().toISOString()
    };

    transaction.set(paymentRef, updatedPayment, { merge: true });
    transaction.update(requestRef, {
      escrow: { amount: payment.amount, status: 'retenido' },
      status: 'aceptada',
      updatedAt: new Date().toISOString()
    });

    return updatedPayment;
  });
}

function parseMercadoPagoSignature(signatureHeader: string) {
  return signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split('=');
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});
}

function firstQueryString(value: Request['query'][string]) {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function timingSafeHexEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMercadoPagoSignature(input: {
  dataId?: string | string[];
  xRequestId?: string;
  xSignature?: string;
  secret: string;
}) {
  const dataId = Array.isArray(input.dataId) ? input.dataId[0] : input.dataId;
  if (!dataId || !input.xRequestId || !input.xSignature || !input.secret) return false;
  const parts = parseMercadoPagoSignature(input.xSignature);
  if (!parts.ts || !parts.v1) return false;
  const normalizedDataId = dataId.toLowerCase();
  const manifest = `id:${normalizedDataId};request-id:${input.xRequestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', input.secret).update(manifest).digest('hex');
  return timingSafeHexEqual(expected, parts.v1);
}

async function fetchMercadoPagoPayment(paymentId: string) {
  const accessToken = mercadoPagoAccessToken.value();
  if (!accessToken) throw new Error('MERCADOPAGO_ACCESS_TOKEN no esta configurado.');
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = (await response.json()) as {
    id?: number | string;
    status?: string;
    external_reference?: string;
    metadata?: {
      payment_id?: string;
      request_id?: string;
    };
    message?: string;
  };
  if (!response.ok) throw new Error(payload.message ?? 'No pudimos consultar pago en Mercado Pago.');
  return payload;
}

export const setUserRole = onRequest(async (req, res) => {
  try {
    const actor = await requireUser(req);
    if (actor.admin !== true && actor.role !== 'admin') return json(res, 403, { message: 'Admin requerido.' });

    const { uid, role, providerId } = req.body as { uid?: string; role?: Role; providerId?: string };
    if (!uid || !role || !['cliente', 'proveedor', 'admin'].includes(role)) return json(res, 400, { message: 'Payload invalido.' });

    await getAuth().setCustomUserClaims(uid, { role, admin: role === 'admin', providerId: providerId ?? null });
    await getFirestore().collection('users').doc(uid).set({ role, providerId: providerId ?? null, updatedAt: new Date().toISOString() }, { merge: true });
    await writeAudit({ actorUserId: actor.uid, actorRole: 'admin', action: 'user.role.set', entityType: 'user', entityId: uid, metadata: { role } });

    return json(res, 200, { data: { uid, role, providerId: providerId ?? null } });
  } catch (error) {
    return json(res, 401, { message: error instanceof Error ? error.message : 'No autorizado.' });
  }
});

export const escrowPayment = onRequest({ secrets: [stripeSecretKey, mercadoPagoAccessToken] }, async (req, res) => {
  try {
    const actor = await requireUser(req);
    const { requestId, action, amount } = req.body as { requestId?: string; action?: EscrowAction; amount?: number };
    if (!requestId || !action || !['pay', 'release', 'refund'].includes(action)) return json(res, 400, { message: 'Payload invalido.' });

    const db = getFirestore();
    const requestRef = db.collection('serviceRequests').doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) return json(res, 404, { message: 'Solicitud no encontrada.' });
    const serviceRequest = requestSnap.data() as ServiceRequestData;

    const isAdmin = actor.admin === true || actor.role === 'admin';
    if (action === 'pay' && serviceRequest.clientId !== actor.uid && !isAdmin) return json(res, 403, { message: 'Solo el cliente puede iniciar el pago.' });
    if (['release', 'refund'].includes(action) && serviceRequest.clientId !== actor.uid && !isAdmin) return json(res, 403, { message: 'Solo cliente/admin puede mover escrow.' });

    const provider = paymentProvider.value();
    let payment: PaymentRecord;
    if (action === 'pay' && provider === 'stripe') {
      payment = await createStripeCheckout(actor.uid, requestId, serviceRequest, amount);
    } else if (action === 'pay' && provider === 'mercadopago') {
      payment = await createMercadoPagoCheckout(actor.uid, requestId, serviceRequest, amount);
    } else {
      payment = await createLocalEscrowPayment(actor.uid, requestId, serviceRequest, action, amount);
    }

    await writeAudit({ actorUserId: actor.uid, actorRole: (actor.role as Role) ?? undefined, action: `escrow.${action}`, entityType: 'serviceRequest', entityId: requestId, metadata: { paymentId: payment.id, provider: payment.provider } });
    return json(res, 200, { data: { payment } });
  } catch (error) {
    return json(res, 400, { message: error instanceof Error ? error.message : 'No pudimos procesar escrow.' });
  }
});

export const stripeWebhook = onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
  try {
    const signature = req.get('Stripe-Signature');
    if (!signature) return json(res, 400, { message: 'Falta Stripe-Signature.' });

    const event = getStripe().webhooks.constructEvent(rawBody(req), signature, stripeWebhookSecret.value());
    let paymentId: string | undefined;
    let providerRef = event.id;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      paymentId = session.metadata?.paymentId;
      providerRef = session.payment_intent?.toString() ?? session.id;
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      paymentId = intent.metadata?.paymentId;
      providerRef = intent.id;
    }

    if (paymentId) {
      await markEscrowPaidFromTrustedProvider(paymentId, providerRef, event);
    }

    await writeAudit({ action: 'stripe.webhook.verified', entityType: 'payment', entityId: paymentId, metadata: { eventId: event.id, eventType: event.type } });
    return json(res, 200, { received: true });
  } catch (error) {
    await writeAudit({ action: 'stripe.webhook.rejected', entityType: 'payment', metadata: { reason: error instanceof Error ? error.message : 'unknown' } });
    return json(res, 400, { message: error instanceof Error ? error.message : 'Webhook Stripe invalido.' });
  }
});

export const mercadoPagoWebhook = onRequest({ secrets: [mercadoPagoAccessToken, mercadoPagoWebhookSecret] }, async (req, res) => {
  try {
    const verified = verifyMercadoPagoSignature({
      dataId: firstQueryString(req.query['data.id']),
      xRequestId: req.get('x-request-id') ?? undefined,
      xSignature: req.get('x-signature') ?? undefined,
      secret: mercadoPagoWebhookSecret.value()
    });
    if (!verified) return json(res, 400, { message: 'Firma Mercado Pago invalida.' });

    const dataId = firstQueryString(req.query['data.id']);
    if (!dataId) return json(res, 400, { message: 'Falta data.id.' });

    const mercadoPagoPayment = await fetchMercadoPagoPayment(dataId);
    const paymentId = mercadoPagoPayment.metadata?.payment_id ?? mercadoPagoPayment.external_reference;
    if (paymentId && mercadoPagoPayment.status === 'approved') {
      await markEscrowPaidFromTrustedProvider(paymentId, String(mercadoPagoPayment.id ?? dataId), mercadoPagoPayment);
    }

    await writeAudit({ action: 'mercadopago.webhook.verified', entityType: 'payment', entityId: paymentId, metadata: { dataId, status: mercadoPagoPayment.status } });
    return json(res, 200, { received: true });
  } catch (error) {
    await writeAudit({ action: 'mercadopago.webhook.rejected', entityType: 'payment', metadata: { reason: error instanceof Error ? error.message : 'unknown' } });
    return json(res, 400, { message: error instanceof Error ? error.message : 'Webhook Mercado Pago invalido.' });
  }
});
