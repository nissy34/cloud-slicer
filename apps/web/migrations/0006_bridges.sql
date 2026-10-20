-- Admin page, bridges: the owner can turn a bridge off, and allow or refuse
-- bridges per person. Additive only (production and previews share this database).

-- One row per bridge the site has given tickets for: turned off by the owner,
-- and when signed-out people last used it.
CREATE TABLE IF NOT EXISTS relay_bridge_info (
  bridge_id TEXT NOT NULL PRIMARY KEY,
  relay TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  guest_used_at INTEGER,           -- Unix milliseconds
  updated_at INTEGER NOT NULL
);

-- 0 = this person may not use bridges; NULL = allowed.
ALTER TABLE user_limits ADD COLUMN bridges INTEGER;
