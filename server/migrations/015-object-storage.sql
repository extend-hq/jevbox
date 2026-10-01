ALTER TABLE blobs ALTER COLUMN body DROP NOT NULL;
ALTER TABLE thumbnails ALTER COLUMN body DROP NOT NULL;
CREATE TABLE storage_objects (
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
  kind TEXT CHECK (kind IN ('document','thumbnail')),
  sha256 TEXT NOT NULL,
  size BIGINT NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(bucket,object_key),
  UNIQUE(resource_id,kind),
  CHECK (resource_id IS NULL OR kind IS NOT NULL)
);
CREATE INDEX storage_objects_cleanup ON storage_objects(created) WHERE resource_id IS NULL;
