import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import {
  categories as seedCategories,
  chatMessages as seedChatMessages,
  heatPoints as seedHeatPoints,
  notifications as seedNotifications,
  providers as seedProviders,
  requests as seedRequests,
  sessions
} from './seed';
import type {
  AuditLog,
  Category,
  ChatMessage,
  EscrowStatus,
  FraudSignal,
  HeatPoint,
  Metrics,
  NotificationEvent,
  PaymentRecord,
  Provider,
  RequestStatus,
  Role,
  ServiceRequest,
  SupportDocument,
  TimelineEvent,
  UserSession
} from '../src/types';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const dataDir = process.env.DATA_DIR ?? join(rootDir, 'data');
const postgresUrl =
  process.env.POSTGRES_URL ??
  (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('file:') ? process.env.DATABASE_URL : undefined);
const forceSqlite = process.env.DB_DRIVER === 'sqlite';

export const databaseProvider = postgresUrl && !forceSqlite ? 'postgres' : 'sqlite';
export const dbPath = process.env.DATABASE_URL?.startsWith('file:')
  ? process.env.DATABASE_URL.replace('file:', '')
  : process.env.SQLITE_PATH ?? join(dataDir, 'conectapro.sqlite');

if (databaseProvider === 'sqlite' && !existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const sqlite = databaseProvider === 'sqlite' ? new Database(dbPath) : undefined;
if (sqlite) {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
}

const pool =
  databaseProvider === 'postgres'
    ? new Pool({
        connectionString: postgresUrl,
        ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        max: Number(process.env.POSTGRES_POOL_MAX ?? 10),
        idleTimeoutMillis: 30_000
      })
    : undefined;

export const db = sqlite;

type Row = Record<string, unknown>;
type QueryValue = string | number | boolean | null | undefined;

function toPostgresSql(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function execSql(sql: string) {
  if (sqlite) {
    sqlite.exec(sql);
    return;
  }
  await pool!.query(sql);
}

async function allRows<T extends Row = Row>(sql: string, params: QueryValue[] = []): Promise<T[]> {
  if (sqlite) return sqlite.prepare(sql).all(...params) as T[];
  const result = await pool!.query(toPostgresSql(sql), params);
  return result.rows as T[];
}

async function getRow<T extends Row = Row>(sql: string, params: QueryValue[] = []): Promise<T | undefined> {
  if (sqlite) return sqlite.prepare(sql).get(...params) as T | undefined;
  const result = await pool!.query(toPostgresSql(sql), params);
  return result.rows[0] as T | undefined;
}

async function runSql(sql: string, params: QueryValue[] = []) {
  if (sqlite) return sqlite.prepare(sql).run(...params);
  return pool!.query(toPostgresSql(sql), params);
}

export function nowIso() {
  return new Date().toISOString();
}

function asIso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function asDateString(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function rowToCategory(row: Row): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description),
    image: String(row.image),
    accent: String(row.accent),
    averagePrice: Number(row.average_price),
    emergency: Boolean(row.emergency),
    featured: Boolean(row.featured)
  };
}

function rowToProvider(row: Row): Provider {
  return {
    id: String(row.id),
    name: String(row.name),
    trade: String(row.trade),
    categoryIds: parseJson<string[]>(row.category_ids, []),
    verified: Boolean(row.verified),
    rating: Number(row.rating),
    jobsCompleted: Number(row.jobs_completed),
    subscription: {
      plan: String(row.subscription_plan) as Provider['subscription']['plan'],
      status: String(row.subscription_status) as Provider['subscription']['status'],
      renewalDate: asDateString(row.subscription_renewal_date),
      price: Number(row.subscription_price)
    },
    location: {
      lat: Number(row.lat),
      lng: Number(row.lng),
      address: String(row.address)
    }
  };
}

async function timelineFor(requestId: string): Promise<TimelineEvent[]> {
  const rows = await allRows('SELECT * FROM timeline_events WHERE request_id = ? ORDER BY created_at ASC', [requestId]);
  return rows.map((row) => ({
    id: String(row.id),
    status: String(row.status) as RequestStatus,
    label: String(row.label),
    actor: String(row.actor) as Role,
    createdAt: asIso(row.created_at)
  }));
}

