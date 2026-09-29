CREATE TABLE document_filing (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  scope_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','working','completed','failed','awaiting_key','disabled')),
  outcome JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  lease_id TEXT,
  lease_until TIMESTAMPTZ
);
CREATE INDEX document_filing_queue ON document_filing(state);
