-- Per-user setup choices (the first-run wizard: installed printers, chosen
-- filaments, ...) as small JSON values by key, and the user's physical
-- printers with their connection details. API keys are AES-GCM encrypted
-- with the ACCOUNT_ENC_KEY secret.

CREATE TABLE user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE devices (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  preset TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT,
  extra TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