async function rowToRequest(row: Row): Promise<ServiceRequest> {
  const request: ServiceRequest = {
    id: String(row.id),
    title: String(row.title),
    categoryId: String(row.category_id),
    clientId: String(row.client_id),
    providerId: row.provider_id ? String(row.provider_id) : undefined,
    address: String(row.address),
    city: String(row.city),
    dateTime: asIso(row.date_time),
    budget: Number(row.budget),
    distanceKm: Number(row.distance_km),
    status: String(row.status) as RequestStatus,
    description: String(row.description),
    location: row.lat && row.lng ? { lat: Number(row.lat), lng: Number(row.lng) } : undefined,
    createdAt: asIso(row.created_at),
    timeline: await timelineFor(String(row.id)),
    escrow: {
      amount: Number(row.escrow_amount),
      status: String(row.escrow_status) as EscrowStatus
    },
    fraudScore: Number(row.fraud_score)
  };

  if (row.quote_provider_id && row.quote_amount) {
    request.quote = {
      providerId: String(row.quote_provider_id),
      amount: Number(row.quote_amount),
      message: String(row.quote_message ?? '')
    };
  }
  if (row.review_rating && row.review_comment) {
    request.review = {
      rating: Number(row.review_rating),
      comment: String(row.review_comment)
    };
  }
  if (row.dispute_reason && row.dispute_status) {
    request.dispute = {
      reason: String(row.dispute_reason),
      status: String(row.dispute_status) as 'abierta' | 'resuelta'
    };
  }
  return request;
}

export async function migrate() {
  if (databaseProvider === 'postgres') {
    const sql = readFileSync(join(__dirname, 'postgres/schema.sql'), 'utf8');
    await execSql(sql);
    await runSql(
      `INSERT INTO schema_migrations (version, applied_at)
       VALUES (?, ?)
       ON CONFLICT (version) DO NOTHING`,
      ['postgres_schema_v1', nowIso()]
    );
    return;
  }

  await execSql(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const applied = await getRow('SELECT version FROM schema_migrations WHERE version = ?', [version]);
    if (!applied) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await execSql(sql);
      await runSql('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [version, nowIso()]);
    }
  }
}

export async function seedDatabase() {
  const categoryCount = await getRow<{ count: string | number }>('SELECT COUNT(*) AS count FROM categories');
  if (Number(categoryCount?.count ?? 0) > 0) {
    const categoryBoolean = (value: boolean) => (databaseProvider === 'postgres' ? value : value ? 1 : 0);
    for (const category of seedCategories) {
      await runSql(
        'UPDATE categories SET name = ?, slug = ?, description = ?, image = ?, accent = ?, average_price = ?, emergency = ?, featured = ? WHERE id = ?',
        [
          category.name,
          category.slug,
          category.description,
          category.image,
          category.accent,
          category.averagePrice,
          categoryBoolean(category.emergency),
          categoryBoolean(category.featured),
          category.id
        ]
      );
    }
    return;
  }

  const passwordHash = bcrypt.hashSync(process.env.DEMO_PASSWORD ?? 'Demo123!', 12);
  for (const user of Object.values(sessions)) {
    await runSql('INSERT INTO users (id, name, email, role, password_hash, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      user.id,
      user.name,
      user.email,
      user.role,
      passwordHash,
      user.providerId ?? null,
      nowIso()
    ]);
  }
  await runSql('INSERT INTO users (id, name, email, role, password_hash, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    'usr_cliente_2',
    'Alejandro Ramos',
    'alejandro@conectapro.mx',
    'cliente',
    passwordHash,
    null,
    nowIso()
  ]);
  await runSql('INSERT INTO users (id, name, email, role, password_hash, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    'usr_cliente_3',
    'Paola Mendez',
    'paola@conectapro.mx',
    'cliente',
    passwordHash,
    null,
    nowIso()
  ]);

  const boolValue = (value: boolean) => (databaseProvider === 'postgres' ? value : value ? 1 : 0);
  for (const category of seedCategories) {
    await runSql(
      'INSERT INTO categories (id, name, slug, description, image, accent, average_price, emergency, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        category.id,
        category.name,
        category.slug,
        category.description,
        category.image,
        category.accent,
        category.averagePrice,
        boolValue(category.emergency),
        boolValue(category.featured)
      ]
    );
  }

  for (const provider of seedProviders) {
    await runSql(
      `INSERT INTO providers (
        id, name, trade, category_ids, verified, rating, jobs_completed, subscription_plan, subscription_status,
        subscription_renewal_date, subscription_price, lat, lng, address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        provider.id,
        provider.name,
        provider.trade,
        JSON.stringify(provider.categoryIds),
        boolValue(provider.verified),
        provider.rating,
        provider.jobsCompleted,
        provider.subscription.plan,
        provider.subscription.status,
        provider.subscription.renewalDate,
        provider.subscription.price,
        provider.location.lat,
        provider.location.lng,
        provider.location.address
      ]
    );
  }

  for (const request of seedRequests) {
    await runSql(
      `INSERT INTO service_requests (
        id, title, category_id, client_id, provider_id, address, city, date_time, budget, distance_km, status,
        description, lat, lng, created_at, escrow_amount, escrow_status, quote_provider_id, quote_amount,
        quote_message, review_rating, review_comment, dispute_reason, dispute_status, fraud_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.id,
        request.title,
        request.categoryId,
        request.clientId,
        request.providerId ?? null,
        request.address,
        request.city,
        request.dateTime,
        request.budget,
        request.distanceKm,
        request.status,
        request.description,
        request.location?.lat ?? null,
        request.location?.lng ?? null,
        request.createdAt,
        request.escrow.amount,
        request.escrow.status,
        request.quote?.providerId ?? null,
        request.quote?.amount ?? null,
        request.quote?.message ?? null,
        request.review?.rating ?? null,
        request.review?.comment ?? null,
        request.dispute?.reason ?? null,
        request.dispute?.status ?? null,
        request.dispute ? 70 : 12
      ]
    );
    for (const event of request.timeline) {
      await runSql('INSERT INTO timeline_events (id, request_id, status, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        event.id,
        request.id,
        event.status,
        event.label,
        event.actor,
        event.createdAt
      ]);
    }
  }

  for (const message of seedChatMessages) {
    await runSql('INSERT INTO chat_messages (id, request_id, sender_role, sender_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      message.id,
      message.requestId,
      message.senderRole,
      message.senderName,
      message.message,
      message.createdAt
    ]);
  }
  for (const notification of seedNotifications) {
    await runSql('INSERT INTO notifications (id, title, message, role, created_at) VALUES (?, ?, ?, ?, ?)', [
      notification.id,
      notification.title,
      notification.message,
      notification.role,
      notification.createdAt
    ]);
  }
  for (const point of seedHeatPoints) {
    await runSql('INSERT INTO heat_points (id, label, lat, lng, intensity, category_id) VALUES (?, ?, ?, ?, ?, ?)', [
      point.id,
      point.label,
      point.lat,
      point.lng,
      point.intensity,
      point.categoryId
    ]);
  }
}

