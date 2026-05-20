import Stripe from 'stripe';
import { configuredServices } from './config';
import {
  getPayment,
  getPaymentByProviderRef,
  getRequest,
  insertPayment,
  updatePaymentProviderData,
  updatePaymentStatus,
  updateRequestEscrow,
  updateSubscription
} from './db';
import type { PaymentCheckout, PaymentRecord, Provider, ServiceRequest, UserSession } from '../src/types';

type CheckoutInput = {
  kind: 'escrow' | 'subscription';
  amount: number;
  title: string;
  user: UserSession;
  request?: ServiceRequest;
  provider?: Provider;
  plan?: Provider['subscription']['plan'];
  price?: number;
};

const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const webhookBase = process.env.PUBLIC_WEBHOOK_BASE_URL ?? origin;

function selectedProvider(): PaymentRecord['provider'] {
  const provider = process.env.PAYMENT_PROVIDER;
  if (provider === 'stripe' && process.env.STRIPE_SECRET_KEY) return 'stripe';
  if (provider === 'mercadopago' && process.env.MERCADOPAGO_ACCESS_TOKEN) return 'mercadopago';
  return 'local';
}

async function createBasePayment(input: CheckoutInput, provider: PaymentRecord['provider'], status: PaymentRecord['status']): Promise<PaymentRecord> {
  return insertPayment({
    kind: input.kind,
    requestId: input.request?.id,
    providerId: input.provider?.id,
    userId: input.user.id,
    provider,
    amount: input.amount,
    currency: 'MXN',
    status
  });
}

export async function createCheckout(input: CheckoutInput): Promise<PaymentCheckout> {
  const provider = selectedProvider();

  if (provider === 'local') {
    const payment = await createBasePayment(input, 'local', 'paid');
    return applyPaidPayment(payment.id, {
      plan: input.plan,
      price: input.price
    });
  }

  if (provider === 'stripe') {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const payment = await createBasePayment(input, 'stripe', 'requires_action');
    const priceId = input.kind === 'subscription' ? process.env.STRIPE_SUBSCRIPTION_PRICE_ID : undefined;
    const session = await stripe.checkout.sessions.create({
      mode: priceId ? 'subscription' : 'payment',
      line_items: priceId
        ? [{ price: priceId, quantity: 1 }]
        : [
            {
              price_data: {
                currency: 'mxn',
                product_data: { name: input.title },
                unit_amount: Math.round(input.amount * 100)
              },
              quantity: 1
            }
          ],
      success_url: `${origin}/?payment=success&payment_id=${payment.id}`,
      cancel_url: `${origin}/?payment=cancel&payment_id=${payment.id}`,
      metadata: {
        localPaymentId: payment.id,
        kind: input.kind,
        requestId: input.request?.id ?? '',
        providerId: input.provider?.id ?? '',
        plan: input.plan ?? ''
      }
    });
    const updated = (await updatePaymentProviderData(payment.id, session.id, session.url ?? undefined, session)) ?? payment;
    return { payment: updated };
  }

  const payment = await createBasePayment(input, 'mercadopago', 'requires_action');
  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: [
        {
          title: input.title,
          quantity: 1,
          currency_id: 'MXN',
          unit_price: input.amount
        }
      ],
      external_reference: payment.id,
      notification_url: `${webhookBase}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${origin}/?payment=success&payment_id=${payment.id}`,
        failure: `${origin}/?payment=failure&payment_id=${payment.id}`,
        pending: `${origin}/?payment=pending&payment_id=${payment.id}`
      },
      auto_return: 'approved'
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Mercado Pago rechazo la preferencia: ${detail}`);
  }
  const preference = (await response.json()) as { id: string; init_point?: string; sandbox_init_point?: string };
  const updated = (await updatePaymentProviderData(payment.id, preference.id, preference.init_point ?? preference.sandbox_init_point, preference)) ?? payment;
  return { payment: updated };
}

export async function applyPaidPayment(paymentId: string, options?: { plan?: Provider['subscription']['plan']; price?: number }): Promise<PaymentCheckout> {
  const payment = (await updatePaymentStatus(paymentId, 'paid')) ?? (await getPayment(paymentId));
  if (!payment) throw new Error('Pago no encontrado.');

  if (payment.kind === 'subscription' && payment.providerId) {
    const provider = await updateSubscription(payment.providerId, options?.plan ?? 'Pro', options?.price ?? payment.amount, 'activa');
    return { payment, provider };
  }

  if (payment.kind === 'escrow' && payment.requestId) {
    const request = await getRequest(payment.requestId);
    if (!request) throw new Error('Solicitud no encontrada para pago.');
    const next = await updateRequestEscrow(
      request.id,
      payment.amount,
      'retenido',
      'aceptada',
      'cliente',
      'El cliente deposito el pago en escrow mediante pasarela.'
    );
    return { payment, request: next };
  }

  return { payment };
}

export function applyRefund(paymentId: string) {
  return updatePaymentStatus(paymentId, 'refunded');
}

export async function handleStripeWebhook(rawBody: Buffer, signature?: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const event = secret && signature ? stripe.webhooks.constructEvent(rawBody, signature, secret) : JSON.parse(rawBody.toString());

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const localPaymentId = session.metadata?.localPaymentId;
    if (localPaymentId) {
      return applyPaidPayment(localPaymentId);
    }
    if (session.id) {
      const payment = await getPaymentByProviderRef('stripe', session.id);
      if (payment) return applyPaidPayment(payment.id);
    }
  }

  return undefined;
}

export async function handleMercadoPagoWebhook(body: unknown) {
  const payload = body as { data?: { id?: string }; id?: string; topic?: string; type?: string };
  const paymentId = payload.data?.id ?? payload.id;
  if (!paymentId || !process.env.MERCADOPAGO_ACCESS_TOKEN) return undefined;

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
  });
  if (!response.ok) return undefined;
  const payment = (await response.json()) as { status?: string; external_reference?: string; id?: string };

  if (payment.status === 'approved' && payment.external_reference) {
    await updatePaymentProviderData(payment.external_reference, String(payment.id ?? paymentId), undefined, payment);
    return applyPaidPayment(payment.external_reference);
  }

  if (payment.external_reference) {
    await updatePaymentStatus(payment.external_reference, payment.status === 'rejected' ? 'failed' : 'pending', payment);
  }
  return undefined;
}

export async function reconcilePendingPayments() {
  const pending = await import('./db').then((mod) => mod.listPayments('requires_action'));
  const results: PaymentRecord[] = [];

  for (const payment of pending) {
    if (payment.provider === 'stripe' && process.env.STRIPE_SECRET_KEY && payment.providerRef) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(payment.providerRef);
      if (session.payment_status === 'paid') {
        results.push((await applyPaidPayment(payment.id)).payment);
      }
    }
    if (payment.provider === 'mercadopago' && process.env.MERCADOPAGO_ACCESS_TOKEN && payment.providerRef) {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(payment.id)}`, {
        headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
      });
      if (response.ok) {
        const search = (await response.json()) as { results?: Array<{ id?: string; status?: string }> };
        const approved = search.results?.find((item) => item.status === 'approved' && item.id);
        if (approved?.id) await handleMercadoPagoWebhook({ data: { id: String(approved.id) } });
      }
      const updated = await getPayment(payment.id);
      if (updated) results.push(updated);
    }
  }

  return results;
}

export function paymentRuntimeConfig() {
  return {
    paymentProvider: selectedProvider(),
    mapboxToken: process.env.VITE_MAPBOX_TOKEN,
    sseReplay: true,
    services: configuredServices()
  };
}
