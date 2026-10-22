-- Setup codes for adding a bridge: the Device tab makes one for a signed-in
-- person, the install command carries it, and the bridge spends it once (within
-- the hour) to join that person's account. Additive only (production and
-- previews share this database).
CREATE TABLE IF NOT EXISTS bridge_setup_codes (
  code_hash TEXT NOT NULL PRIMARY KEY,  -- SHA-256 of the code; the code itself is never stored
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  relay TEXT NOT NULL,
  created_at INTEGER NOT NULL,          -- Unix milliseconds
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  bridge_id TEXT,                       -- the bridge that used it
  bridge_name TEXT
);
CREATE INDEX IF NOT EXISTS bridge_setup_codes_user ON bridge_setup_codes (user_id);
