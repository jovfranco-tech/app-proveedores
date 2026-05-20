import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import {
  getRefreshSession,
  getUserByEmail,
  getUserById,
  revokeRefreshSession,
  saveRefreshSession,
  nowIso
} from './db';
import type { AuthPayload, Role, UserSession } from '../src/types';

const accessSecret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-access-secret-change-before-production-32');
const refreshTtlMs = 7 * 24 * 60 * 60 * 1000;
const accessTtlSeconds = 15 * 60;

export interface AuthenticatedRequest extends Request {
  user?: UserSession;
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function publicUser(row: {
  id: string;
  name: string;
  email: string;
  role: Role;
  provider_id?: string | null;
  providerId?: string;
}): UserSession {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    providerId: row.providerId ?? row.provider_id ?? undefined
  };
}

export async function signAccessToken(user: UserSession) {
  const expiresAt = new Date(Date.now() + accessTtlSeconds * 1000);
  const token = await new SignJWT({
    role: user.role,
    email: user.email,
    providerId: user.providerId
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('app-proveedores-api')
    .setAudience('app-proveedores-web')
    .setIssuedAt()
    .setExpirationTime(`${accessTtlSeconds}s`)
    .sign(accessSecret);

  return { token, expiresAt: expiresAt.toISOString() };
}

export async function createAuthPayload(user: UserSession, req: Request, res: Response): Promise<AuthPayload> {
  const access = await signAccessToken(user);
  const refreshToken = `${nanoid(24)}.${randomBytes(32).toString('base64url')}`;
  const sessionId = `rs_${nanoid(16)}`;
  const expiresAt = new Date(Date.now() + refreshTtlMs).toISOString();

  await saveRefreshSession({
    id: sessionId,
    userId: user.id,
    tokenHash: tokenHash(refreshToken),
    expiresAt,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  const secure = process.env.NODE_ENV === 'production';
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/auth',
    maxAge: refreshTtlMs
  });
  res.cookie('access_token', access.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: accessTtlSeconds * 1000
  });

  return {
    user,
    accessToken: access.token,
    expiresAt: access.expiresAt
  };
}

export async function loginWithPassword(role: Role, email: string, password: string, req: Request, res: Response) {
  const row = (await getUserByEmail(email)) as
    | {
        id: string;
        name: string;
        email: string;
        role: Role;
        password_hash: string;
        provider_id?: string | null;
      }
    | undefined;
  if (!row || row.role !== role) {
    throw new Error('Correo, rol o contraseña incorrectos.');
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    throw new Error('Correo, rol o contraseña incorrectos.');
  }
  return createAuthPayload(publicUser(row), req, res);
}

export async function refreshSession(req: Request, res: Response) {
  const token = req.cookies?.refresh_token as string | undefined;
  if (!token) throw new Error('No hay sesion activa.');
  const session = await getRefreshSession(tokenHash(token));
  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    if (session) await revokeRefreshSession(session.id);
    throw new Error('La sesion expiro. Inicia sesion de nuevo.');
  }
  const user = await getUserById(session.user_id);
  if (!user) throw new Error('Usuario no encontrado.');
  await revokeRefreshSession(session.id);
  return createAuthPayload(user, req, res);
}

export function clearAuthCookies(res: Response) {
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.clearCookie('access_token', { path: '/' });
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, accessSecret, {
    issuer: 'app-proveedores-api',
    audience: 'app-proveedores-web'
  });
  const user = await getUserById(String(payload.sub));
  if (!user) throw new Error('Usuario no encontrado.');
  return user;
}

export function requireAuth(roles?: Role[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.get('authorization');
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const cookieToken = req.cookies?.access_token as string | undefined;
      const token = bearer ?? cookieToken;
      if (!token) {
        res.status(401).json({ message: 'Inicia sesion para continuar.' });
        return;
      }
      const user = await verifyAccessToken(token);
      if (roles && !roles.includes(user.role)) {
        res.status(403).json({ message: 'Tu rol no tiene permisos para esta accion.' });
        return;
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ message: 'Sesion invalida o expirada.' });
    }
  };
}

export function canSetStatus(role: Role, nextStatus: string) {
  const permissions: Record<Role, string[]> = {
    cliente: ['aceptada', 'pendiente_pago', 'cerrada', 'disputa'],
    proveedor: ['cotizada', 'aceptada', 'en_camino', 'en_progreso', 'pendiente_pago'],
    admin: ['abierta', 'cotizada', 'aceptada', 'en_camino', 'en_progreso', 'pendiente_pago', 'cerrada', 'disputa', 'reembolso']
  };
  return permissions[role].includes(nextStatus);
}

export { nowIso };
