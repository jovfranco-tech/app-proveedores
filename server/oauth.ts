import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { createAuthPayload } from './auth';
import { upsertOAuthUser } from './db';
import type { AuthPayload } from '../src/types';

type OAuthProvider = 'google' | 'apple';

const googleIssuer = 'https://accounts.google.com';
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleIssuer = 'https://appleid.apple.com';
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function baseUrl(req: Request) {
  return process.env.OAUTH_REDIRECT_BASE_URL ?? `${req.protocol}://${req.get('host')}`;
}

function callbackUrl(req: Request, provider: OAuthProvider) {
  return `${baseUrl(req)}/api/auth/oauth/${provider}/callback`;
}

function randomState() {
  return randomBytes(24).toString('base64url');
}

function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function oauthCookieName(provider: OAuthProvider) {
  return `oauth_${provider}_state`;
}

function codeCookieName(provider: OAuthProvider) {
  return `oauth_${provider}_verifier`;
}

function secureCookie() {
  return process.env.NODE_ENV === 'production';
}

export function oauthStart(provider: OAuthProvider, req: Request, res: Response) {
  const state = randomState();
  const verifier = randomState();
  const redirectUri = callbackUrl(req, provider);

  res.cookie(oauthCookieName(provider), state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie(),
    path: `/api/auth/oauth/${provider}`,
    maxAge: 10 * 60 * 1000
  });
  res.cookie(codeCookieName(provider), verifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie(),
    path: `/api/auth/oauth/${provider}`,
    maxAge: 10 * 60 * 1000
  });

  if (provider === 'google') {
    if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID no esta configurado.');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'select_account'
    }).toString();
    return url.toString();
  }

  if (!process.env.APPLE_CLIENT_ID) throw new Error('APPLE_CLIENT_ID no esta configurado.');
  const url = new URL('https://appleid.apple.com/auth/authorize');
  url.search = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    state
  }).toString();
  return url.toString();
}

async function appleClientSecret() {
  const privateKey = process.env.APPLE_PRIVATE_KEY ?? (process.env.APPLE_PRIVATE_KEY_PATH && existsSync(process.env.APPLE_PRIVATE_KEY_PATH)
    ? readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, 'utf8')
    : undefined);
  if (!privateKey || !process.env.APPLE_TEAM_ID || !process.env.APPLE_KEY_ID || !process.env.APPLE_CLIENT_ID) {
    throw new Error('Configuracion de Apple OAuth incompleta.');
  }
  const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.APPLE_KEY_ID })
    .setIssuer(process.env.APPLE_TEAM_ID)
    .setAudience('https://appleid.apple.com')
    .setSubject(process.env.APPLE_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('180d')
    .sign(key);
}

async function exchangeCode(provider: OAuthProvider, code: string, verifier: string, redirectUri: string) {
  const tokenEndpoint = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://appleid.apple.com/auth/token';
  const clientId = provider === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.APPLE_CLIENT_ID;
  const clientSecret = provider === 'google' ? process.env.GOOGLE_CLIENT_SECRET : await appleClientSecret();

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
  });
  if (!response.ok) {
    throw new Error(`OAuth ${provider} rechazo el codigo: ${await response.text()}`);
  }
  return (await response.json()) as { id_token?: string };
}

export async function oauthCallback(provider: OAuthProvider, req: Request, res: Response): Promise<AuthPayload> {
  const state = String(req.body?.state ?? req.query.state ?? '');
  const code = String(req.body?.code ?? req.query.code ?? '');
  const expectedState = req.cookies?.[oauthCookieName(provider)];
  const verifier = req.cookies?.[codeCookieName(provider)];
  if (!state || !code || state !== expectedState || !verifier) {
    throw new Error('Estado OAuth invalido o expirado.');
  }

  const redirectUri = callbackUrl(req, provider);
  const tokenResponse = await exchangeCode(provider, code, verifier, redirectUri);
  if (!tokenResponse.id_token) throw new Error('OAuth no regreso id_token.');

  const clientId = provider === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.APPLE_CLIENT_ID;
  const { payload } = await jwtVerify(tokenResponse.id_token, provider === 'google' ? googleJwks : appleJwks, {
    issuer: provider === 'google' ? googleIssuer : appleIssuer,
    audience: clientId
  });
  const email = String(payload.email ?? '');
  const subject = String(payload.sub ?? '');
  if (!email || !subject) throw new Error('OAuth no regreso email o sujeto valido.');

  const user = await upsertOAuthUser({
    provider,
    subject,
    email,
    name: typeof payload.name === 'string' ? payload.name : undefined
  });

  res.clearCookie(oauthCookieName(provider), { path: `/api/auth/oauth/${provider}` });
  res.clearCookie(codeCookieName(provider), { path: `/api/auth/oauth/${provider}` });
  return createAuthPayload(user, req, res);
}
