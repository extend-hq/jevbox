CREATE TABLE upload_usage (
  subject TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  period INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (subject, bucket, period)
);
CREATE INDEX upload_usage_expiry ON upload_usage(expires_at);
CREATE INDEX resources_upload_owner ON resources(owner_id) WHERE kind='document';
