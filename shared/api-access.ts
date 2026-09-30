export const apiScopes = ["search:read", "documents:read"] as const;
export type ApiScope = (typeof apiScopes)[number];
export const scopeLabels: Record<ApiScope, string> = {
  "search:read": "Search documents",
  "documents:read": "Read documents and sections",
};
export type ApiKeyInfo = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
export type ConnectedApp = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
};
