-- Accounts: Better Auth's tables (user, session, account, verification), and
-- what each user saves: presets, setup choices and printers.
-- Times in the per-user tables are Unix milliseconds.

-- An earlier draft of this PR used hand-written tables; nobody could sign in
-- with them yet, so they are dropped.
DROP TABLE IF EXISTS presets;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS handoffs;
DROP TABLE IF EXISTS oauth_states;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS identities;
DROP TABLE IF EXISTS users;

-- Better Auth 1.7 schema (generated with its getMigrations; regenerate on upgrades).
CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

CREATE INDEX "session_userId_idx" on "session" ("userId");

CREATE INDEX "account_userId_idx" on "account" ("userId");

CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");

-- The user's printer, filament and process presets: Orca user presets, a diff
-- over the system preset named in `inherits`.
CREATE TABLE presets (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('printer', 'filament', 'process')),
  name TEXT NOT NULL,
  inherits TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, type, name)
);

-- Setup choices (the setup wizard: installed printers, chosen filaments, ...)
-- as small JSON values by key.
CREATE TABLE user_settings (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- The user's printers and how to reach them. API keys are AES-GCM encrypted
-- with the ACCOUNT_ENC_KEY secret.
CREATE TABLE devices (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
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
