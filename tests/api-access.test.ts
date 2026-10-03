import { isScoreRequest, scoreResponse } from "./model-tools";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { deriveDpopAth } from "better-auth/oauth2";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, request as httpRequest } from "node:http";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createApp } from "../server/app";
import { hashPassword } from "better-auth/crypto";
import { buildIndex } from "../server/indexing";
import { uploadLimits } from "../shared/uploads";
import { testDatabase } from "./database";
import { choiceResponse } from "./model-tools";

let origin = "http://localhost:4310";
const headers = {
  Origin: origin,
  "X-Jevbox-Request": "1",
  "Content-Type": "application/json",
};
let runtime: Awaited<ReturnType<typeof createApp>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let server: ReturnType<typeof runtime.app.listen>;
let base: string;
let directory: string;
const userId = randomUUID(),
  otherId = randomUUID();
const orgId = randomUUID(),
  secondOrgId = randomUUID(),
  foreignOrgId = randomUUID();
const privateId = randomUUID(),
  sharedId = randomUUID(),
  foreignId = randomUUID();
const ownId = randomUUID(),
  secondId = randomUUID(),
  emptyFolderId = randomUUID();
let cookie: string, otherCookie: string;
let onScore: (() => Promise<void>) | undefined;
const outbound: string[] = [];
const fetcher: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body));
  outbound.push(JSON.stringify(body));
  if (isScoreRequest(body)) {
    await onScore?.();
    return scoreResponse(body, 3);
  }
  return choiceResponse(body);
};
async function session(
  path: string,
  method = "GET",
  body?: unknown,
  auth = cookie,
) {
  return fetch(base + "/api" + path, {
    method,
    headers: { ...headers, Cookie: auth },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
}
async function request(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  if (path === "/mcp" && body && typeof body === "object") {
    body = {
      ...body,
      params: {
        ...(body as { params?: object }).params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "Integration",
            version: "1",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    };
  }
  return fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(path === "/mcp"
        ? {
            "MCP-Protocol-Version": "2026-07-28",
            "Mcp-Method": String((body as { method?: string })?.method),
            ...((body as { params?: { name?: string } })?.params?.name
              ? {
                  "Mcp-Name": (body as { params: { name: string } }).params
                    .name,
                }
              : {}),
          }
        : {}),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
}
async function key(auth = cookie) {
  const response = await session(
    "/auth/api-key/create",
    "POST",
    { name: "Integration", expiresIn: 30 * 86400 },
    auth,
  );
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  return { key: { id: result.id }, token: result.key };
}
async function login(email: string) {
  const response = await session(
    "/auth/sign-in/email",
    "POST",
    { email, password: "a-secure-password-123!" },
    "",
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
before(async () => {
  database = await testDatabase();
  server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = origin = `http://127.0.0.1:${address.port}`;
  headers.Origin = origin;
  directory = mkdtempSync(join(tmpdir(), "jevbox-api-"));
  runtime = await createApp({
    workers: ["external-search"],
    directory,
    databaseUrl: database.url,
    origin,
    rateLimits: false,
    fetcher,
  });
  server.on("request", runtime.app);
  const password = await hashPassword("a-secure-password-123!");
  await runtime.store.transaction(async () => {
    for (const [id, address] of [
      [userId, "api@local.test"],
      [otherId, "owner@local.test"],
    ]) {
      await runtime.store.run(
        "INSERT INTO users(id,email,name,email_verified) VALUES(?,?,?,true)",
        id,
        address,
        "Member",
      );
      await runtime.store.run(
        "INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password) VALUES(?,?,'credential',?,?)",
        randomUUID(),
        id,
        id,
        password,
      );
    }
    for (const id of [orgId, secondOrgId, foreignOrgId])
      await runtime.store.run(
        "INSERT INTO orgs(id,name,settings) VALUES(?,?,?)",
        id,
        "Workspace",
        runtime.store.encrypt(JSON.stringify({ jevKey: "test-provider" })),
      );
    for (const [org, user, role] of [
      [orgId, userId, "member"],
      [orgId, otherId, "admin"],
      [secondOrgId, userId, "admin"],
      [foreignOrgId, otherId, "admin"],
    ])
      await runtime.store.run(
        "INSERT INTO members(org_id,user_id,role) VALUES(?,?,?)",
        org,
        user,
        role,
      );
    for (const [id, org, owner, access, text] of [
      [privateId, orgId, otherId, "restricted", "Hidden passage"],
      [sharedId, orgId, otherId, "restricted", "Shared passage"],
      [foreignId, foreignOrgId, otherId, "organization", "Foreign passage"],
      [ownId, orgId, userId, "restricted", "Readable passage"],
      [secondId, secondOrgId, userId, "restricted", "Second workspace passage"],
    ]) {
      const parsed = buildIndex(
        [
          {
            content: `# Section\n\n${text}`,
            metadata: { pageRange: { start: 1, end: 1 } },
            blocks: [],
          },
        ],
        "text",
      );
      await runtime.store.run(
        "INSERT INTO resources(id,org_id,owner_id,kind,name,access,parsed,created) VALUES(?,?,?,'document',?,?,?,?)",
        id,
        org,
        owner,
        "Document",
        access,
        JSON.stringify(parsed),
        new Date().toISOString(),
      );
    }
    await runtime.store.run(
      "INSERT INTO resources(id,org_id,owner_id,kind,name,created) VALUES(?,?,?,'folder',?,?)",
      emptyFolderId,
      orgId,
      userId,
      "Empty folder",
      new Date().toISOString(),
    );
    await runtime.store.run(
      "INSERT INTO grants VALUES(?,?,'viewer')",
      sharedId,
      userId,
    );
  });
  cookie = await login("api@local.test");
  otherCookie = await login("owner@local.test");
});
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (database) await database.cleanup(runtime?.store);
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("keys are personal, hashed, shown once, expire, and cannot mutate or manage keys", async () => {
  const created = await key();
  const stored = await runtime.store.one<{ token_hash: string }>(
    "SELECT key AS token_hash FROM apikey WHERE id=?",
    created.key.id,
  );
  assert.notEqual(stored!.token_hash, created.token);
  const list = await session("/auth/api-key/list");
  const body = await list.text();
  assert.ok(body.includes(created.key.id));
  assert.ok(!body.includes(created.token));
  assert.ok(!body.includes("token_hash"));
  assert.ok(
    !(
      await (
        await session("/auth/api-key/list", "GET", undefined, otherCookie)
      ).text()
    ).includes(created.key.id),
  );
  assert.equal(
    (
      await session(
        "/auth/api-key/update",
        "POST",
        { keyId: created.key.id, enabled: false },
        otherCookie,
      )
    ).status,
    404,
  );
  assert.equal((await request("/api/api-keys", created.token)).status, 401);
  assert.equal(
    (await request("/api/folders", created.token, "POST", { name: "Folder" }))
      .status,
    403,
  );
  await runtime.store.run(
    "UPDATE apikey SET \"expiresAt\"=now()-interval '1 second' WHERE id=?",
    created.key.id,
  );
  assert.equal(
    (await request("/api/v1/organizations", created.token)).status,
    401,
  );
  assert.equal(
    (
      await session("/auth/api-key/create", "POST", {
        name: "Invalid",
        scopes: ["documents:write"],
      })
    ).status,
    400,
  );
});
test("API keys authorize the creator across current memberships, including grants and ancestor restrictions", async () => {
  const created = await key();
  const organizations = await (
    await request("/api/v1/organizations", created.token)
  ).json();
  assert.deepEqual(
    new Set(organizations.organizations.map((org: any) => org.id)),
    new Set([orgId, secondOrgId]),
  );
  const url = (id: string, org = orgId) =>
    `/api/v1/documents/${id}?organizationId=${org}`;
  assert.equal((await request(url(privateId), created.token)).status, 404);
  assert.equal((await request(url(foreignId), created.token)).status, 404);
  assert.equal(
    (await request(url(foreignId, foreignOrgId), created.token)).status,
    404,
  );
  assert.equal(
    (await request(url(secondId, secondOrgId), created.token)).status,
    200,
  );
  const shared = await request(url(sharedId), created.token);
  assert.equal(shared.status, 200);
  assert.match((await shared.json()).text, /Shared passage/);
  const folderId = randomUUID();
  await runtime.store.transaction(async () => {
    await runtime.store.run(
      "INSERT INTO resources(id,org_id,owner_id,kind,name,created) VALUES(?,?,?,'folder',?,?)",
      folderId,
      orgId,
      otherId,
      "Restricted category",
      new Date().toISOString(),
    );
    await runtime.store.run(
      "UPDATE resources SET parent_id=? WHERE id=?",
      folderId,
      sharedId,
    );
  });
  assert.equal((await request(url(sharedId), created.token)).status, 404);
  await runtime.store.run(
    "UPDATE resources SET parent_id=NULL WHERE id=?",
    sharedId,
  );
  await runtime.store.run(
    "DELETE FROM grants WHERE resource_id=? AND user_id=?",
    sharedId,
    userId,
  );
  assert.equal((await request(url(sharedId), created.token)).status, 404);
  await runtime.store.run(
    "INSERT INTO grants VALUES(?,?,'viewer')",
    sharedId,
    userId,
  );
});
test("search keeps unauthorized content out of routing and fetches returned passages", async () => {
  const created = await key();
  outbound.length = 0;
  const response = await request("/api/v1/search", created.token, "POST", {
    organizationId: orgId,
    query: "Find passages",
    limit: 1,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.results.length, 1);
  const text = outbound.join("\n");
  assert.ok(!text.includes("Hidden passage"));
  assert.ok(!text.includes("Foreign passage"));
  const source = result.results[0];
  const fetched = await request(
    `/api/v1/documents/${source.id}?organizationId=${orgId}`,
    created.token,
  );
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).text, source.content);
  const empty = await request("/api/v1/search", created.token, "POST", {
    organizationId: orgId,
    query: "Anything",
    folderId: emptyFolderId,
  });
  assert.deepEqual((await empty.json()).results, []);
  assert.equal(
    (
      await request("/api/v1/search", created.token, "POST", {
        organizationId: orgId,
        query: "Anything",
        documentIds: [privateId],
      })
    ).status,
    404,
  );
});
test("revocation during retrieval and membership removal prevent returning evidence", async () => {
  const created = await key();
  let ran = false;
  onScore = async () => {
    if (!ran) {
      ran = true;
      await session("/auth/api-key/update", "POST", {
        keyId: created.key.id,
        enabled: false,
      });
    }
  };
  try {
    assert.equal(
      (
        await request("/api/v1/search", created.token, "POST", {
          organizationId: orgId,
          query: "Anything",
        })
      ).status,
      401,
    );
  } finally {
    onScore = undefined;
  }
  const next = await key();
  await runtime.store.run(
    "DELETE FROM members WHERE user_id=? AND org_id=?",
    userId,
    secondOrgId,
  );
  assert.equal(
    (
      await request(
        `/api/v1/documents/${secondId}?organizationId=${secondOrgId}`,
        next.token,
      )
    ).status,
    404,
  );
  await runtime.store.run(
    "INSERT INTO members(org_id,user_id,role) VALUES(?,?,'admin')",
    secondOrgId,
    userId,
  );
});
for (const protocolVersion of ["2026-07-28", "2025-11-25"])
  test(`MCP ${protocolVersion} works through the official client with full read and search access`, async () => {
    const created = await key();
    const client = new Client(
      { name: "integration-test", version: "1.0.0" },
      {
        supportedProtocolVersions: [protocolVersion],
        versionNegotiation: {
          mode:
            protocolVersion === "2026-07-28"
              ? { pin: protocolVersion }
              : "legacy",
        },
      },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(base + "/mcp"),
      {
        requestInit: { headers: { Authorization: `Bearer ${created.token}` } },
      },
    );
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
        "answer",
        "cancel_run",
        "fetch",
        "get_run",
        "list_organizations",
        "list_runs",
        "search",
        "upload_document",
      ]);
      const organizations = await client.callTool({
        name: "list_organizations",
        arguments: {},
      });
      assert.equal(organizations.isError, undefined);
      assert.deepEqual(
        (organizations.structuredContent as any).organizations
          .map((org: any) => org.id)
          .sort(),
        [orgId, secondOrgId].sort(),
      );
      const found = await client.callTool({
        name: "search",
        arguments: {
          organizationId: orgId,
          query: "Find evidence",
          documentIds: [ownId],
        },
      });
      assert.equal(found.isError, undefined);
      const data = found.structuredContent as any;
      assert.ok(data.results.length);
      const fetched = await client.callTool({
        name: "fetch",
        arguments: { organizationId: orgId, id: data.results[0].id },
      });
      assert.match((fetched.structuredContent as any).text, /Readable passage/);
      for (const input of [
        { organizationId: orgId, id: privateId },
        { organizationId: foreignOrgId, id: foreignId },
      ]) {
        const denied = await client.callTool({
          name: "fetch",
          arguments: input,
        });
        assert.equal(denied.isError, true);
        assert.equal(denied.structuredContent, undefined);
      }
      await session("/auth/api-key/update", "POST", {
        keyId: created.key.id,
        enabled: false,
      });
      await assert.rejects(client.listTools());
    } finally {
      await client.close();
    }
  });

async function legacyTools(token: string) {
  const client = new Client(
    { name: "integration-test", version: "1.0.0" },
    {
      supportedProtocolVersions: ["2025-11-25"],
      versionNegotiation: { mode: "legacy" },
    },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return await client.listTools();
  } finally {
    await client.close();
  }
}

test("legacy MCP requires authentication and advertises OAuth discovery", async () => {
  const response = await fetch(base + "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "integration-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(response.status, 401);
  assert.match(
    response.headers.get("www-authenticate")!,
    /oauth-protected-resource\/mcp/,
  );
  await assert.rejects(legacyTools("invalid-token"));
});
test("public loopback OAuth registration infers native clients without relaxing redirect validation", async () => {
  async function register(redirect_uris: string[], extra: object = {}) {
    return fetch(base + "/api/auth/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test connector",
        redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        ...extra,
      }),
    });
  }
  const accepted = await register([
    "http://localhost:8787/callback",
    "http://127.0.0.1:9900/callback",
    "http://[::1]:9900/callback",
  ]);
  assert.equal(accepted.status, 201, await accepted.clone().text());
  for (const [redirects, extra] of [
    [["http://localhost:8787/callback"], { application_type: "web" }],
    [
      ["http://localhost:8787/callback"],
      { token_endpoint_auth_method: "client_secret_basic" },
    ],
    [["http://localhost:8787/callback", "http://external.test/callback"], {}],
    [["http://localhost.:8787/callback"], {}],
    [["http://localhost:8787/callback#fragment"], {}],
    [["http://user:password@localhost:8787/callback"], {}],
  ] as const) {
    const rejected = await register([...redirects], extra);
    assert.equal(rejected.status, 400, await rejected.clone().text());
  }
});

