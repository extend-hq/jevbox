# API and MCP access

Open **Settings → API keys** to create a personal key and view the API URL, copyable requests, parameters, and response documentation. MCP setup guides and connected apps are in **Settings → MCP**. All organization members can manage their own keys. The secret is returned only at creation; copy it before closing the dialog. Keys expire after at most one year and can be revoked immediately. Better Auth’s API Key plugin generates and hashes the secret, enforces expiry and shared rate limits, and handles revocation. Keys cannot act as browser sessions.

A key authenticates as its creator. Each request supplies an organization ID, and the server checks the creator's current membership and SpiceDB permissions. A key can access multiple organizations that its creator currently belongs to. Administration never bypasses private document or ancestor permissions. New keys can read and search accessible content and upload Private documents. Keys created before upload support remain read-only; create a new key to enable uploads. Keys have no separately configurable access scopes in the UI.

## REST API

Send `Authorization: Bearer <key>` to `/api/v1`. Cookie sessions are not accepted by this API. Browser endpoints retain their existing session and origin requirements; API keys can upload documents through the endpoint below. They cannot change permissions, manage keys, or modify existing resources.

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

`POST /api/v1/documents?organizationId=<organization UUID>&parentId=<optional folder UUID>` accepts `multipart/form-data` with exactly one `file` part. Put organization and folder IDs in the query string so membership and folder write access are checked before the server receives the file. Do not set Content-Type manually: your HTTP client must include its multipart boundary.

```sh
curl --fail-with-body "$JEVBOX_ORIGIN/api/v1/documents?organizationId=$ORGANIZATION_ID" \
  -H "Authorization: Bearer $JEVBOX_API_KEY" \
  -F 'file=@./document.pdf'
```

A successful upload returns HTTP 201:

```json
{
  "id": "<document UUID>",
  "name": "document.pdf",
  "size": 12345,
  "mime": "application/pdf",
  "status": "queued",
  "access": "private",
  "url": "<APP_ORIGIN>/library/documents/<document UUID>"
}
```

The creator owns the document. It starts Private even inside a shared folder, and upload cannot grant access to others. Indexable files enter the existing durable processing queue; other supported types are `stored`. HTTP 201 confirms storage and queued work, not completed indexing. Fetch returns 409 until indexing finishes; wait before retrying and use the returned URL to view processing status. Missing parser credentials can leave a document awaiting configuration. Retrying an upload creates another document; there is no upload idempotency key.

Supported extensions are PDF, DOCX, XLSX, PPTX, the app's UTF-8 text/code formats, PNG/JPEG/WebP/GIF/AVIF/BMP/SVG images, ZIP, and MP3/WAV/OGG/M4A/FLAC/MP4/WebM/MOV media. Media and ZIP are stored without indexing. Filenames are limited to 160 characters and cannot contain paths, control characters, colons, or a leading dot. MIME is derived by the server; filename extension alone is insufficient for PDF, image, and Office validation. Files are not executed, and raw downloads use the existing permission checks and sandbox headers.

Missing, expired, or revoked credentials return 401. Insufficient OAuth scopes return 403. Inaccessible organizations, documents, folders, and sections return 404. Permission-service failures return 503. Oversized uploads return 413, unsupported file types or compressed request bodies return 415, and admission/quota limits return 429 with Retry-After. Malformed files return 400; upload timeouts return 408. Rate limits return 429. Search is limited to 20 requests per minute per credential and 100 per organization per web process. The existing IP request limit also applies to REST and MCP traffic. Search can consume provider credits.

## MCP

Connect an MCP client to `<APP_ORIGIN>/mcp` using Streamable HTTP. The official TypeScript SDK v2 serves MCP 2026-07-28 and older clients through its stateless compatibility handler. MCP 2025-11-25 clients use the standard initialize handshake; SDK v2 clients can opt into 2026-07-28 with `versionNegotiation: { mode: { pin: "2026-07-28" } }`. Both protocols use the same authentication, current document permissions, and scoped tools:

| Tool                 | Arguments                                                                          |
| -------------------- | ---------------------------------------------------------------------------------- |
| `list_organizations` | None                                                                               |
| `search`             | The search request fields above, optional `requestId`, `waitSeconds`               |
| `answer`             | `organizationId`, `question`, optional `documentIds`, `selectedModel`, `requestId` |
| `get_run`            | `organizationId`, `runId`                                                          |
| `list_runs`          | `organizationId`, optional `limit` (1–50, default 20)                              |
| `cancel_run`         | `organizationId`, `runId`                                                          |
| `fetch`              | `organizationId`, `id`, optional `nodeId`, `offset`, `limit`                       |
| `upload_document`    | `organizationId`, `filename`, `contentBase64`, optional `parentId`                 |

Clients supporting custom headers can use the same personal API key in the Authorization header. New API keys advertise the read tools and `upload_document`. Read-only keys and OAuth grants omit the upload tool. Native clients omit Origin; browser origins must match APP_ORIGIN or an explicit comma-separated `MCP_ALLOWED_ORIGINS` entry. This does not enable browser CORS access.