export async function initializeDatabase() {
  await migrate();
  await seedDatabase();
}

export async function getUserByEmail(email: string) {
  return (await getRow('SELECT * FROM users WHERE lower(email) = lower(?)', [email])) as
    | (UserSession & { password_hash: string; provider_id?: string })
    | undefined;
}

export async function getUserById(id: string): Promise<UserSession | undefined> {
  const row = await getRow('SELECT id, name, email, role, provider_id FROM users WHERE id = ?', [id]);
  if (!row) return undefined;
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role) as Role,
    providerId: row.provider_id ? String(row.provider_id) : undefined
  };
}

export async function upsertOAuthUser(input: { provider: 'google' | 'apple'; subject: string; email: string; name?: string }): Promise<UserSession> {
  const account = await getRow(
    `SELECT u.id, u.name, u.email, u.role, u.provider_id
     FROM oauth_accounts oa
     JOIN users u ON u.id = oa.user_id
     WHERE oa.provider = ? AND oa.provider_subject = ?`,
    [input.provider, input.subject]
  );

  if (account) {
    return {
      id: String(account.id),
      name: String(account.name),
      email: String(account.email),
      role: String(account.role) as Role,
      providerId: account.provider_id ? String(account.provider_id) : undefined
    };
  }

  const existing = (await getUserByEmail(input.email)) as
    | { id: string; name: string; email: string; role: Role; provider_id?: string | null }
    | undefined;
  const userId = existing?.id ?? `usr_${nanoid(10)}`;
  const userName = input.name?.trim() || existing?.name || input.email.split('@')[0] || 'Cliente App Proveedores';

  if (!existing) {
    await runSql('INSERT INTO users (id, name, email, role, password_hash, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      userId,
      userName,
      input.email,
      'cliente',
      `oauth:${input.provider}`,
      null,
      nowIso()
    ]);
  }

  if (databaseProvider === 'postgres') {
    await pool!.query(
      `INSERT INTO oauth_accounts (id, user_id, provider, provider_subject, email, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider, provider_subject) DO NOTHING`,
      [nanoid(), userId, input.provider, input.subject, input.email, nowIso()]
    );
  } else {
    await runSql('INSERT OR IGNORE INTO oauth_accounts (id, user_id, provider, provider_subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      nanoid(),
      userId,
      input.provider,
      input.subject,
      input.email,
      nowIso()
    ]);
  }

  const user = await getUserById(userId);
  if (!user) throw new Error('No se pudo crear usuario OAuth.');
  return user;
}

