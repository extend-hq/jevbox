ALTER TABLE document_filing ADD COLUMN is_review BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE organization_reviews (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  folder_ids JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','working','completed','failed','awaiting_key','disabled')),
  lease_id TEXT,
  lease_until TIMESTAMPTZ,
  error TEXT,
  created TEXT NOT NULL
);
CREATE INDEX organization_reviews_queue ON organization_reviews(state);