Integration tests cover tool discovery, search, fetch, permission checks, credential revocation, and OAuth with both protocol versions. A local check on October 2, 2026 verified Cursor 3.22.12 browser sign-in, consent, tool discovery, and a `list_organizations` call. VS Code desktop has not been verified locally.

### Durable search and answers

MCP search and answer requests are admitted transactionally to PostgreSQL-backed jobs. Once accepted, work belongs to the server: losing the HTTP connection, refreshing the web app, or closing an MCP client does not cancel it. The worker must remain available. Closing a local coding agent still ends that agent's own execution; only the accepted Jevbox work continues.

`search` waits up to `waitSeconds` for a result (default 2, maximum 10). Set it to 0 for immediate admission. Completed replies retain the top-level `results` field; pending replies include a `runId`. `answer` returns a `runId` and `chatId` immediately, generates a cited answer using the configured chat model, and saves a private conversation visible in the web app. Its optional `selectedModel` has `provider` and `model` fields; attached documents are limited to eight and questions to 4,000 characters. Answers require both `search:read` and `documents:read` and can consume provider credits. The tool is advertised as a mutation because it saves a conversation.

Use `get_run` to retrieve status and output. Status is `queued`, `running`, `completed`, `failed`, or `cancelled`. Running answers expose saved `partialText` and a `phase`; completed answers return the saved message and citations in `result`. Completed searches return `result.results`. Pending replies include `retryAfterMs`; wait at least that long before polling. `list_runs` recovers recent run IDs after reconnecting, including when the client lost the admission response. These tools expose only the caller's own runs in organizations they can currently access.

Supply a UUID `requestId` before submitting work and reuse it with identical arguments if admission is uncertain. It becomes the run ID, preventing duplicate jobs during the 24-hour retention window. Changing arguments while reusing the identifier returns an error. Use a fresh identifier for an intentional new run or retry after failure. At most ten runs per user and organization can be active at once. Admission uses the existing search rate limits; polling does not consume search admission allowance.

`cancel_run` explicitly stops accepted work. Closing a transport stream is independent of this operation. Workers keep checking current membership, source permissions, and the credential or OAuth consent that authorized the job. Revoking a key, disconnecting an OAuth grant, or removing access stops affected work. Accepted OAuth work references its consent record, so normal five-minute access-token expiry does not stop a queued job; a new valid token is still required to retrieve it. A replacement OAuth grant does not revive work tied to a revoked grant. Saved search results are filtered against current source access, and inaccessible answer sources block the dependent conversation.

Run handles and search results expire after 24 hours. Saved answer conversations remain in chat until deleted. Web chat restores the latest persisted snapshot on load and reconnects to its live events; it does not replay individual token events. A worker interruption after answer generation begins preserves partial progress and requires an explicit retry, rather than silently repeating a model request. This is an ordinary MCP tool contract shared by both supported protocol versions; it does not require clients to support the optional MCP Tasks extension or transport replay. No Redis service is required.

OAuth clients can use browser sign-in and explicit consent. Better Auth’s MCP plugin, composed with JWT and CIMD, provides authorization-code grants with PKCE, Client ID Metadata Documents, an explicit dynamic-registration fallback, exact redirect validation, five-minute resource-bound access tokens, and refresh-token rotation with a 30-second retry overlap. DPoP proof verification and replay protection use Better Auth’s durable database adapter. Only user-delegated authorization and refresh grants are enabled. OAuth access tokens authenticate as the consenting user and are checked against live consent, membership, and document permissions on each request.

Public desktop clients that omit `application_type` are registered as native only when `token_endpoint_auth_method` is `none` and every redirect uses HTTP on `localhost`, `127.0.0.1`, or `[::1]`. The provider still validates each redirect, and explicit web registrations retain web redirect rules.

OAuth clients request these scopes, which can only narrow the user's current permissions:

| Scope             | Operations                                                             |
| ----------------- | ---------------------------------------------------------------------- |
| `search:read`     | Search accessible documents and return source passages                 |
| `documents:read`  | Read document structure, sections, and passages                        |
| `documents:write` | Upload a new Private document; does not edit, delete, or share content |

`upload_document` accepts standard padded base64 of the actual file bytes, without a data URL prefix or whitespace. Decoded content is limited to 2 MiB. A client must have access to the file and the user's authorization to transmit it. The server does not accept a local path or fetch a caller-supplied URL. For larger binary files, use the multipart REST endpoint with a credential authorized for `/api/v1`.

```json
{
  "organizationId": "<organization UUID>",
  "filename": "note.txt",
  "contentBase64": "SGVsbG8K"
}
```

The tool returns the same document metadata as REST. It is advertised as a mutation (`readOnlyHint=false`, `idempotentHint=false`). Failures use MCP `isError=true`. Existing OAuth grants do not gain upload permission automatically: reconnect and explicitly consent to `documents:write`. Read/search scopes remain sufficient for those tools.