export async function saveRefreshSession(input: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  ip?: string;
  userAgent?: string;
}) {
  await runSql('INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    input.id,
    input.userId,
    input.tokenHash,
    input.expiresAt,
    input.ip ?? null,
    input.userAgent ?? null,
    nowIso()
  ]);
}

export async function getRefreshSession(tokenHash: string) {
  const row = await getRow<{ id: string; user_id: string; expires_at: string | Date }>(
    'SELECT * FROM refresh_sessions WHERE token_hash = ? AND revoked_at IS NULL',
    [tokenHash]
  );
  return row ? { ...row, expires_at: asIso(row.expires_at) } : undefined;
}

export async function revokeRefreshSession(id: string) {
  await runSql('UPDATE refresh_sessions SET revoked_at = ? WHERE id = ?', [nowIso(), id]);
}

export async function listCategories(featuredOnly = false): Promise<Category[]> {
  const featuredWhere = databaseProvider === 'postgres' ? 'WHERE featured = true' : 'WHERE featured = 1';
  const rows = await allRows(`SELECT * FROM categories ${featuredOnly ? featuredWhere : ''} ORDER BY featured DESC, name ASC`);
  return rows.map(rowToCategory);
}

export async function listNotifications(role: Role): Promise<NotificationEvent[]> {
  const rows = await allRows('SELECT * FROM notifications WHERE role = ? OR role = ? ORDER BY created_at DESC LIMIT 30', [role, 'todos']);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    message: String(row.message),
    role: String(row.role) as Role | 'todos',
    createdAt: asIso(row.created_at)
  }));
}

export async function insertNotification(input: Omit<NotificationEvent, 'id' | 'createdAt'>): Promise<NotificationEvent> {
  const notification: NotificationEvent = { ...input, id: nanoid(), createdAt: nowIso() };
  await runSql('INSERT INTO notifications (id, title, message, role, created_at) VALUES (?, ?, ?, ?, ?)', [
    notification.id,
    notification.title,
    notification.message,
    notification.role,
    notification.createdAt
  ]);
  return notification;
}

export async function insertEvent(eventType: string, role: Role | 'todos', payload: unknown) {
  const event = { id: nanoid(), eventType, role, payload, createdAt: nowIso() };
  if (databaseProvider === 'postgres') {
    const result = await pool!.query(
      'INSERT INTO event_log (id, event_type, role, payload, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING seq',
      [event.id, eventType, role, JSON.stringify(payload), event.createdAt]
    );
    return { ...event, seq: Number(result.rows[0].seq) };
  }
  const result = await runSql('INSERT INTO event_log (id, event_type, role, payload, created_at) VALUES (?, ?, ?, ?, ?)', [
    event.id,
    eventType,
    role,
    JSON.stringify(payload),
    event.createdAt
  ]);
  return { ...event, seq: Number('lastInsertRowid' in result ? result.lastInsertRowid : 0) };
}

export async function eventsAfter(seq: number, role: Role) {
  const rows = await allRows('SELECT * FROM event_log WHERE seq > ? AND (role = ? OR role = ?) ORDER BY seq ASC LIMIT 100', [seq, role, 'todos']);
  return rows.map((row) => ({
    seq: Number(row.seq),
    eventType: String(row.event_type),
    payload: parseJson(row.payload, {}),
    createdAt: asIso(row.created_at)
  }));
}

