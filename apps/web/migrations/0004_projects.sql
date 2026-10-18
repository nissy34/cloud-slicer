-- Projects saved online: the 3MF and its thumbnail live in R2 (the PROJECTS
-- bucket, under projects/<user id>/<project id>/); this table is the index.
-- file_key changes with every save, so a save that loses a race to another
-- device never overwrites the newer file.
CREATE TABLE IF NOT EXISTS projects (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,          -- bytes of the 3MF
  file_key TEXT NOT NULL,
  thumb_key TEXT,                 -- PNG of the 3D view, or NULL
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,    -- Unix milliseconds
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
