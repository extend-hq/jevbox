CREATE TABLE api_keys (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  scopes JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX api_keys_user ON api_keys(user_id);

CREATE TABLE oauth_revocations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  revoked_at BIGINT NOT NULL,
  PRIMARY KEY (user_id,client_id)
);

CREATE TABLE "jwks" (
  id TEXT PRIMARY KEY,
  "publicKey" TEXT NOT NULL,
  "privateKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ,
  "alg" TEXT,
  "crv" TEXT
);

CREATE TABLE "oauthClient" (
  id TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL UNIQUE,
  "clientSecret" TEXT,
  "clientDiscoveryId" TEXT,
  "disabled" BOOLEAN DEFAULT false,
  "skipConsent" BOOLEAN,
  "enableEndSession" BOOLEAN,
  "subjectType" TEXT,
  "scopes" TEXT,
  "clientCredentialsScopes" TEXT DEFAULT '[]',
  "userId" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "name" TEXT,
  "uri" TEXT,
  "icon" TEXT,
  "contacts" TEXT,
  "tos" TEXT,
  "policy" TEXT,
  "softwareId" TEXT,
  "softwareVersion" TEXT,
  "softwareStatement" TEXT,
  "redirectUris" TEXT NOT NULL,
  "postLogoutRedirectUris" TEXT,
  "backchannelLogoutUri" TEXT,
  "backchannelLogoutSessionRequired" BOOLEAN,
  "tokenEndpointAuthMethod" TEXT,
  "applicationType" TEXT,
  "jwks" TEXT,
  "jwksUri" TEXT,
  "grantTypes" TEXT,
  "responseTypes" TEXT,
  "requirePKCE" BOOLEAN,
  "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
  "referenceId" TEXT,
  "metadata" JSONB
);
CREATE INDEX "oauthClient_userId" ON "oauthClient"("userId");

CREATE TABLE "oauthResource" (
  id TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "accessTokenTtl" INTEGER,
  "refreshTokenTtl" INTEGER,
  "signingAlgorithm" TEXT,
  "signingKeyId" TEXT,
  "allowedScopes" TEXT,
  "customClaims" JSONB,
  "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
  "disabled" BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "policyVersion" INTEGER DEFAULT 1,
  "metadata" JSONB
);

CREATE TABLE "oauthClientResource" (
  id TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "resourceId" TEXT NOT NULL REFERENCES "oauthResource"("identifier") ON DELETE CASCADE,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ,
  UNIQUE ("clientId", "resourceId")
);
CREATE INDEX "oauthClientResource_clientId" ON "oauthClientResource"("clientId");
CREATE INDEX "oauthClientResource_resourceId" ON "oauthClientResource"("resourceId");

CREATE TABLE "oauthRefreshToken" (
  id TEXT PRIMARY KEY,
  "token" TEXT NOT NULL UNIQUE,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "sessionId" TEXT REFERENCES "auth_sessions"("id") ON DELETE SET NULL,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "referenceId" TEXT,
  "authorizationCodeId" TEXT,
  "resources" TEXT,
  "requestedUserInfoClaims" TEXT,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "revoked" TIMESTAMPTZ,
  "rotatedAt" TIMESTAMPTZ,
  "rotationReplayResponse" TEXT,
  "rotationReplayExpiresAt" TIMESTAMPTZ,
  "authTime" TIMESTAMPTZ,
  "confirmation" JSONB,
  "scopes" TEXT NOT NULL
);
CREATE INDEX "oauthRefreshToken_clientId" ON "oauthRefreshToken"("clientId");
CREATE INDEX "oauthRefreshToken_sessionId" ON "oauthRefreshToken"("sessionId");
CREATE INDEX "oauthRefreshToken_userId" ON "oauthRefreshToken"("userId");
CREATE INDEX "oauthRefreshToken_authorizationCodeId" ON "oauthRefreshToken"("authorizationCodeId");

CREATE TABLE "oauthAccessToken" (
  id TEXT PRIMARY KEY,
  "token" TEXT NOT NULL UNIQUE,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "sessionId" TEXT REFERENCES "auth_sessions"("id") ON DELETE SET NULL,
  "userId" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "referenceId" TEXT,
  "authorizationCodeId" TEXT,
  "resources" TEXT,
  "requestedUserInfoClaims" TEXT,
  "refreshId" TEXT REFERENCES "oauthRefreshToken"("id") ON DELETE CASCADE,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "revoked" TIMESTAMPTZ,
  "confirmation" JSONB,
  "scopes" TEXT NOT NULL
);
CREATE INDEX "oauthAccessToken_clientId" ON "oauthAccessToken"("clientId");
CREATE INDEX "oauthAccessToken_sessionId" ON "oauthAccessToken"("sessionId");
CREATE INDEX "oauthAccessToken_userId" ON "oauthAccessToken"("userId");
CREATE INDEX "oauthAccessToken_authorizationCodeId" ON "oauthAccessToken"("authorizationCodeId");
CREATE INDEX "oauthAccessToken_refreshId" ON "oauthAccessToken"("refreshId");

CREATE TABLE "oauthConsent" (
  id TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "userId" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "referenceId" TEXT,
  "resources" TEXT,
  "requestedUserInfoClaims" TEXT,
  "scopes" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX "oauthConsent_clientId" ON "oauthConsent"("clientId");
CREATE INDEX "oauthConsent_userId" ON "oauthConsent"("userId");

CREATE TABLE "oauthClientAssertion" (
  id TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL
);
