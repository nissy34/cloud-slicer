-- Accounts: users signed in with Google or GitHub, their browser sessions,
-- and their own printer, filament and process presets (Orca user presets: a
-- diff over the system preset named in `inherits`).
-- Times are Unix milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- One row per provider account; a user can have both Google and GitHub.
CREATE TABLE identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login TEXT,
  email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

-- Only the SHA-256 of the cookie value is stored.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- A sign-in in progress, from the start redirect to the provider's callback.
CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  origin TEXT NOT NULL,
  return_to TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  link_user_id TEXT,
  popup INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

-- One-time code that carries a finished sign-in from the callback host to the
-- host the user started on (preview deploys share one OAuth callback).
CREATE TABLE handoffs (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  return_to TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  popup INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE TABLE presets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('printer', 'filament', 'process')),
  name TEXT NOT NULL,
  inherits TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, type, name)
);