test("OAuth discovery, registration, PKCE, consent, audience validation, refresh, and disconnect", async () => {
  const metadataResponse = await fetch(
    base + "/.well-known/oauth-authorization-server/api/auth",
  );
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.issuer, origin + "/api/auth");
  assert.equal(metadata.client_id_metadata_document_supported, true);
  const protectedMetadata = await (
    await fetch(base + "/.well-known/oauth-protected-resource/mcp")
  ).json();
  assert.equal(protectedMetadata.resource, origin + "/mcp");
  assert.ok(protectedMetadata.dpop_signing_alg_values_supported.length);
  const unauthenticated = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(unauthenticated.status, 401);
  assert.match(
    unauthenticated.headers.get("www-authenticate")!,
    /oauth-protected-resource\/mcp/,
  );
  const register = await fetch(base + "/api/auth/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test connector",
      redirect_uris: ["http://127.0.0.1:9900/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      scope: "search:read documents:read offline_access",
    }),
  });
  assert.equal(register.status, 201, await register.clone().text());
  const registration = await register.json();
  const verifier = "v".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: registration.client_id,
    redirect_uri: "http://127.0.0.1:9900/callback",
    response_type: "code",
    scope: "search:read documents:read offline_access",
    resource: origin + "/mcp",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "request-state",
  });
  const authorize = await fetch(base + "/api/auth/oauth2/authorize?" + params, {
    headers: { Accept: "text/html" },
    redirect: "manual",
  });
  assert.ok(
    [200, 302].includes(authorize.status),
    await authorize.clone().text(),
  );
  const loginURL = new URL(
    authorize.status === 302
      ? authorize.headers.get("location")!
      : (await authorize.json()).url,
    origin,
  );
  assert.equal(loginURL.pathname, "/login");
  const signIn = await session(
    "/auth/sign-in/email",
    "POST",
    {
      email: "api@local.test",
      password: "a-secure-password-123!",
      oauth_query: loginURL.search.slice(1),
    },
    "",
  );
  assert.equal(signIn.status, 200, await signIn.clone().text());
  const signedIn = await signIn.json();
  assert.equal(signedIn.redirect, true);
  const consentURL = new URL(signedIn.url, origin);
  cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.equal(consentURL.pathname, "/oauth/consent");
  const preview = await session("/auth/oauth2/public-client-prelogin", "POST", {
    client_id: registration.client_id,
    oauth_query: consentURL.search.slice(1),
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const tampered = new URLSearchParams(consentURL.search);
  tampered.set("scope", "documents:write");
  assert.notEqual(
    (
      await session("/auth/oauth2/public-client-prelogin", "POST", {
        client_id: registration.client_id,
        oauth_query: tampered.toString(),
      })
    ).status,
    200,
  );
  const accept = await session("/auth/oauth2/consent", "POST", {
    accept: true,
    oauth_query: consentURL.search.slice(1),
  });
  assert.equal(accept.status, 200, await accept.clone().text());
  const redirect = new URL((await accept.json()).url);
  assert.equal(redirect.searchParams.get("state"), "request-state");
  async function exchange(body: URLSearchParams, proof?: string) {
    return fetch(base + "/api/auth/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(proof ? { DPoP: proof } : {}),
      },
      body,
    });
  }
  const code = redirect.searchParams.get("code")!;
  const tokensResponse = await exchange(
    new URLSearchParams({
      client_id: registration.client_id,
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://127.0.0.1:9900/callback",
      code_verifier: verifier,
      resource: origin + "/mcp",
    }),
  );
  assert.equal(tokensResponse.status, 200, await tokensResponse.clone().text());
  const tokens = await tokensResponse.json();
  const storedTokens = await runtime.store.all<{ token: string }>(
    'SELECT token FROM "oauthAccessToken" WHERE "clientId"=? AND "userId"=?',
    registration.client_id,
    userId,
  );
  assert.ok(storedTokens.length > 0);
  assert.ok(storedTokens.every(({ token }) => token !== tokens.access_token));
  assert.ok(tokens.refresh_token);
  const rpc = await request("/mcp", tokens.access_token, "POST", {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  assert.equal(rpc.status, 200, await rpc.clone().text());
  assert.deepEqual(
    (await legacyTools(tokens.access_token)).tools
      .map((tool) => tool.name)
      .sort(),
    [
      "answer",
      "cancel_run",
      "fetch",
      "get_run",
      "list_organizations",
      "list_runs",
      "search",
    ],
  );
  assert.equal(
    (await request("/api/v1/organizations", tokens.access_token)).status,
    401,
  );
  const refresh = await exchange(
    new URLSearchParams({
      client_id: registration.client_id,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      resource: origin + "/mcp",
    }),
  );
  assert.equal(refresh.status, 200, await refresh.clone().text());
  const refreshed = await refresh.json();
  async function heldSearch() {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    onScore = async () => {
      entered();
      await gate;
    };
    const runId = randomUUID();
    const admitted = await request("/mcp", refreshed.access_token, "POST", {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "search",
        arguments: {
          organizationId: orgId,
          query: "Find evidence",
          documentIds: [ownId],
          requestId: runId,
          waitSeconds: 0,
        },
      },
    });
    assert.equal(admitted.status, 200, await admitted.clone().text());
    const reply = (await admitted.json()).result;
    assert.equal(reply.isError, undefined, JSON.stringify(reply.content));
    assert.equal(reply.structuredContent.runId, runId);
    await started;
    return { runId, release };
  }
  async function waitRun(runId: string, status: string) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const row = await runtime.store.one<{ status: string }>(
        "SELECT status FROM external_runs WHERE id=?",
        runId,
      );
      if (row?.status === status) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.fail(`Run did not reach ${status}`);
  }
  const expiring = await heldSearch();
  try {
    await runtime.store.run(
      'UPDATE "oauthAccessToken" SET "expiresAt"=now()-interval \'1 second\' WHERE "clientId"=? AND "userId"=?',
      registration.client_id,
      userId,
    );
    assert.equal(
      (
        await request("/mcp", refreshed.access_token, "POST", {
          jsonrpc: "2.0",
          id: 21,
          method: "tools/list",
        })
      ).status,
      401,
    );
    expiring.release();
    onScore = undefined;
    await waitRun(expiring.runId, "completed");
  } finally {
    expiring.release();
    onScore = undefined;
  }
  const renewed = await exchange(
    new URLSearchParams({
      client_id: registration.client_id,
      grant_type: "refresh_token",
      refresh_token: refreshed.refresh_token,
      resource: origin + "/mcp",
    }),
  );
  assert.equal(renewed.status, 200, await renewed.clone().text());
  Object.assign(refreshed, await renewed.json());
  const apps = await (await session("/auth/oauth2/get-consents")).json();
  assert.equal(apps.length, 1);
  assert.equal(
    (
      await session(
        "/auth/oauth2/delete-consent",
        "POST",
        { id: apps[0].id },
        otherCookie,
      )
    ).status,
    401,
  );
  const revokedRun = await heldSearch();
  try {
    assert.equal(
      (await session("/auth/oauth2/delete-consent", "POST", { id: apps[0].id }))
        .status,
      200,
    );
    revokedRun.release();
    onScore = undefined;
    await waitRun(revokedRun.runId, "failed");
    const row = await runtime.store.one<{
      result: unknown;
      credential: unknown;
    }>(
      "SELECT result,credential FROM external_runs WHERE id=?",
      revokedRun.runId,
    );
    assert.equal(row?.result, null);
    assert.equal(row?.credential, null);
  } finally {
    revokedRun.release();
    onScore = undefined;
  }
  await assert.rejects(legacyTools(refreshed.access_token));
  assert.equal(
    (
      await request("/mcp", refreshed.access_token, "POST", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await exchange(
        new URLSearchParams({
          client_id: registration.client_id,
          grant_type: "refresh_token",
          refresh_token: refreshed.refresh_token,
          resource: origin + "/mcp",
        }),
      )
    ).status,
    400,
  );
  const reconnect = await fetch(
    base +
      "/api/auth/oauth2/authorize?" +
      new URLSearchParams({
        ...Object.fromEntries(params),
        scope: "documents:read",
      }),
    {
      headers: { Cookie: cookie, Accept: "text/html" },
      redirect: "manual",
    },
  );
  const reconnectURL = new URL(
    reconnect.status === 302
      ? reconnect.headers.get("location")!
      : (await reconnect.json()).url,
    origin,
  );
  const consent = await session("/auth/oauth2/consent", "POST", {
    accept: true,
    oauth_query: reconnectURL.search.slice(1),
  });
  assert.equal(consent.status, 200, await consent.clone().text());
  const reconnectCode = new URL((await consent.json()).url).searchParams.get(
    "code",
  )!;
  const reconnectToken = await exchange(
    new URLSearchParams({
      client_id: registration.client_id,
      grant_type: "authorization_code",
      code: reconnectCode,
      redirect_uri: "http://127.0.0.1:9900/callback",
      code_verifier: verifier,
      resource: origin + "/mcp",
    }),
  );
  assert.equal(reconnectToken.status, 200, await reconnectToken.clone().text());
  const fresh = await reconnectToken.json();
  const connected = await request("/mcp", fresh.access_token, "POST", {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
  });
  assert.equal(connected.status, 200, await connected.clone().text());
  assert.deepEqual(
    (await connected.json()).result.tools.map((tool: any) => tool.name).sort(),
    ["fetch", "list_organizations"],
  );
  assert.deepEqual(
    (await legacyTools(fresh.access_token)).tools
      .map((tool) => tool.name)
      .sort(),
    ["fetch", "list_organizations"],
  );
  await assert.rejects(legacyTools(refreshed.access_token));
  assert.equal(
    (
      await request("/mcp", refreshed.access_token, "POST", {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
      })
    ).status,
    401,
  );
  const authorizeBound = await fetch(
    base +
      "/api/auth/oauth2/authorize?" +
      new URLSearchParams({
        ...Object.fromEntries(params),
        scope: "documents:read",
      }),
    { headers: { Cookie: cookie, Accept: "text/html" }, redirect: "manual" },
  );
  const boundCode = new URL(
    authorizeBound.status === 302
      ? authorizeBound.headers.get("location")!
      : (await authorizeBound.json()).url,
    origin,
  ).searchParams.get("code");
  assert.ok(boundCode);
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  async function proof(url: string, token?: string) {
    return new SignJWT({
      htm: "POST",
      htu: url,
      jti: randomUUID(),
      ...(token ? { ath: await deriveDpopAth(token) } : {}),
    })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
      .setIssuedAt()
      .sign(privateKey);
  }
  const boundResponse = await exchange(
    new URLSearchParams({
      client_id: registration.client_id,
      grant_type: "authorization_code",
      code: boundCode,
      redirect_uri: "http://127.0.0.1:9900/callback",
      code_verifier: verifier,
      resource: origin + "/mcp",
    }),
    await proof(origin + "/api/auth/oauth2/token"),
  );
  assert.equal(boundResponse.status, 200, await boundResponse.clone().text());
  const bound = await boundResponse.json();
  assert.equal(bound.token_type, "DPoP");
  const body = { jsonrpc: "2.0", id: 5, method: "tools/list" };
  const bearerBound = await request("/mcp", bound.access_token, "POST", body);
  assert.equal(bearerBound.status, 401);
  assert.match(bearerBound.headers.get("www-authenticate")!, /^DPoP/);
  const resourceProof = await proof(origin + "/mcp", bound.access_token);
  const proofHeaders = {
    Authorization: `DPoP ${bound.access_token}`,
    DPoP: resourceProof,
  };
  assert.equal(
    (await request("/mcp", bound.access_token, "POST", body, proofHeaders))
      .status,
    200,
  );
  assert.equal(
    (await request("/mcp", bound.access_token, "POST", body, proofHeaders))
      .status,
    401,
  );
  const wrongResource = await request(
    "/api/v1/organizations",
    bound.access_token,
    "GET",
    undefined,
    { Authorization: `DPoP ${bound.access_token}`, DPoP: resourceProof },
  );
  assert.equal(wrongResource.status, 401);
  assert.equal((await session("/auth/sign-out", "POST", {})).status, 200);
  assert.equal(
    (await request("/mcp", fresh.access_token, "POST", body)).status,
    401,
  );
  assert.equal(
    (
      await exchange(
        new URLSearchParams({
          client_id: registration.client_id,
          grant_type: "refresh_token",
          refresh_token: fresh.refresh_token,
          resource: origin + "/mcp",
        }),
      )
    ).status,
    400,
  );
  cookie = await login("api@local.test");
});