export async function listRequests(filters: {
  role: Role;
  userId: string;
  providerId?: string;
  category?: string;
  search?: string;
  maxBudget?: number;
  maxDistance?: number;
}): Promise<ServiceRequest[]> {
  const clauses: string[] = [];
  const params: QueryValue[] = [];

  if (filters.role === 'cliente') {
    clauses.push('client_id = ?');
    params.push(filters.userId);
  }
  if (filters.role === 'proveedor') {
    clauses.push('(status = ? OR provider_id = ?)');
    params.push('abierta', filters.providerId ?? '');
  }
  if (filters.category && filters.category !== 'todas') {
    clauses.push('category_id = ?');
    params.push(filters.category);
  }
  if (filters.search) {
    clauses.push('(lower(title) LIKE ? OR lower(description) LIKE ? OR lower(address) LIKE ?)');
    const search = `%${filters.search.toLowerCase()}%`;
    params.push(search, search, search);
  }
  if (Number.isFinite(filters.maxBudget)) {
    clauses.push('budget <= ?');
    params.push(Number(filters.maxBudget));
  }
  if (Number.isFinite(filters.maxDistance)) {
    clauses.push('distance_km <= ?');
    params.push(Number(filters.maxDistance));
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await allRows(`SELECT * FROM service_requests ${where} ORDER BY created_at DESC`, params);
  return Promise.all(rows.map((row) => rowToRequest(row)));
}

export async function getRequest(id: string): Promise<ServiceRequest | undefined> {
  const row = await getRow('SELECT * FROM service_requests WHERE id = ?', [id]);
  return row ? rowToRequest(row) : undefined;
}

export async function insertRequest(input: {
  title: string;
  categoryId: string;
  clientId: string;
  address: string;
  city: string;
  dateTime: string;
  budget: number;
  distanceKm: number;
  description: string;
  lat?: number;
  lng?: number;
  fraudScore: number;
}): Promise<ServiceRequest> {
  const category = (await listCategories()).find((item) => item.id === input.categoryId);
  const id = `req_${nanoid(8)}`;
  const createdAt = nowIso();
  await runSql(
    `INSERT INTO service_requests (
      id, title, category_id, client_id, address, city, date_time, budget, distance_km, status, description,
      lat, lng, created_at, escrow_amount, escrow_status, fraud_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.categoryId,
      input.clientId,
      input.address,
      input.city,
      input.dateTime,
      input.budget,
      input.distanceKm,
      'abierta',
      input.description,
      input.lat ?? null,
      input.lng ?? null,
      createdAt,
      0,
      'sin_pago',
      input.fraudScore
    ]
  );
  await runSql('INSERT INTO timeline_events (id, request_id, status, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    nanoid(),
    id,
    'abierta',
    `Solicitud publicada en ${category?.name ?? 'servicio'}.`,
    'cliente',
    createdAt
  ]);
  return (await getRequest(id))!;
}

export async function addTimeline(requestId: string, status: RequestStatus, actor: Role, label: string) {
  const createdAt = nowIso();
  await runSql('UPDATE service_requests SET status = ? WHERE id = ?', [status, requestId]);
  await runSql('INSERT INTO timeline_events (id, request_id, status, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    nanoid(),
    requestId,
    status,
    label,
    actor,
    createdAt
  ]);
}

export async function quoteRequest(requestId: string, provider: Provider, amount: number, message: string) {
  await runSql('UPDATE service_requests SET provider_id = ?, quote_provider_id = ?, quote_amount = ?, quote_message = ?, status = ? WHERE id = ?', [
    provider.id,
    provider.id,
    amount,
    message,
    'cotizada',
    requestId
  ]);
  await runSql('INSERT INTO timeline_events (id, request_id, status, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    nanoid(),
    requestId,
    'cotizada',
    `${provider.name} envio una cotizacion por ${new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0
    }).format(amount)}.`,
    'proveedor',
    nowIso()
  ]);
  return (await getRequest(requestId))!;
}

export async function acceptRequest(requestId: string, provider: Provider, amount: number, message: string) {
  await runSql(
    `UPDATE service_requests
     SET provider_id = ?, quote_provider_id = ?, quote_amount = ?, quote_message = ?, escrow_amount = ?, escrow_status = ?, status = ?
     WHERE id = ?`,
    [provider.id, provider.id, amount, message, amount, 'retenido', 'aceptada', requestId]
  );
  await runSql('INSERT INTO timeline_events (id, request_id, status, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    nanoid(),
    requestId,
    'aceptada',
    `${provider.name} acepto el trabajo y se activo el escrow.`,
    'proveedor',
    nowIso()
  ]);
  return (await getRequest(requestId))!;
}

export async function updateRequestEscrow(requestId: string, amount: number, escrowStatus: EscrowStatus, status: RequestStatus, actor: Role, label: string) {
  await runSql('UPDATE service_requests SET escrow_amount = ?, escrow_status = ?, status = ? WHERE id = ?', [amount, escrowStatus, status, requestId]);
  await runSql('INSERT INTO timeline_events (id, request_id, status, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    nanoid(),
    requestId,
    status,
    label,
    actor,
    nowIso()
  ]);
  return (await getRequest(requestId))!;
}

export async function reviewRequest(requestId: string, rating: number, comment: string) {
  await runSql('UPDATE service_requests SET review_rating = ?, review_comment = ? WHERE id = ?', [rating, comment, requestId]);
  await addTimeline(requestId, 'cerrada', 'cliente', 'Cliente dejo una reseña y cerro el servicio.');
  return (await getRequest(requestId))!;
}

export async function disputeRequest(requestId: string, reason: string) {
  const maxExpression = databaseProvider === 'postgres' ? 'GREATEST(fraud_score, 70)' : 'MAX(fraud_score, 70)';
  await runSql(`UPDATE service_requests SET dispute_reason = ?, dispute_status = ?, status = ?, fraud_score = ${maxExpression} WHERE id = ?`, [
    reason,
    'abierta',
    'disputa',
    requestId
  ]);
  await runSql('INSERT INTO timeline_events (id, request_id, status, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    nanoid(),
    requestId,
    'disputa',
    'Cliente abrio una disputa para revision.',
    'cliente',
    nowIso()
  ]);
  await runSql('INSERT INTO fraud_signals (id, request_id, score, reason, created_at) VALUES (?, ?, ?, ?, ?)', [
    nanoid(),
    requestId,
    70,
    'Disputa abierta por el cliente.',
    nowIso()
  ]);
  return (await getRequest(requestId))!;
}

export async function listMessages(requestId: string): Promise<ChatMessage[]> {
  const rows = await allRows('SELECT * FROM chat_messages WHERE request_id = ? ORDER BY created_at ASC', [requestId]);
  return rows.map((row) => ({
    id: String(row.id),
    requestId: String(row.request_id),
    senderRole: String(row.sender_role) as Role,
    senderName: String(row.sender_name),
    message: String(row.message),
    createdAt: asIso(row.created_at)
  }));
}

export async function insertMessage(input: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
  const message: ChatMessage = { ...input, id: nanoid(), createdAt: nowIso() };
  await runSql('INSERT INTO chat_messages (id, request_id, sender_role, sender_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    message.id,
    message.requestId,
    message.senderRole,
    message.senderName,
    message.message,
    message.createdAt
  ]);
  return message;
}

export async function getProvider(providerId: string): Promise<Provider | undefined> {
  const row = await getRow('SELECT * FROM providers WHERE id = ?', [providerId]);
  return row ? rowToProvider(row) : undefined;
}

export async function listProviders(): Promise<Provider[]> {
  const rows = await allRows('SELECT * FROM providers ORDER BY verified DESC, rating DESC');
  return rows.map(rowToProvider);
}

export async function updateProviderLocation(providerId: string, lat: number, lng: number, address: string) {
  await runSql('UPDATE providers SET lat = ?, lng = ?, address = ? WHERE id = ?', [lat, lng, address, providerId]);
  return (await getProvider(providerId))!;
}

export async function updateSubscription(providerId: string, plan: Provider['subscription']['plan'], price: number, status = 'activa') {
  const renewal = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await runSql('UPDATE providers SET subscription_plan = ?, subscription_status = ?, subscription_renewal_date = ?, subscription_price = ? WHERE id = ?', [
    plan,
    status,
    renewal,
    price,
    providerId
  ]);
  return (await getProvider(providerId))!;
}

export async function verifyProvider(providerId: string, verified: boolean) {
  await runSql('UPDATE providers SET verified = ? WHERE id = ?', [databaseProvider === 'postgres' ? verified : verified ? 1 : 0, providerId]);
  return (await getProvider(providerId))!;
}

export async function metrics(): Promise<Metrics> {
  const activeRequests = await getRow<{ count: string | number }>("SELECT COUNT(*) AS count FROM service_requests WHERE status NOT IN ('cerrada', 'reembolso')");
  const activeProviders = await getRow<{ count: string | number }>("SELECT COUNT(*) AS count FROM providers WHERE subscription_status = 'activa'");
  const escrowBalance = await getRow<{ amount: string | number }>(
    "SELECT COALESCE(SUM(escrow_amount), 0) AS amount FROM service_requests WHERE escrow_status = 'retenido'"
  );
  const disputesOpen = await getRow<{ count: string | number }>("SELECT COUNT(*) AS count FROM service_requests WHERE dispute_status = 'abierta'");
  const closed = await getRow<{ count: string | number }>("SELECT COUNT(*) AS count FROM service_requests WHERE status = 'cerrada'");
  const total = await getRow<{ count: string | number }>('SELECT COUNT(*) AS count FROM service_requests');
  const totalCount = Number(total?.count ?? 0);
  return {
    activeRequests: Number(activeRequests?.count ?? 0),
    activeProviders: Number(activeProviders?.count ?? 0),
    escrowBalance: Number(escrowBalance?.amount ?? 0),
    disputesOpen: Number(disputesOpen?.count ?? 0),
    conversionRate: totalCount ? Math.round((Number(closed?.count ?? 0) / totalCount) * 100) : 0
  };
}

export async function listDisputes() {
  const rows = await allRows("SELECT * FROM service_requests WHERE status = 'disputa' OR dispute_status = 'abierta' ORDER BY created_at DESC");
  return Promise.all(rows.map((row) => rowToRequest(row)));
}

export async function resolveDispute(requestId: string, resolution: 'release' | 'refund') {
  const status = resolution === 'refund' ? 'reembolso' : 'cerrada';
  const escrowStatus = resolution === 'refund' ? 'reembolsado' : 'liberado';
  const label = resolution === 'refund' ? 'Admin resolvio la disputa con reembolso.' : 'Admin resolvio la disputa y libero el pago.';
  await runSql('UPDATE service_requests SET dispute_status = ?, escrow_status = ?, status = ? WHERE id = ?', ['resuelta', escrowStatus, status, requestId]);
  await runSql('INSERT INTO timeline_events (id, request_id, status, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    nanoid(),
    requestId,
    status,
    label,
    'admin',
    nowIso()
  ]);
  return (await getRequest(requestId))!;
}

export async function listHeatPoints(): Promise<HeatPoint[]> {
  const rows = await allRows('SELECT * FROM heat_points ORDER BY intensity DESC');
  return rows.map((row) => ({
    id: String(row.id),
    label: String(row.label),
    lat: Number(row.lat),
    lng: Number(row.lng),
    intensity: Number(row.intensity),
    categoryId: String(row.category_id)
  }));
}

export async function insertPayment(input: Omit<PaymentRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PaymentRecord> {
  const payment: PaymentRecord = { ...input, id: `pay_${nanoid(10)}`, createdAt: nowIso(), updatedAt: nowIso() };
  await runSql(
    `INSERT INTO payments (
      id, kind, request_id, provider_id, user_id, provider, provider_ref, amount, currency, status, checkout_url, raw_payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payment.id,
      payment.kind,
      payment.requestId ?? null,
      payment.providerId ?? null,
      payment.userId ?? null,
      payment.provider,
      payment.providerRef ?? null,
      payment.amount,
      payment.currency,
      payment.status,
      payment.checkoutUrl ?? null,
      payment.rawPayload ? JSON.stringify(payment.rawPayload) : null,
      payment.createdAt,
      payment.updatedAt
    ]
  );
  return payment;
}

