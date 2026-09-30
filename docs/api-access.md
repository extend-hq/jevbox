# API and MCP access

Open **Organization → API keys** to create a personal key. All organization members can manage their own keys. The secret is returned only at creation; copy it before closing the dialog. Keys expire after at most one year and can be revoked immediately. Better Auth’s API Key plugin generates and hashes the secret, enforces expiry and shared rate limits, and handles revocation. Keys cannot act as browser sessions.

A key authenticates as its creator. Each request supplies an organization ID, and the server checks the creator's current membership and SpiceDB permissions. A key can access multiple organizations that its creator currently belongs to. Administration never bypasses restricted document or ancestor permissions. Every key has full read and search access to content its creator can currently access. Keys have no separately configurable access scopes.

## REST API

Send `Authorization: Bearer <key>` to `/api/v1`. Cookie sessions are not accepted by this API. Browser endpoints retain their existing session and origin requirements; API keys cannot upload, change permissions, manage keys, or modify resources.

`GET /api/v1/organizations` lists the caller's accessible organization IDs and names.

`POST /api/v1/search` accepts:

```json
{
  "organizationId": "<organization UUID>",
  "query": "<self-contained question>",
  "documentIds": [],
  "limit": 12
}
```

`documentIds` optionally narrows search to up to 50 accessible documents. An optional `folderId` searches only accessible descendants of that folder. Combining both takes their intersection; an empty folder returns no results. `limit` is between 1 and 12. Queries are limited to 2,000 characters.

The response's `results` contain an `id`, `documentId`, `nodeId`, `passageId`, `name`, `title`, `content`, `page`, `endPage`, `blockIds`, `url`, usefulness `score`, and `routeScore`. Route scores rank traversal paths and are not calibrated answer-confidence values. Search uses the organization's configured TypeSafe connection and the same bounded hierarchical retrieval as the app. Results may be empty and are not exhaustive.

`GET /api/v1/documents/:id?organizationId=<organization UUID>` returns source `text`, a section `tree`, page/block references, and a URL. The ID can be a document UUID or an `id` returned by search. Optional `nodeId` selects a section. `offset` and `limit` page through text; limits are at most 24,000 characters, with a default of 12,000. Continue from `nextOffset` until it is null. Unindexed documents return 409.

Missing, expired, or revoked credentials return 401. Insufficient OAuth scopes return 403. Inaccessible organizations, documents, folders, and sections return 404. Permission-service failures return 503. Rate limits return 429. Search is limited to 20 requests per minute per credential and 100 per organization using shared PostgreSQL counters. The existing IP request limit also applies to REST and MCP traffic. Search can consume provider credits.

## MCP

Connect an MCP client to `<APP_ORIGIN>/mcp` using Streamable HTTP. Configure SDK v2 clients with `versionNegotiation: { mode: { pin: "2026-07-28" } }`. Older protocol revisions are rejected. The server uses the stateless MCP 2026-07-28 protocol and official TypeScript SDK v2, and offers read-only tools:

| Tool                 | Arguments                                                    |
| -------------------- | ------------------------------------------------------------ |
| `list_organizations` | None                                                         |
| `search`             | The search request fields above                              |
| `fetch`              | `organizationId`, `id`, optional `nodeId`, `offset`, `limit` |

Clients supporting custom headers can use the same personal API key in the Authorization header. API keys advertise all three tools. Native clients omit Origin; browser origins must match APP_ORIGIN or an explicit comma-separated `MCP_ALLOWED_ORIGINS` entry. This does not enable browser CORS access.

OAuth clients can use browser sign-in and explicit consent. Better Auth’s MCP plugin, composed with JWT and CIMD, provides authorization-code grants with PKCE, Client ID Metadata Documents, an explicit dynamic-registration fallback, exact redirect validation, five-minute resource-bound access tokens, and refresh-token rotation with a 30-second retry overlap. DPoP proof verification and replay protection use Better Auth’s durable database adapter. Only user-delegated authorization and refresh grants are enabled. OAuth access tokens authenticate as the consenting user and are checked against live consent, membership, and document permissions on each request.

OAuth clients request these scopes, which can only narrow the user's current permissions:

| Scope            | Operations                                             |
| ---------------- | ------------------------------------------------------ |
| `search:read`    | Search accessible documents and return source passages |
| `documents:read` | Read document structure, sections, and passages        |

Discovery endpoints:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-protected-resource/api/v1`
- `/.well-known/oauth-authorization-server/api/auth`

The issuer is `<APP_ORIGIN>/api/auth`; endpoints for authorization, registration, token exchange, and revocation are advertised in its metadata. Tokens issued for `/mcp` cannot be used at `/api/v1` unless that resource was also authorized. Request `offline_access` to receive refresh tokens. Sign-in is at `/oauth/sign-in`, and the consent page is at `/oauth/consent`.

**Connected apps** in the API keys tab lists personal OAuth grants. Disconnecting deletes the consent and its stored tokens and invalidates already-issued access tokens, including after a subsequent reconnect. Already downloaded content remains with its recipient.

## Operations

The normal database migration adds Better Auth organization, invitation, API-key, and OAuth storage automatically. The unreleased custom API keys and pending invitations are invalidated; account IDs, memberships, and documents are preserved. Preserve BETTER_AUTH_SECRET and the application encryption key across restarts so persisted signing material remains usable. Use a public HTTPS APP_ORIGIN for deployed clients. OAuth registration has its own Better Auth rate limits; search and document operations record their actor and organization in the audit log without queries, source text, or secrets.
