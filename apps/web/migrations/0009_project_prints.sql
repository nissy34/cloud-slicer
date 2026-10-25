-- Print history (lib/prints.ts): which plates of a saved project were sent to
-- a printer and how each print went. One row per send or mark; a plate's mark
-- is worked out from its rows. Kept beside the project, not in its 3MF, so a
-- send from any device records without saving the project, and a printer's
-- later "finished" is one small update. Additive only (production and previews
-- share this database).
CREATE TABLE IF NOT EXISTS project_prints (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  plate INTEGER NOT NULL,          -- 0-based
  status TEXT NOT NULL,            -- uploaded sent printing printed failed cancelled marked unmarked
  at INTEGER NOT NULL,             -- Unix milliseconds of the send or mark
  ended_at INTEGER,
  duration INTEGER,                -- seconds printing, as the printer said
  progress REAL,                   -- 0-1 when it ended
  printer TEXT,                    -- the saved printer's id
  printer_name TEXT,
  file TEXT,                       -- the file on the printer
  fingerprint TEXT,                -- what the plate printed (lib/prints.ts fingerprintOf)
  summary TEXT,                    -- JSON PlateSummary, to say what changed since
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects (user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS project_prints_project ON project_prints (user_id, project_id, plate);
CREATE INDEX IF NOT EXISTS project_prints_open ON project_prints (user_id, status);
-- How many plates a project has, for "6/10 printed" in the Projects list (NULL: saved before this).
ALTER TABLE projects ADD COLUMN plates INTEGER;
