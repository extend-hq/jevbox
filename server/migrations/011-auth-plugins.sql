ALTER TABLE orgs ADD COLUMN slug TEXT;
UPDATE orgs SET slug=id;
ALTER TABLE orgs ALTER COLUMN slug SET NOT NULL;
ALTER TABLE orgs ALTER COLUMN slug SET DEFAULT gen_random_uuid()::text;
ALTER TABLE orgs ADD CONSTRAINT orgs_slug_unique UNIQUE(slug);
ALTER TABLE orgs ADD COLUMN logo TEXT;
ALTER TABLE orgs ADD COLUMN metadata TEXT;
ALTER TABLE orgs ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE members ADD COLUMN id TEXT NOT NULL DEFAULT gen_random_uuid()::text UNIQUE;
ALTER TABLE members ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX members_user_org ON members(user_id,org_id);

DROP TABLE invites;
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','canceled')),
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invites_org_status ON invites(org_id,status);
CREATE INDEX invites_email_status ON invites(email,status);
CREATE INDEX invites_inviter ON invites(inviter_id);

DROP TABLE api_keys;
CREATE TABLE apikey (
  id TEXT PRIMARY KEY,
  "configId" TEXT NOT NULL DEFAULT 'default',
  name TEXT,
  start TEXT,
  "referenceId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prefix TEXT,
  key TEXT NOT NULL UNIQUE,
  "refillInterval" BIGINT,
  "refillAmount" INTEGER,
  "lastRefillAt" TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT true,
  "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
  "rateLimitTimeWindow" BIGINT,
  "rateLimitMax" INTEGER,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  remaining INTEGER,
  "lastRequest" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  permissions TEXT,
  metadata TEXT
);
CREATE INDEX apikey_reference ON apikey("referenceId","createdAt");
CREATE INDEX apikey_config ON apikey("configId");
