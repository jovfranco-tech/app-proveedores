import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();

const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const mercadoPagoWebhookSecret = defineSecret('MERCADOPAGO_WEBHOOK_SECRET');

type Role = 'cliente' | 'proveedor' | 'admin';

async function requireUser(req: Parameters<Parameters<typeof onRequest>[0]>[0]) {
  const header = req.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) throw new Error('missing-auth-token');
  return getAuth().verifyIdToken(token);
}

function json(res: Parameters<Parameters<typeof onRequest>[0]>[1], status: number, payload: unknown) {
  res.status(status).json(payload);
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

export const escrowPayment = onRequest(async (req, res) => {
  try {
    const actor = await requireUser(req);
    const { requestId, action, amount } = req.body as { requestId?: string; action?: 'pay' | 'release' | 'refund'; amount?: number };
    if (!requestId || !action || !['pay', 'release', 'refund'].includes(action)) return json(res, 400, { message: 'Payload invalido.' });

    const db = getFirestore();
    const requestRef = db.collection('serviceRequests').doc(requestId);
    const paymentRef = db.collection('payments').doc();

    const result = await db.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) throw new Error('Solicitud no encontrada.');
      const serviceRequest = requestSnap.data() as { clientId?: string; providerId?: string; budget?: number; escrow?: { amount?: number; status?: string } };

      const isAdmin = actor.admin === true || actor.role === 'admin';
      if (action === 'pay' && serviceRequest.clientId !== actor.uid && !isAdmin) throw new Error('Solo el cliente puede iniciar el pago.');
      if (['release', 'refund'].includes(action) && serviceRequest.clientId !== actor.uid && !isAdmin) throw new Error('Solo cliente/admin puede mover escrow.');

      const paymentAmount = amount ?? serviceRequest.escrow?.amount ?? serviceRequest.budget ?? 0;
      const nextEscrow = action === 'pay' ? 'retenido' : action === 'release' ? 'liberado' : 'reembolsado';
      const paymentStatus = action === 'refund' ? 'refunded' : 'paid';

      const payment = {
        id: paymentRef.id,
        kind: 'escrow',
        requestId,
        providerId: serviceRequest.providerId ?? null,
        userId: actor.uid,
        provider: 'local',
        amount: paymentAmount,
        currency: 'MXN',
        status: paymentStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      transaction.set(paymentRef, payment);
      transaction.update(requestRef, {
        escrow: { amount: paymentAmount, status: nextEscrow },
        updatedAt: new Date().toISOString()
      });

      return payment;
    });

    await writeAudit({ actorUserId: actor.uid, actorRole: (actor.role as Role) ?? undefined, action: `escrow.${action}`, entityType: 'serviceRequest', entityId: requestId });
    return json(res, 200, { data: { payment: result } });
  } catch (error) {
    return json(res, 400, { message: error instanceof Error ? error.message : 'No pudimos procesar escrow.' });
  }
});

export const stripeWebhook = onRequest({ secrets: [stripeWebhookSecret] }, async (req, res) => {
  await writeAudit({
    action: 'stripe.webhook.received',
    entityType: 'payment',
    metadata: {
      hasSecret: Boolean(stripeWebhookSecret.value()),
      eventType: req.body?.type ?? 'unknown'
    }
  });
  return json(res, 200, { received: true });
});

export const mercadoPagoWebhook = onRequest({ secrets: [mercadoPagoWebhookSecret] }, async (req, res) => {
  await writeAudit({
    action: 'mercadopago.webhook.received',
    entityType: 'payment',
    metadata: {
      hasSecret: Boolean(mercadoPagoWebhookSecret.value()),
      topic: req.query.topic ?? req.body?.type ?? 'unknown'
    }
  });
  return json(res, 200, { received: true });
});
