-- Signing in a program on the person's computer (the MCP add-on for AI apps):
-- Better Auth's device-authorization plugin keeps each pending sign-in here
-- (a code the person approves on the site). Its session then lives in "session"
-- like a browser's. Generated with Better Auth 1.7's getMigrations.
CREATE TABLE IF NOT EXISTS "deviceCode" ("id" text not null primary key, "deviceCode" text not null, "userCode" text not null, "userId" text, "expiresAt" date not null, "status" text not null, "lastPolledAt" date, "pollingInterval" integer, "clientId" text, "scope" text);

CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_deviceCode_uidx" on "deviceCode" ("deviceCode");

CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_userCode_uidx" on "deviceCode" ("userCode");

