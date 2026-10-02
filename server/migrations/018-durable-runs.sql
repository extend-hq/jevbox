ALTER TABLE chat_turns ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'session' CHECK (credential_type IN ('session','external'));

CREATE TABLE external_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('search','answer')),
  input JSONB NOT NULL,
  credential TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  result JSONB,
  error TEXT,
  job_id UUID,
  attempt_id TEXT,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  created TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX external_runs_owner ON external_runs(org_id,user_id,created DESC);
CREATE INDEX external_runs_active ON external_runs(status) WHERE kind='search' AND status IN ('queued','running');