export async function updatePaymentStatus(id: string, status: PaymentRecord['status'], rawPayload?: unknown) {
  await runSql('UPDATE payments SET status = ?, raw_payload = COALESCE(?, raw_payload), updated_at = ? WHERE id = ?', [
    status,
    rawPayload ? JSON.stringify(rawPayload) : null,
    nowIso(),
    id
  ]);
  return getPayment(id);
}

export async function updatePaymentProviderData(id: string, providerRef: string, checkoutUrl?: string, rawPayload?: unknown) {
  await runSql('UPDATE payments SET provider_ref = ?, checkout_url = ?, raw_payload = COALESCE(?, raw_payload), updated_at = ? WHERE id = ?', [
    providerRef,
    checkoutUrl ?? null,
    rawPayload ? JSON.stringify(rawPayload) : null,
    nowIso(),
    id
  ]);
  return getPayment(id);
}

export async function getPayment(id: string): Promise<PaymentRecord | undefined> {
  const row = await getRow('SELECT * FROM payments WHERE id = ?', [id]);
  if (!row) return undefined;
  return {
    id: String(row.id),
    kind: String(row.kind) as PaymentRecord['kind'],
    requestId: row.request_id ? String(row.request_id) : undefined,
    providerId: row.provider_id ? String(row.provider_id) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    provider: String(row.provider) as PaymentRecord['provider'],
    providerRef: row.provider_ref ? String(row.provider_ref) : undefined,
    amount: Number(row.amount),
    currency: String(row.currency) as 'MXN',
    status: String(row.status) as PaymentRecord['status'],
    checkoutUrl: row.checkout_url ? String(row.checkout_url) : undefined,
    rawPayload: parseJson(row.raw_payload, undefined),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at)
  };
}

