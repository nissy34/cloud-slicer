-- Signing in a program on the person's computer (the MCP add-on for AI apps):
-- Better Auth's device-authorization plugin keeps each pending sign-in here
-- (a code the person approves on the site). Its session then lives in "session"
-- like a browser's. Generated with Better Auth 1.7's getMigrations.
CREATE TABLE IF NOT EXISTS "deviceCode" ("id" text not null primary key, "deviceCode" text not null, "userCode" text not null, "userId" text, "expiresAt" date not null, "status" text not null, "lastPolledAt" date, "pollingInterval" integer, "clientId" text, "scope" text);

CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_deviceCode_uidx" on "deviceCode" ("deviceCode");

CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_userCode_uidx" on "deviceCode" ("userCode");

-- AI app add-ons: relay tickets per account per day (functions/_lib/relay.ts, a hidden limit).
CREATE TABLE IF NOT EXISTS program_use (user_id TEXT NOT NULL, day TEXT NOT NULL, tickets INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
