CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orgs(id TEXT PRIMARY KEY,name TEXT NOT NULL,settings TEXT NOT NULL DEFAULT '{}',authz_version TEXT);
CREATE TABLE IF NOT EXISTS members(org_id TEXT REFERENCES orgs(id),user_id TEXT REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('admin','member')),PRIMARY KEY(org_id,user_id));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),org_id TEXT REFERENCES orgs(id),expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,org_id TEXT REFERENCES orgs(id),email TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES orgs(id),owner_id TEXT NOT NULL REFERENCES users(id),parent_id TEXT,kind TEXT NOT NULL CHECK(kind IN ('folder','document')),name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',access TEXT NOT NULL DEFAULT 'restricted' CHECK(access IN ('restricted','organization','inherit','link')),mime TEXT,size INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'ready',error TEXT,parse_run TEXT,parsed TEXT,created TEXT NOT NULL,UNIQUE(id,org_id),FOREIGN KEY(parent_id,org_id) REFERENCES resources(id,org_id));
CREATE TABLE IF NOT EXISTS grants(resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('viewer','editor')),PRIMARY KEY(resource_id,user_id));
CREATE TABLE IF NOT EXISTS blobs(resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,body BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY,org_id TEXT REFERENCES orgs(id),user_id TEXT REFERENCES users(id),title TEXT NOT NULL,messages TEXT NOT NULL DEFAULT '[]',dependencies TEXT NOT NULL DEFAULT '[]',updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id BIGSERIAL PRIMARY KEY,org_id TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,resource_id TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS authz_dirty(org_id TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS authz_snapshots(version TEXT PRIMARY KEY,created TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS resource_org ON resources(org_id,parent_id);
CREATE INDEX IF NOT EXISTS chat_owner ON chats(org_id,user_id);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
CREATE OR REPLACE FUNCTION queue_authorization_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_org TEXT;
BEGIN
  IF TG_TABLE_NAME = 'grants' THEN
    SELECT org_id INTO target_org FROM resources WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.resource_id ELSE NEW.resource_id END;
  ELSE
    target_org := CASE WHEN TG_OP = 'DELETE' THEN OLD.org_id ELSE NEW.org_id END;
  END IF;
  IF target_org IS NOT NULL THEN
    INSERT INTO authz_dirty(org_id) VALUES(target_org) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER members_authorization AFTER INSERT OR UPDATE OR DELETE ON members FOR EACH ROW EXECUTE FUNCTION queue_authorization_sync();
CREATE TRIGGER grants_authorization AFTER INSERT OR UPDATE OR DELETE ON grants FOR EACH ROW EXECUTE FUNCTION queue_authorization_sync();
CREATE TRIGGER resources_authorization AFTER INSERT OR UPDATE OF owner_id,parent_id,access OR DELETE ON resources FOR EACH ROW EXECUTE FUNCTION queue_authorization_sync();
CREATE TRIGGER chats_authorization AFTER INSERT OR UPDATE OF user_id,org_id OR DELETE ON chats FOR EACH ROW EXECUTE FUNCTION queue_authorization_sync();

CREATE TABLE share_links(
  resource_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  token_hash TEXT NOT NULL UNIQUE,
  encrypted_token TEXT NOT NULL,
  FOREIGN KEY(resource_id,org_id) REFERENCES resources(id,org_id) ON DELETE CASCADE
);
CREATE TRIGGER share_links_authorization AFTER INSERT OR UPDATE OR DELETE ON share_links FOR EACH ROW EXECUTE FUNCTION queue_authorization_sync();

CREATE TABLE chat_turns (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  position BIGSERIAL NOT NULL,
  session_token TEXT NOT NULL,
  content TEXT NOT NULL,
  document_ids JSONB NOT NULL DEFAULT '[]',
  attachments JSONB NOT NULL DEFAULT '[]',
  selected_model JSONB,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','retrieving','generating','cancelling','completed','failed','cancelled','dismissed')),
  partial_text TEXT NOT NULL DEFAULT '',
  dependencies JSONB NOT NULL DEFAULT '[]',
  error TEXT,
  error_status INTEGER,
  lease_id TEXT,
  lease_until TIMESTAMPTZ,
  stream BOOLEAN NOT NULL DEFAULT true,
  regenerate_base TEXT,
  created TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_turns_queue ON chat_turns(chat_id,position);
CREATE UNIQUE INDEX chat_turns_active ON chat_turns(chat_id) WHERE status IN ('retrieving','generating','cancelling');