test("native key management enforces ownership and read-only permissions", async () => {
  const limited = await runtime.auth.api.createApiKey({
    body: {
      userId,
      name: "Documents",
      expiresIn: 86400,
      permissions: { documents: ["read"] },
    },
  });
  const tools = await request("/mcp", limited.key, "POST", {
    jsonrpc: "2.0",
    id: 10,
    method: "tools/list",
  });
  assert.equal(tools.status, 200, await tools.clone().text());
  const names = (await tools.json()).result.tools.map(
    (tool: { name: string }) => tool.name,
  );
  assert.ok(names.includes("fetch"));
  assert.ok(!names.includes("search"));
  assert.equal(
    (
      await request("/api/v1/search", limited.key, "POST", {
        organizationId: orgId,
        query: "question",
      })
    ).status,
    403,
  );
  for (const action of ["create", "update", "delete"]) {
    assert.equal(
      (
        await session(`/auth/api-key/${action}`, "POST", {
          userId: otherId,
          name: "Bypass",
          keyId: limited.id,
          permissions: { documents: ["write"] },
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (await session("/auth/get-session", "GET", undefined, "")).status,
    200,
  );
  const keyOnly = await fetch(base + "/api/auth/get-session", {
    headers: { "x-api-key": limited.key },
  });
  assert.equal(await keyOnly.json(), null);
  await runtime.auth.api.updateApiKey({
    body: { userId, keyId: limited.id, enabled: false },
  });
  assert.equal(
    (
      await request("/mcp", limited.key, "POST", {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/list",
      })
    ).status,
    401,
  );
});

async function uploadRequest(
  token: string,
  file: Blob,
  filename = "note.txt",
  org = orgId,
  parentId?: string,
) {
  const form = new FormData();
  form.append("file", file, filename);
  return fetch(
    `${base}/api/v1/documents?${new URLSearchParams({ organizationId: org, ...(parentId ? { parentId } : {}) })}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
}

test("REST uploads create owned private documents and enforce write scope and folder membership", async () => {
  await runtime.store.run("DELETE FROM upload_usage");
  const created = await key();
  const result = await uploadRequest(
    created.token,
    new Blob(["# Uploaded\nSource text"], { type: "application/octet-stream" }),
  );
  assert.equal(result.status, 201, await result.clone().text());
  const document = await result.json();
  assert.equal(document.access, "private");
  assert.equal(document.status, "queued");
  assert.equal(document.mime, "text/plain");
  assert.equal(
    (await runtime.store.files.read("document", document.id))?.body.toString(),
    "# Uploaded\nSource text",
  );
  const resource = await runtime.store.one<any>(
    "SELECT * FROM resources WHERE id=?",
    document.id,
  );
  assert.equal(resource.owner_id, userId);
  assert.equal(resource.access, "restricted");
  assert.ok(resource.index_job_id);
  assert.ok(resource.thumbnail_job_id);
  assert.equal(
    (
      await request(
        `/api/v1/documents/${document.id}?organizationId=${orgId}`,
        created.token,
      )
    ).status,
    409,
  );
  const other = await key(otherCookie);
  assert.equal(
    (
      await request(
        `/api/v1/documents/${document.id}?organizationId=${orgId}`,
        other.token,
      )
    ).status,
    404,
  );
  const limited = await runtime.auth.api.createApiKey({
    body: {
      userId,
      name: "Read",
      permissions: { documents: ["read"] },
      expiresIn: 86400,
    },
  });
  assert.equal(
    (await uploadRequest(limited.key, new Blob(["text"]))).status,
    403,
  );
  assert.equal(
    (
      await uploadRequest(
        created.token,
        new Blob(["text"]),
        "note.txt",
        foreignOrgId,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await uploadRequest(
        created.token,
        new Blob(["text"]),
        "note.txt",
        orgId,
        privateId,
      )
    ).status,
    404,
  );
  const folder = randomUUID();
  await runtime.store.run(
    "INSERT INTO resources(id,org_id,owner_id,kind,name,access,created) VALUES(?,?,?,'folder','Shared','organization',?)",
    folder,
    orgId,
    otherId,
    new Date().toISOString(),
  );
  assert.equal(
    (
      await uploadRequest(
        created.token,
        new Blob(["text"]),
        "note.txt",
        orgId,
        folder,
      )
    ).status,
    404,
  );
  await runtime.store.run(
    "INSERT INTO grants(resource_id,user_id,role) VALUES(?,?,'editor')",
    folder,
    userId,
  );
  const inFolder = await uploadRequest(
    created.token,
    new Blob(["text"]),
    "note.txt",
    orgId,
    folder,
  );
  assert.equal(inFolder.status, 201, await inFolder.clone().text());
  const stored = await runtime.store.one<any>(
    "SELECT parent_id,access FROM resources WHERE id=?",
    (await inFolder.json()).id,
  );
  assert.equal(stored.parent_id, folder);
  assert.equal(stored.access, "restricted");
});

test("REST upload rejects multipart abuse and authenticates before buffering", async () => {
  await runtime.store.run("DELETE FROM upload_usage");
  const created = await key();
  assert.equal(
    (await uploadRequest("invalid", new Blob(["text"]))).status,
    401,
  );
  const cookieOnly = await fetch(
    `${base}/api/v1/documents?organizationId=${orgId}`,
    { method: "POST", headers: { Cookie: cookie }, body: new FormData() },
  );
  assert.equal(cookieOnly.status, 401);
  assert.equal((await uploadRequest(created.token, new Blob([]))).status, 201);
  assert.equal(
    (await uploadRequest(created.token, new Blob(["bad"]), "document.pdf"))
      .status,
    201,
  );
  assert.equal(
    (
      await uploadRequest(
        created.token,
        new Blob([Buffer.alloc(31 * 1024 * 1024)]),
        "document.pdf",
      )
    ).status,
    201,
  );
  const oversized = await new Promise<number>((resolve, reject) => {
    const pending = httpRequest(
      `${base}/api/v1/documents?organizationId=${orgId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${created.token}`,
          "Content-Type": "multipart/form-data; boundary=upload",
          "Content-Length": String(uploadLimits.fileBytes + 16 * 1024 + 1),
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode!));
      },
    );
    pending.on("error", reject);
    pending.setTimeout(5000, () =>
      pending.destroy(new Error("Upload timed out")),
    );
    pending.end();
  });
  assert.equal(oversized, 413);
  const form = new FormData();
  form.append("file", new Blob(["one"]), "one.txt");
  form.append("file", new Blob(["two"]), "two.txt");
  const two = await fetch(`${base}/api/v1/documents?organizationId=${orgId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${created.token}` },
    body: form,
  });
  assert.equal(two.status, 400);
  const denied = await uploadRequest(created.token, new Blob(["next"]));
  assert.equal(denied.status, 201, await denied.clone().text());
});

test("MCP uploads expose mutation annotations, preserve read-only grants, and accept larger inline files", async () => {
  await runtime.store.run("DELETE FROM upload_usage");
  const created = await key();
  const listing = await request("/mcp", created.token, "POST", {
    jsonrpc: "2.0",
    id: 90,
    method: "tools/list",
  });
  const tool = (await listing.json()).result.tools.find(
    (value: any) => value.name === "upload_document",
  );
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.idempotentHint, false);
  const response = await request("/mcp", created.token, "POST", {
    jsonrpc: "2.0",
    id: 91,
    method: "tools/call",
    params: {
      name: "upload_document",
      arguments: {
        organizationId: orgId,
        filename: "note.txt",
        contentBase64: "SGVsbG8K",
      },
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const result = (await response.json()).result;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(result.structuredContent.access, "private");
  assert.equal(
    (
      await runtime.store.files.read("document", result.structuredContent.id)
    )?.body.toString(),
    "Hello\n",
  );
  const inline = Buffer.alloc(3 * 1024 * 1024, 65);
  const larger = await request("/mcp", created.token, "POST", {
    jsonrpc: "2.0",
    id: 94,
    method: "tools/call",
    params: {
      name: "upload_document",
      arguments: {
        organizationId: orgId,
        filename: "attachment.bin",
        contentBase64: inline.toString("base64"),
      },
    },
  });
  assert.equal(larger.status, 200, await larger.clone().text());
  const largerResult = (await larger.json()).result;
  assert.equal(largerResult.isError, undefined, JSON.stringify(largerResult));
  assert.deepEqual(
    (
      await runtime.store.files.read(
        "document",
        largerResult.structuredContent.id,
      )
    )?.body,
    inline,
  );
  const bad = await request("/mcp", created.token, "POST", {
    jsonrpc: "2.0",
    id: 92,
    method: "tools/call",
    params: {
      name: "upload_document",
      arguments: {
        organizationId: orgId,
        filename: "note.txt",
        contentBase64: "bad!",
      },
    },
  });
  assert.equal((await bad.json()).result.isError, true);
  const limited = await runtime.auth.api.createApiKey({
    body: {
      userId,
      name: "Read",
      permissions: { documents: ["read"] },
      expiresIn: 86400,
    },
  });
  const readOnly = await request("/mcp", limited.key, "POST", {
    jsonrpc: "2.0",
    id: 93,
    method: "tools/list",
  });
  assert.ok(
    !(await readOnly.json()).result.tools.some(
      (value: any) => value.name === "upload_document",
    ),
  );
});

test("authenticated REST and MCP requests share user limits without consuming shared IP allowance", async (t) => {
  const first = await key();
  const second = await key();
  const other = await key(otherCookie);
  t.mock.property(process, "env", {
    ...process.env,
    API_READ_LIMIT_PER_MINUTE: "2",
    API_WRITE_LIMIT_PER_MINUTE: "2",
    ANONYMOUS_LIMIT_PER_MINUTE: "1",
  });
  const isolated = await createApp({
    directory,
    databaseUrl: database.url,
    origin,
    fetcher,
  });
  const listener = isolated.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const previousBase = base;
  base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal(
      (await request("/api/v1/organizations", "invalid")).status,
      401,
    );
    assert.equal(
      (await request("/api/v1/organizations", "invalid")).status,
      429,
    );
    assert.equal(
      (await request("/api/v1/organizations", first.token)).status,
      200,
    );
    assert.equal(
      (await request("/api/v1/organizations", second.token)).status,
      200,
    );
    assert.equal((await session("/me")).status, 429);
    assert.equal(
      (await request("/api/v1/organizations", other.token)).status,
      200,
    );
    assert.equal(
      (await session("/me", "GET", undefined, otherCookie)).status,
      200,
    );
    const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    assert.equal((await request("/mcp", first.token, "POST", rpc)).status, 200);
    assert.equal(
      (await request("/mcp", second.token, "POST", rpc)).status,
      200,
    );
    const rejected = await request("/mcp", first.token, "POST", rpc);
    assert.equal(rejected.status, 429);
    assert.ok(Number(rejected.headers.get("Retry-After")) > 0);
    assert.equal((await request("/mcp", other.token, "POST", rpc)).status, 200);
  } finally {
    base = previousBase;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await isolated.close();
  }
});

test("API key migration raises the old default and preserves custom limits", async () => {
  const first = await key();
  const second = await key();
  await runtime.store.run(
    'UPDATE apikey SET "rateLimitEnabled"=true,"rateLimitTimeWindow"=60000,"rateLimitMax"=180 WHERE id=?',
    first.key.id,
  );
  await runtime.store.run(
    'UPDATE apikey SET "rateLimitEnabled"=true,"rateLimitTimeWindow"=60000,"rateLimitMax"=42 WHERE id=?',
    second.key.id,
  );
  await runtime.store.db.query(
    readFileSync(
      new URL(
        "../server/migrations/020-unrestricted-api-key-limits.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const allowance = async (id: string) =>
    (await runtime.store.one<{ rateLimitMax: number }>(
      'SELECT "rateLimitMax" FROM apikey WHERE id=?',
      id,
    ))!.rateLimitMax;
  assert.equal(await allowance(first.key.id), 100000);
  assert.equal(await allowance(second.key.id), 42);
});

test("search admission isolates users and prevents rotating credentials from resetting a user's allowance", async (t) => {
  const { createExternalAccess } = await import("../server/external-access");
  const { createUploads } = await import("../server/uploads");
  t.mock.property(process, "env", {
    ...process.env,
    SEARCH_USER_LIMIT_PER_MINUTE: "2",
    SEARCH_CREDENTIAL_LIMIT_PER_MINUTE: "2",
    SEARCH_ORGANIZATION_LIMIT_PER_MINUTE: "4",
  });
  const access = createExternalAccess(
    runtime.store,
    runtime.auth,
    runtime.providers,
    origin,
    async () => {
      throw new Error("Token validation is not used for admission");
    },
    true,
    createUploads(runtime.store),
  );
  const principal = { userId, credentialId: "first", scopes: ["search:read"] };
  await access.limitSearch(principal, orgId);
  await access.limitSearch({ ...principal, credentialId: "second" }, orgId);
  await assert.rejects(
    access.limitSearch({ ...principal, credentialId: "third" }, secondOrgId),
    /Search limit/,
  );
  await access.limitSearch({ ...principal, userId: otherId }, orgId);
  await access.limitSearch(
    { ...principal, userId: otherId, credentialId: "fourth" },
    orgId,
  );
  await access.limitSearch(
    { ...principal, userId: "another", credentialId: "fifth" },
    orgId,
  );
});

test("default upload admission isolates users and ignores prior shared counters", async (t) => {
  const { createUploads } = await import("../server/uploads");
  await runtime.store.run("DELETE FROM upload_usage");
  const clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const bucket = Math.floor(clock / 60000);
  const uploads = createUploads(runtime.store);
  const a = { userId, orgId, role: "member", token: "first" };
  const b = { ...a, userId: otherId, token: "second" };
  try {
    await runtime.store.run(
      "INSERT INTO upload_usage(subject,bucket,period,attempts,expires_at) VALUES('deployment',?,60000,10000000,?)",
      bucket,
      new Date(clock + 60000).toISOString(),
    );
    await Promise.all(
      [a, b].flatMap((actor) =>
        Array.from({ length: 240 }, () => uploads.admit(actor)),
      ),
    );
    const usage = await runtime.store.one<{ attempts: number }>(
      "SELECT attempts FROM upload_usage WHERE subject='deployment' AND bucket=? AND period=60000",
      bucket,
    );
    assert.equal(usage?.attempts, 10000000);
    await runtime.store.run(
      "UPDATE upload_usage SET attempts=? WHERE subject=? AND bucket=? AND period=60000",
      uploadLimits.attemptsPerMinute.user,
      `user:${userId}`,
      bucket,
    );
    await assert.rejects(uploads.admit(a), /Upload rate limit/);
    await uploads.admit(b);
  } finally {
    await runtime.store.run("DELETE FROM upload_usage");
  }
});

test("upload quotas persist across runtime replacement and credentials, and reject storage and queue overflow atomically", async (t) => {
  const { createUploads } = await import("../server/uploads");
  const { uploadAdmissionLimits } = await import("../server/upload-limits");
  const { HttpError } = await import("../server/db");
  await runtime.store.run("DELETE FROM upload_usage");
  const a = { userId, orgId, role: "member", token: "first" };
  const defaults = uploadAdmissionLimits();
  const limits = {
    ...defaults,
    attemptsPerMinute: { ...defaults.attemptsPerMinute, user: 5 },
    pending: { ...defaults.pending, user: 10 },
    storedBytes: { ...defaults.storedBytes, user: 512 * 1024 * 1024 },
    dailyBytes: { ...defaults.dailyBytes, user: 1024 },
  };
  const clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  for (let i = 0; i < 5; i++)
    await createUploads(runtime.store, { limits }).admit({
      ...a,
      token: String(i),
    });
  await assert.rejects(
    createUploads(runtime.store, { limits }).admit({
      ...a,
      orgId: secondOrgId,
      token: "different",
    }),
    (error: unknown) => error instanceof HttpError && error.status === 429,
  );
  const unlimitedAttempts = createUploads(runtime.store, {
    rateLimits: false,
    limits,
  });
  await unlimitedAttempts.admit(a);
  assert.equal(
    (await runtime.store.one<{ attempts: number }>(
      "SELECT attempts FROM upload_usage WHERE subject=? AND bucket=? AND period=60000",
      `user:${userId}`,
      Math.floor(clock / 60_000),
    ))!.attempts,
    5,
  );
  await runtime.store.run("DELETE FROM upload_usage");
  const usage = createUploads(runtime.store, { limits });
  const original = await runtime.store.one<{ size: number }>(
    "SELECT size FROM resources WHERE id=?",
    ownId,
  );
  await runtime.store.run(
    "UPDATE resources SET size=? WHERE id=?",
    limits.storedBytes.user,
    ownId,
  );
  try {
    await assert.rejects(
      usage.save(a, "note.txt", Buffer.from("text"), null, async () => a),
      /storage quota/,
    );
  } finally {
    await runtime.store.run(
      "UPDATE resources SET size=? WHERE id=?",
      original!.size,
      ownId,
    );
  }
  const bucket = Math.floor(clock / 86_400_000);
  await runtime.store.run(
    "INSERT INTO upload_usage(subject,bucket,period,bytes,expires_at) VALUES(?,?,86400000,?,?)",
    `user:${userId}`,
    bucket,
    limits.dailyBytes.user,
    new Date(clock + 86_400_000).toISOString(),
  );
  await assert.rejects(
    usage.save(a, "note.txt", Buffer.from("text"), null, async () => a),
    /Daily upload byte quota/,
  );
  await runtime.store.run("DELETE FROM upload_usage");
  const queued = Array.from({ length: 10 }, () => randomUUID());
  try {
    for (const id of queued)
      await runtime.store.run(
        "INSERT INTO resources(id,org_id,owner_id,kind,name,status,created) VALUES(?,?,?,'document','Pending','queued',?)",
        id,
        orgId,
        userId,
        new Date().toISOString(),
      );
    await assert.rejects(usage.admit(a), /processing queue is full/);
    await assert.rejects(
      unlimitedAttempts.admit(a),
      /processing queue is full/,
    );
  } finally {
    for (const id of queued)
      await runtime.store.run("DELETE FROM resources WHERE id=?", id);
  }
});

test("upload revocation and storage failure roll back document, bytes, and queued work", async () => {
  const { createUploads } = await import("../server/uploads");
  await runtime.store.run("DELETE FROM upload_usage");
  const a = { userId, orgId, role: "member", token: "test" };
  const uploads = createUploads(runtime.store);
  const before = await runtime.store.one<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM resources",
  );
  const jobsBefore = await runtime.store.one<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "${runtime.store.jobs.schema}".job`,
  );
  await assert.rejects(
    uploads.save(a, "note.txt", Buffer.from("text"), null, async () => {
      throw new Error("Revoked");
    }),
    /Revoked/,
  );
  const write = runtime.store.files.write;
  let checks = 0;
  await assert.rejects(
    uploads.save(a, "note.txt", Buffer.from("text"), null, async () => {
      if (++checks > 1) throw new Error("Revoked while storing");
      return a;
    }),
    /Revoked while storing/,
  );
  runtime.store.files.write = async () => {
    throw new Error("Storage unavailable");
  };
  try {
    await assert.rejects(
      uploads.save(a, "note.txt", Buffer.from("text"), null, async () => a),
      /Storage unavailable/,
    );
  } finally {
    runtime.store.files.write = write;
  }
  assert.equal(
    (
      await runtime.store.one<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM resources",
      )
    )?.count,
    before?.count,
  );
  assert.equal(
    (
      await runtime.store.one<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "${runtime.store.jobs.schema}".job`,
      )
    )?.count,
    jobsBefore?.count,
  );
  assert.equal(
    (
      await runtime.store.one<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM upload_usage",
      )
    )?.count,
    "0",
  );
});
