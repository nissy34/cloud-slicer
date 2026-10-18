-- Engine start-up failures reported by browsers, so they can be diagnosed
-- without the user at the console. No account or IP is stored: only the
-- browser's user agent, the error and the page's engine build.
CREATE TABLE IF NOT EXISTS engine_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL, -- Unix milliseconds
  user_agent TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT NOT NULL
);
