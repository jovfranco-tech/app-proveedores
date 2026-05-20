import { existsSync } from 'node:fs';

export type ExternalService = 'stripe' | 'mercadopago' | 'mapbox' | 'googleOAuth' | 'appleOAuth' | 's3' | 'cloudinary' | 'otel';

export function configuredServices(): Record<ExternalService, boolean> {
  return {
    stripe: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    mercadopago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    mapbox: Boolean(process.env.VITE_MAPBOX_TOKEN),
    googleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.OAUTH_REDIRECT_BASE_URL),
    appleOAuth: Boolean(
      process.env.APPLE_CLIENT_ID &&
        process.env.APPLE_TEAM_ID &&
        process.env.APPLE_KEY_ID &&
        (process.env.APPLE_PRIVATE_KEY || (process.env.APPLE_PRIVATE_KEY_PATH && existsSync(process.env.APPLE_PRIVATE_KEY_PATH))) &&
        process.env.OAUTH_REDIRECT_BASE_URL
    ),
    s3: Boolean(process.env.AWS_REGION && process.env.AWS_S3_BUCKET),
    cloudinary: Boolean(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)),
    otel: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  };
}

export function assertRequiredProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('change-me')) missing.push('JWT_SECRET');
  if (!process.env.REFRESH_SECRET || process.env.REFRESH_SECRET.includes('change-me')) missing.push('REFRESH_SECRET');
  if (!process.env.APP_ORIGIN?.startsWith('https://')) missing.push('APP_ORIGIN https');
  if (!process.env.PUBLIC_WEBHOOK_BASE_URL?.startsWith('https://')) missing.push('PUBLIC_WEBHOOK_BASE_URL https');
  if (!process.env.POSTGRES_URL && !process.env.SQLITE_PATH) missing.push('POSTGRES_URL o SQLITE_PATH');

  if (missing.length) {
    throw new Error(`Configuracion de produccion incompleta: ${missing.join(', ')}`);
  }
}
