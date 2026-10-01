CREATE TABLE "rateLimit" (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  count INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);
DROP TABLE auth_throttle;
DROP TABLE oauth_revocations;
UPDATE chat_turns SET status='failed',error='Please sign in and retry.',error_status=401
WHERE status IN ('queued','retrieving','generating','cancelling');
