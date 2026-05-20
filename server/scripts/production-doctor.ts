import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import Stripe from 'stripe';

type Status = 'ok' | 'warn' | 'fail' | 'skip';

type Check = {
  name: string;
  status: Status;
  detail: string;
};

const live = process.argv.includes('--live');
const checks: Check[] = [];

function has(...names: string[]) {
  return names.every((name) => Boolean(process.env[name]));
}

function add(name: string, status: Status, detail: string) {
  checks.push({ name, status, detail });
}

function httpsUrl(value: string | undefined) {
  return Boolean(value?.startsWith('https://'));
}

function publicWebhookUrl(path: string) {
  return `${process.env.PUBLIC_WEBHOOK_BASE_URL?.replace(/\/$/, '')}${path}`;
}

async function liveCheck(name: string, enabled: boolean, fn: () => Promise<void>) {
  if (!live) {
    add(name, enabled ? 'warn' : 'skip', enabled ? 'Configurado; ejecuta con --live para validar contra el proveedor.' : 'No configurado.');
    return;
  }
  if (!enabled) {
    add(name, 'skip', 'No configurado.');
    return;
  }
  try {
    await fn();
    add(name, 'ok', 'Validacion live completada.');
  } catch (err) {
    add(name, 'fail', err instanceof Error ? err.message : 'Validacion live fallo.');
  }
}

add('JWT_SECRET', has('JWT_SECRET') && !process.env.JWT_SECRET?.includes('change-me') ? 'ok' : 'fail', 'Debe ser un secreto fuerte y distinto al ejemplo.');
add(
  'REFRESH_SECRET',
  has('REFRESH_SECRET') && !process.env.REFRESH_SECRET?.includes('change-me') ? 'ok' : 'fail',
  'Debe ser un secreto fuerte y distinto al ejemplo.'
);
add('APP_ORIGIN', httpsUrl(process.env.APP_ORIGIN) ? 'ok' : 'fail', 'Debe apuntar al dominio publico HTTPS.');
add('PUBLIC_WEBHOOK_BASE_URL', httpsUrl(process.env.PUBLIC_WEBHOOK_BASE_URL) ? 'ok' : 'fail', 'Debe ser HTTPS para webhooks reales.');
add('POSTGRES_URL', has('POSTGRES_URL') ? 'ok' : 'fail', 'Necesario para runtime Postgres multiinstancia.');

await liveCheck('Stripe', has('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'), async () => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  await stripe.balance.retrieve();
});

await liveCheck('Stripe webhook endpoint', has('PUBLIC_WEBHOOK_BASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'), async () => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const payload = JSON.stringify({
    id: 'evt_conectapro_smoke',
    object: 'event',
    type: 'ping',
    data: { object: { id: 'smoke' } }
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!
  });
  const response = await fetch(publicWebhookUrl('/api/webhooks/stripe'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature
    },
    body: payload
  });
  if (!response.ok) throw new Error(`Webhook Stripe respondio ${response.status}`);
});

await liveCheck('Mercado Pago', has('MERCADOPAGO_ACCESS_TOKEN'), async () => {
  const response = await fetch('https://api.mercadopago.com/users/me', {
    headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
  });
  if (!response.ok) throw new Error(`Mercado Pago respondio ${response.status}`);
});

await liveCheck('Mercado Pago webhook endpoint', has('PUBLIC_WEBHOOK_BASE_URL', 'MERCADOPAGO_ACCESS_TOKEN'), async () => {
  const response = await fetch(publicWebhookUrl('/api/webhooks/mercadopago'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'payment', data: {} })
  });
  if (!response.ok) throw new Error(`Webhook Mercado Pago respondio ${response.status}`);
});

await liveCheck('Mapbox', has('VITE_MAPBOX_TOKEN'), async () => {
  const url = new URL('https://api.mapbox.com/geocoding/v5/mapbox.places/CDMX.json');
  url.searchParams.set('access_token', process.env.VITE_MAPBOX_TOKEN!);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mapbox respondio ${response.status}`);
});

add('Google OAuth', has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_REDIRECT_BASE_URL') ? 'ok' : 'warn', 'Requiere redirect URI registrado.');
add(
  'Apple OAuth',
  has('APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID') && Boolean(process.env.APPLE_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY_PATH) ? 'ok' : 'warn',
  'Requiere Service ID, Team ID, Key ID y private key.'
);

await liveCheck('S3', has('AWS_REGION', 'AWS_S3_BUCKET'), async () => {
  const client = new S3Client({ region: process.env.AWS_REGION });
  await client.send(new HeadBucketCommand({ Bucket: process.env.AWS_S3_BUCKET! }));
});

await liveCheck('Cloudinary', Boolean(process.env.CLOUDINARY_URL || has('CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET')), async () => {
  if (!process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
  }
  await cloudinary.api.ping();
});

add('OTLP', has('OTEL_EXPORTER_OTLP_ENDPOINT') ? 'ok' : 'warn', 'Configura endpoint del proveedor de observabilidad para trazas/metricas.');
add('STAGING_URL', httpsUrl(process.env.STAGING_URL) ? 'ok' : 'warn', 'URL HTTPS de staging para smoke tests.');
add('CUSTOM_DOMAIN', has('CUSTOM_DOMAIN') ? 'ok' : 'warn', 'Dominio final pendiente si no esta definido.');

const icon: Record<Status, string> = { ok: 'OK', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };
for (const check of checks) {
  console.log(`${icon[check.status]} ${check.name}: ${check.detail}`);
}

const failures = checks.filter((check) => check.status === 'fail');
if (failures.length) {
  console.error(`\n${failures.length} checks fallaron. Completa secretos/URLs antes de produccion.`);
  process.exitCode = 1;
}
