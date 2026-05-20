PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('cliente', 'proveedor', 'admin')),
  password_hash TEXT NOT NULL,
  provider_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  image TEXT NOT NULL,
  accent TEXT NOT NULL,
  average_price INTEGER NOT NULL,
  emergency INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trade TEXT NOT NULL,
  category_ids TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 0,
  jobs_completed INTEGER NOT NULL DEFAULT 0,
  subscription_plan TEXT NOT NULL,
  subscription_status TEXT NOT NULL,
  subscription_renewal_date TEXT NOT NULL,
  subscription_price INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_requests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  client_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT REFERENCES providers(id),
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  date_time TEXT NOT NULL,
  budget INTEGER NOT NULL,
  distance_km REAL NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL,
  lat REAL,
  lng REAL,
  created_at TEXT NOT NULL,
  escrow_amount INTEGER NOT NULL DEFAULT 0,
  escrow_status TEXT NOT NULL DEFAULT 'sin_pago',
  quote_provider_id TEXT,
  quote_amount INTEGER,
  quote_message TEXT,
  review_rating INTEGER,
  review_comment TEXT,
  dispute_reason TEXT,
  dispute_status TEXT,
  fraud_score INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_requests_client ON service_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_requests_provider ON service_requests(provider_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_category ON service_requests(category_id);

CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  label TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heat_points (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  intensity INTEGER NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS event_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  role TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('escrow', 'subscription')),
  request_id TEXT REFERENCES service_requests(id),
  provider_id TEXT REFERENCES providers(id),
  user_id TEXT REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_ref TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  status TEXT NOT NULL,
  checkout_url TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(provider, provider_ref);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS support_documents (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pendiente',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fraud_signals (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
