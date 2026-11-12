-- AI app add-ons: relay tickets per account per day (functions/_lib/relay.ts, a hidden limit).
-- Its own migration: 0011 had already been applied to the shared database before this table was added.
CREATE TABLE IF NOT EXISTS program_use (user_id TEXT NOT NULL, day TEXT NOT NULL, tickets INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
