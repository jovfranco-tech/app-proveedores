CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

ALTER TABLE support_documents ADD COLUMN storage_provider TEXT DEFAULT 'url';
ALTER TABLE support_documents ADD COLUMN object_key TEXT;
ALTER TABLE support_documents ADD COLUMN upload_status TEXT DEFAULT 'attached';
