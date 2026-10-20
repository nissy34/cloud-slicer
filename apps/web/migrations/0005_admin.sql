-- The owner's Admin page: who may sign in, how much each user may store, and
-- which bridges each user has connected through the relay.
-- Additive only: production and every preview share this database.

-- Better Auth's admin plugin (block = its "ban": signs the user out and refuses new sign-ins).
ALTER TABLE "user" ADD COLUMN "role" text;
ALTER TABLE "user" ADD COLUMN "banned" integer;
ALTER TABLE "user" ADD COLUMN "banReason" text;
ALTER TABLE "user" ADD COLUMN "banExpires" date;
ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;

-- Site-wide switches as small JSON values ('access': invite only, storage per user).
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL      -- Unix milliseconds
);

-- Who may sign in while the site is invite only (lower-case emails).
CREATE TABLE IF NOT EXISTS allowed_emails (
  email TEXT NOT NULL PRIMARY KEY,
  added_at INTEGER NOT NULL
);

-- Per-user storage for online projects, when it differs from the site's
-- default. 0 = presets only (no online projects).
CREATE TABLE IF NOT EXISTS user_limits (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  storage_mb INTEGER,
  updated_at INTEGER NOT NULL
);

-- Bridges each user has connected to through the relay (the per-user bridge cap).
CREATE TABLE IF NOT EXISTS relay_bridges (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  bridge_id TEXT NOT NULL,
  relay TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, bridge_id)
);