export async function getPaymentByProviderRef(provider: string, providerRef: string): Promise<PaymentRecord | undefined> {
  const row = await getRow<{ id: string }>('SELECT id FROM payments WHERE provider = ? AND provider_ref = ?', [provider, providerRef]);
  return row ? getPayment(String(row.id)) : undefined;
}

export async function listPayments(status?: string): Promise<PaymentRecord[]> {
  const rows = status
    ? await allRows('SELECT id FROM payments WHERE status = ? ORDER BY created_at DESC', [status])
    : await allRows('SELECT id FROM payments ORDER BY created_at DESC');
  const payments = await Promise.all(rows.map((row) => getPayment(String(row.id))));
  return payments.filter(Boolean) as PaymentRecord[];
}

export async function insertAuditLog(input: Omit<AuditLog, 'id' | 'createdAt'>) {
  const log: AuditLog = { ...input, id: nanoid(), createdAt: nowIso() };
  await runSql(
    'INSERT INTO audit_logs (id, actor_user_id, actor_role, action, entity_type, entity_id, metadata, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      log.id,
      log.actorUserId ?? null,
      log.actorRole ?? null,
      log.action,
      log.entityType,
      log.entityId ?? null,
      JSON.stringify(log.metadata ?? {}),
      log.ip ?? null,
      log.userAgent ?? null,
      log.createdAt
    ]
  );
  return log;
}

