CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('cliente', 'proveedor', 'admin')),
  password_hash text NOT NULL,
  provider_id text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL,
  image text NOT NULL,
  accent text NOT NULL,
  average_price integer NOT NULL,
  emergency boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS providers (
  id text PRIMARY KEY,
  name text NOT NULL,
  trade text NOT NULL,
  category_ids jsonb NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  rating real NOT NULL DEFAULT 0,
  jobs_completed integer NOT NULL DEFAULT 0,
  subscription_plan text NOT NULL,
  subscription_status text NOT NULL,
  subscription_renewal_date date NOT NULL,
  subscription_price integer NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  address text NOT NULL
);

CREATE TABLE IF NOT EXISTS service_requests (
  id text PRIMARY KEY,
  title text NOT NULL,
  category_id text NOT NULL REFERENCES categories(id),
  client_id text NOT NULL REFERENCES users(id),
  provider_id text REFERENCES providers(id),
  address text NOT NULL,
  city text NOT NULL,
  date_time timestamptz NOT NULL,
  budget integer NOT NULL,
  distance_km real NOT NULL,
  status text NOT NULL,
  description text NOT NULL,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL,
  escrow_amount integer NOT NULL DEFAULT 0,
  escrow_status text NOT NULL DEFAULT 'sin_pago',
  quote_provider_id text,
  quote_amount integer,
  quote_message text,
  review_rating integer,
  review_comment text,
  dispute_reason text,
  dispute_status text,
  fraud_score integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_requests_client ON service_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_requests_provider ON service_requests(provider_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_category ON service_requests(category_id);

CREATE TABLE IF NOT EXISTS timeline_events (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  status text NOT NULL,
  label text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  sender_role text NOT NULL,
  sender_name text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  title text NOT NULL,
  message text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS heat_points (
  id text PRIMARY KEY,
  label text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  intensity integer NOT NULL,
  category_id text NOT NULL REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS event_log (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  role text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('escrow', 'subscription')),
  request_id text REFERENCES service_requests(id),
  provider_id text REFERENCES providers(id),
  user_id text REFERENCES users(id),
  provider text NOT NULL,
  provider_ref text,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  status text NOT NULL,
  checkout_url text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(provider, provider_ref);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  actor_user_id text,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS support_documents (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL REFERENCES users(id),
  doc_type text NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  review_status text NOT NULL DEFAULT 'pendiente',
  storage_provider text DEFAULT 'url',
  object_key text,
  upload_status text DEFAULT 'attached',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS fraud_signals (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  score integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);
