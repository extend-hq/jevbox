ALTER TABLE resources ADD COLUMN thumbnail_status TEXT NOT NULL DEFAULT 'pending' CHECK (thumbnail_status IN ('pending','queued','processing','ready','failed','unsupported'));
ALTER TABLE resources ADD COLUMN thumbnail_job_id UUID;
ALTER TABLE resources ADD COLUMN thumbnail_key TEXT;
ALTER TABLE resources ADD COLUMN thumbnail_width INTEGER;
ALTER TABLE resources ADD COLUMN thumbnail_height INTEGER;
ALTER TABLE resources ADD COLUMN thumbnail_pages INTEGER;
CREATE TABLE thumbnails (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  body BYTEA NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/webp'
);
CREATE INDEX thumbnail_pending ON resources(id) WHERE kind='document' AND thumbnail_status='pending';
