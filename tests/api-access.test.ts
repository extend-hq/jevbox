import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth-passwords";
import { buildIndex } from "../server/indexing";
import { testDatabase } from "./database";
import { choiceResponse } from "./model-tools";

const origin = "http://localhost:4310";
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
  if (body.questions.usefulness) {
    await onScore?.();
    return Response.json({
      answers: { usefulness: { type: "score", score: 3 } },
    });
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
) {
  return fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
}
async function key(auth = cookie) {
  const response = await session(
    "/api-keys",
    "POST",
    { name: "Integration", expiresInDays: 30 },
    auth,
  );
  assert.equal(response.status, 201, await response.clone().text());
  return response.json() as Promise<{ key: { id: string }; token: string }>;
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
  directory = mkdtempSync(join(tmpdir(), "jevbox-api-"));
  runtime = await createApp({
    directory,
    databaseUrl: database.url,
    origin,
    rateLimits: false,
    fetcher,
  });
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
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
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
    "SELECT token_hash FROM api_keys WHERE id=?",
    created.key.id,
  );
  assert.notEqual(stored!.token_hash, created.token);
  const list = await session("/api-keys");
  const body = await list.text();
  assert.ok(body.includes(created.key.id));
  assert.ok(!body.includes(created.token));
  assert.ok(!body.includes("token_hash"));
  assert.ok(
    !(
      await (await session("/api-keys", "GET", undefined, otherCookie)).text()
    ).includes(created.key.id),
  );
  assert.equal(
    (
      await session(
        `/api-keys/${created.key.id}`,
        "DELETE",
        undefined,
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
    "UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=?",
    created.key.id,
  );
  assert.equal(
    (await request("/api/v1/organizations", created.token)).status,
    401,
  );
  assert.equal(
    (
      await session("/api-keys", "POST", {
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
      await session(`/api-keys/${created.key.id}`, "DELETE");
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
test("MCP works through the official client with full read and search access", async () => {
  const created = await key();
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${created.token}` } },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "fetch",
      "list_organizations",
      "search",
    ]);
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
    await session(`/api-keys/${created.key.id}`, "DELETE");
    await assert.rejects(client.listTools());
  } finally {
    await client.close();
  }
});
test("OAuth discovery, registration, PKCE, consent, audience validation, refresh, and disconnect", async () => {
  const metadataResponse = await fetch(
    base + "/.well-known/oauth-authorization-server/api/auth",
  );
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.issuer, origin + "/api/auth");
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
      application_type: "native",
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
  assert.equal(loginURL.pathname, "/oauth/sign-in");
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
  const preview = await session("/oauth/consent-request", "POST", {
    oauthQuery: consentURL.search.slice(1),
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const tampered = new URLSearchParams(consentURL.search);
  tampered.set("scope", "documents:write");
  assert.notEqual(
    (
      await session("/oauth/consent-request", "POST", {
        oauthQuery: tampered.toString(),
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
  async function exchange(body: URLSearchParams) {
    return fetch(base + "/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
  assert.ok(tokens.refresh_token);
  const rpc = await request("/mcp", tokens.access_token, "POST", {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  assert.equal(rpc.status, 200, await rpc.clone().text());
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
  const apps = await (await session("/connected-apps")).json();
  assert.equal(apps.length, 1);
  assert.equal(
    (
      await session(
        `/connected-apps/${apps[0].id}`,
        "DELETE",
        undefined,
        otherCookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (await session(`/connected-apps/${apps[0].id}`, "DELETE")).status,
    200,
  );
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
});