Discovery endpoints:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-protected-resource/api/v1`
- `/.well-known/oauth-authorization-server/api/auth`

The issuer is `<APP_ORIGIN>/api/auth`; endpoints for authorization, registration, token exchange, and revocation are advertised in its metadata. Tokens issued for `/mcp` cannot be used at `/api/v1` unless that resource was also authorized. Request `offline_access` to receive refresh tokens. Sign-in is at `/oauth/sign-in`, and the consent page is at `/oauth/consent`.

**Connected apps** in **Settings → MCP** lists personal OAuth grants. Disconnecting deletes the consent and its stored tokens and invalidates already-issued access tokens, including after a subsequent reconnect. Already downloaded content remains with its recipient.

## Upload safeguards

Web chat's `search_documents` tool can narrow its search using optional `filters`: `createdAfter` and `createdBefore` (upload timestamps or inclusive UTC dates), `fileTypes` (PDF, document, spreadsheet, presentation, text, image, audio, video, archive), `access` (`private`, `organization`, `folder`, `link`), and a `folderId` UUID including its descendants. Values within a type or privacy list match any selection; distinct filters intersect. Attached documents further constrain the search. Sharing settings describe the document's mode, and every result still requires current access. The REST and MCP search contracts above are independent of these chat-only filters.

Browser, REST, and MCP uploads share these fixed defaults. Counters are stored in PostgreSQL and scoped to the user across all credentials and organizations; creating another key, switching clients, or restarting a web service does not reset them. Organization and deployment caps apply as well. Fixed windows use UTC.

| Limit                                                  | User    | Organization | Deployment |
| ------------------------------------------------------ | ------- | ------------ | ---------- |
| Upload attempts per minute                             | 5       | 20           | 60         |
| Upload attempts per hour                               | 20      | 100          | 300        |
| Accepted bytes per UTC day                             | 150 MiB | 1 GiB        | 2 GiB      |
| Stored document bytes                                  | 512 MiB | 2 GiB        | 5 GiB      |
| Documents with pending indexing, thumbnails, or filing | 10      | 50           | 100        |

Total document counts are capped at 1,000 per user, 5,000 per organization, and 10,000 per deployment, preventing tiny files from exhausting metadata storage. Stored-byte quotas include raw content and the indexed JSON, and workers enforce that quota before saving parsed output.

One upload per user and two upload/MCP requests per web process can hold a body at once. Read-only MCP processing releases its buffering slot once the body is parsed. Additional requests are rejected immediately with 429. Request receipt and processing have a 30-second deadline; disconnected requests are cancelled, and their slots remain held until processing exits. Multipart files are at most 30 MiB, text/SVG files at most 2 MiB, and inline MCP files at most 2 MiB decoded (3 MiB total JSON). Multipart metadata and part counts are bounded. Compressed request bodies are rejected. Permission and credential checks occur before body buffering and again before persistence completes.

Office ZIP containers are validated without extracting paths to disk: at most 2,000 entries, 8 MiB per entry, 32 MiB total expansion, and bounded compression ratios. Actual inflation is checked against declared sizes with a capped asynchronous decoder. Encrypted, malformed, traversal, and duplicate-entry archives are rejected. Images are limited to 40 million pixels. SVGs reject active content, document type/entity declarations, and external references. Thumbnail renderer JavaScript heaps are capped at 256 MiB with a single renderer process. Background indexing and thumbnails have bounded concurrency and timeouts; they run on the separate Render worker, not the web service. These controls bound ordinary resource abuse; they are not a guarantee against every denial-of-service attack or parser vulnerability. Keep the separate services and Render resource limits, monitor 429s, queue depth, storage, and memory, and increase quotas only after capacity testing. No antivirus scan is performed.

Text inputs are additionally capped at 50,000 lines, 1,000 form-feed pages, and 2,000 headings. Parser JSON responses are streamed with a 16 MiB ceiling. Index construction allows at most 2,000 chunks, 10,000 blocks, 5,000 section nodes, and four million source-text characters; repeated block assignments are capped at 100,000 references and 32 MiB of referenced text. Excessive structure fails processing with a visible error instead of generating unbounded metadata.

The quota policy is defined in `shared/uploads.ts`. Upload counter storage is created by the normal migration. Counter updates and storage/queue admission are transactional, preventing concurrent uploads from racing past limits. Rejected validation attempts consume request allowance; failed storage does not consume accepted-byte allowance. Deleting a document frees its stored-byte quota but does not reset the daily accepted-byte counter.

## Operations

The normal database migration adds Better Auth organization, invitation, API-key, and OAuth storage automatically. The unreleased custom API keys and pending invitations are invalidated; account IDs, memberships, and documents are preserved. Preserve BETTER_AUTH_SECRET and the application encryption key across restarts so persisted signing material remains usable. Use a public HTTPS APP_ORIGIN for deployed clients. OAuth registration has its own Better Auth rate limits; search and document operations record their actor and organization in the audit log without queries, source text, or secrets.
