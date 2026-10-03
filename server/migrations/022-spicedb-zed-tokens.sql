ALTER TABLE orgs ADD COLUMN authz_token TEXT CHECK (authz_token IS NULL OR length(authz_token) > 0);