export async function listAuditLogs(limit = 120): Promise<AuditLog[]> {
  const rows = await allRows('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map((row) => ({
    id: String(row.id),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : undefined,
    actorRole: row.actor_role ? (String(row.actor_role) as Role) : undefined,
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: row.entity_id ? String(row.entity_id) : undefined,
    metadata: parseJson(row.metadata, {}),
    ip: row.ip ? String(row.ip) : undefined,
    userAgent: row.user_agent ? String(row.user_agent) : undefined,
    createdAt: asIso(row.created_at)
  }));
}

export async function insertSupportDocument(input: Omit<SupportDocument, 'id' | 'createdAt' | 'reviewStatus'>): Promise<SupportDocument> {
  const doc: SupportDocument = { ...input, id: nanoid(), reviewStatus: 'pendiente', uploadStatus: input.uploadStatus ?? 'attached', createdAt: nowIso() };
  await runSql(
    `INSERT INTO support_documents (
      id, request_id, uploaded_by, doc_type, file_name, file_url, review_status, storage_provider, object_key, upload_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      doc.id,
      doc.requestId,
      doc.uploadedBy,
      doc.docType,
      doc.fileName,
      doc.fileUrl,
      doc.reviewStatus,
      doc.storageProvider ?? 'url',
      doc.objectKey ?? null,
      doc.uploadStatus ?? 'attached',
      doc.createdAt
    ]
  );
  return doc;
}

export async function listSupportDocuments(requestId?: string): Promise<SupportDocument[]> {
  const rows = requestId
    ? await allRows('SELECT * FROM support_documents WHERE request_id = ? ORDER BY created_at DESC', [requestId])
    : await allRows('SELECT * FROM support_documents ORDER BY created_at DESC');
  return rows.map((row) => ({
    id: String(row.id),
    requestId: String(row.request_id),
    uploadedBy: String(row.uploaded_by),
    docType: String(row.doc_type) as SupportDocument['docType'],
    fileName: String(row.file_name),
    fileUrl: String(row.file_url),
    reviewStatus: String(row.review_status) as SupportDocument['reviewStatus'],
    storageProvider: String(row.storage_provider ?? 'url') as SupportDocument['storageProvider'],
    objectKey: row.object_key ? String(row.object_key) : undefined,
    uploadStatus: String(row.upload_status ?? 'attached') as SupportDocument['uploadStatus'],
    createdAt: asIso(row.created_at)
  }));
}

export async function listFraudSignals(): Promise<FraudSignal[]> {
  const rows = await allRows(
    `SELECT f.*, r.title AS request_title
     FROM fraud_signals f
     JOIN service_requests r ON r.id = f.request_id
     ORDER BY f.score DESC, f.created_at DESC`
  );
  return rows.map((row) => ({
    id: String(row.id),
    requestId: String(row.request_id),
    requestTitle: String(row.request_title),
    score: Number(row.score),
    reason: String(row.reason),
    createdAt: asIso(row.created_at)
  }));
}

export async function insertFraudSignal(requestId: string, score: number, reason: string) {
  await runSql('INSERT INTO fraud_signals (id, request_id, score, reason, created_at) VALUES (?, ?, ?, ?, ?)', [
    nanoid(),
    requestId,
    score,
    reason,
    nowIso()
  ]);
}

export async function closeDatabase() {
  await pool?.end();
  sqlite?.close();
}
