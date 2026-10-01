import { runJobs, waitForJobs } from "./jobs";
import { authMailbox } from "./auth-mailbox";
import {
  createAuthorization,
  type Relationship,
} from "../server/authorization";
import { HttpError, createStore, resourceAccess } from "../server/db";
import { testDatabase } from "./database";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { isPublicAddress, validateProviderURL } from "../server/ai";
import { buildIndex } from "../server/indexing";
import { createProviders } from "../server/providers";
import { randomUUID } from "node:crypto";
import {
  searchToolResponse,
  toolSources,
  choiceResponse,
  questionFromRequest,
  textResponse,
} from "./model-tools";
let base: string;
let runtime: Awaited<ReturnType<typeof createApp>>;
let server: ReturnType<Awaited<ReturnType<typeof createApp>>["app"]["listen"]>;
let directory: string;
let database: Awaited<ReturnType<typeof testDatabase>>;
const origin = "http://localhost:4310";
const mailbox = authMailbox(origin);
const outbound: {
  url: string;
  body: any;
}[] = [];
let revokeDuringAnswer: (() => Promise<unknown>) | undefined;
let scoreContext: ((body: any) => Promise<Response>) | undefined;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  outbound.push({ url, body });
  if (url.endsWith("/files/upload")) return Response.json({ id: "file_test" });
  if (url.endsWith("/parse_runs")) return Response.json({ id: "pr_test" });
  if (url.includes("/parse_runs/"))
    return Response.json({
      status: "PROCESSED",
      output: {
        chunks: [
          {
            content: "# Parsed content\n\nVerified parse output.",
            metadata: { pageRange: { start: 1, end: 1 } },
            blocks: [
              { id: "b1", type: "text", content: "Verified parse output." },
            ],
          },
        ],
      },
    });
  if (url.includes("typesafe")) {
    if (body.questions.usefulness)
      return scoreContext
        ? scoreContext(body)
        : Response.json({
            answers: { usefulness: { type: "score", score: 3 } },
          });
    return choiceResponse(body);
  }
  if (url.includes("openai")) {
    const toolResponse = searchToolResponse(body);
    if (toolResponse) return toolResponse;
    await revokeDuringAnswer?.();
    return textResponse(
      body,
      /^(hello|hi)[!. ]*$/i.test(questionFromRequest(body))
        ? "Hello! How can I help?"
        : toolSources(body).length
          ? "The launch code is ORCHID-739 [1]."
          : "No relevant sources were returned for this question.",
    );
  }
  throw new Error("Unexpected provider endpoint");
};
async function req(path: string, cookie = "", method = "GET", body?: unknown) {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      "X-Jevbox-Request": "1",
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  const data = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : await res.text();
  return {
    status: res.status,
    data,
    cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function resourceRelationships(version: string, resourceId: string) {
  const response = await fetch(
    new URL("/v1/relationships/read", process.env.SPICEDB_HTTP_URL),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SPICEDB_PRESHARED_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        consistency: { fullyConsistent: true },
        relationshipFilter: {
          resourceType: "jevbox/resource",
          optionalResourceId: `${version}/${resourceId}`,
        },
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  assert.equal(response.status, 200);
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line);
      assert.equal(entry.error, undefined);
      assert.ok(entry.result?.relationship);
      return entry.result.relationship as Relationship;
    });
}
async function signup(email: string, invite?: string) {
  const response = await req("/auth/sign-up/email", "", "POST", {
    name: email.split("@")[0],
    email,
    password: "a-secure-password-123!",
    organization: "Workspace",
    ...(invite ? { invite } : {}),
  });
  assert.equal(response.status, 200);
  return mailbox.signIn(base, email, "a-secure-password-123!", invite);
}
async function upload(
  cookie: string,
  text: string,
  parentId?: string,
  filename = "notes.md",
) {
  const form = new FormData();
  form.append("file", new Blob([text]), filename);
  if (parentId) form.append("parentId", parentId);
  const result = await req("/documents", cookie, "POST", form);
  assert.equal(result.status, 201);
  await runJobs(runtime);
  return result.data.id as string;
}
let owner: string,
  member: string,
  outsider: string,
  memberId: string,
  orgId: string,
  doc: string,
  folder: string;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), "jevbox-tests-"));
  database = await testDatabase();
  runtime = await createApp({
    workers: ["auth-email", "chat-answer"],
    databaseUrl: database.url,
    directory,
    origin,
    fetcher: fakeFetch,
    rateLimits: false,
    sendAuthEmail: mailbox.sendAuthEmail,
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  owner = await signup("owner@local.test");
  outsider = await signup("outside@local.test");
  const invitation = await req("/invitations", owner, "POST", {
    email: "member@local.test",
  });
  member = await signup(
    "member@local.test",
    new URL(invitation.data.url).searchParams.get("invite")!,
  );
  const me = (await req("/me", member)).data;
  memberId = me.user.id;
  orgId = me.organization.id;
  assert.equal(
    (
      await req("/settings", owner, "PUT", {
        jevKey: "test-key",
        chatProviders: [],
      })
    ).status,
    200,
  );
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.cleanup(runtime.store);
  rmSync(directory, { recursive: true, force: true });
});
test("authentication, CSRF and cookie flags", async () => {
  assert.equal((await req("/resources")).status, 401);
  const rejected = await fetch(base + "/api/folders", {
    method: "POST",
    headers: {
      Cookie: owner,
      "Content-Type": "application/json",
      Origin: "https://outside.test",
    },
    body: JSON.stringify({ name: "Rejected" }),
  });
  assert.equal(rejected.status, 403);
  const login = await fetch(base + "/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Jevbox-Request": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "owner@local.test",
      password: "a-secure-password-123!",
    }),
  });
  const cookie = login.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});
test("restricted documents are absent from listings, content, indexes, and search", async () => {
  doc = await upload(
    owner,
    "# Launch\n\nThe launch code is ORCHID-739.\n\n## Links\n[Guide](https://example.org/guide)",
  );
  assert.equal((await req("/resources", member)).data.length, 0);
  for (const path of [
    `/resources/${doc}`,
    `/documents/${doc}/content`,
    `/resources/${doc}/access`,
  ])
    assert.equal((await req(path, member)).status, 404);
  const result = await req("/search", member, "POST", { query: "ORCHID" });
  assert.equal(result.data.results.length, 0);
  assert.equal(JSON.stringify(result).includes("ORCHID-739"), false);
});
test("owners can share only with current organization members", async () => {
  const outsideId = (await req("/me", outsider)).data.user.id;
  assert.equal(
    (
      await req(`/resources/${doc}/access`, owner, "PUT", {
        access: "restricted",
        grants: [{ userId: outsideId, role: "viewer" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await req(`/resources/${doc}/access`, owner, "PUT", {
        access: "restricted",
        grants: [{ userId: memberId, role: "viewer" }],
      })
    ).status,
    200,
  );
  assert.equal((await req(`/resources/${doc}`, member)).status, 200);
  assert.equal((await req(`/resources/${doc}`, outsider)).status, 404);
});
test("viewers cannot mutate, share, retry or delete", async () => {
  for (const [path, method, body] of [
    [`/resources/${doc}`, "DELETE", null],
    [`/resources/${doc}/access`, "PUT", { access: "organization", grants: [] }],
    [`/documents/${doc}/retry`, "POST", null],
    [`/resources/${doc}`, "PATCH", { name: "Changed" }],
  ] as const)
    assert.equal((await req(path, member, method, body)).status, 404);
});
test("category restrictions are an upper bound even for explicit child grants", async () => {
  folder = (
    await req("/folders", owner, "POST", { name: "Restricted category" })
  ).data.id;
  const child = await upload(
    owner,
    "# Private category\n\nHidden content.",
    folder,
  );
  await req(`/resources/${child}/access`, owner, "PUT", {
    access: "organization",
    grants: [{ userId: memberId, role: "editor" }],
  });
  assert.equal((await req(`/resources/${child}`, member)).status, 404);
  await req(`/resources/${folder}/access`, owner, "PUT", {
    access: "restricted",
    grants: [{ userId: memberId, role: "viewer" }],
  });
  assert.equal((await req(`/resources/${child}`, member)).status, 200);
  await req(`/resources/${folder}/access`, owner, "PUT", {
    access: "restricted",
    grants: [],
  });
  assert.equal((await req(`/resources/${child}`, member)).status, 404);
});
test("organization sharing stays isolated across organizations", async () => {
  await req(`/resources/${doc}/access`, owner, "PUT", {
    access: "organization",
    grants: [],
  });
  assert.equal((await req(`/resources/${doc}`, member)).status, 200);
  assert.equal((await req("/resources", outsider)).data.length, 0);
  assert.equal((await req(`/documents/${doc}/content`, outsider)).status, 404);
});
test("settings are admin-only, encrypted, and never return credentials", async () => {
  assert.equal((await req("/settings", member)).status, 403);
  assert.equal(
    (
      await req("/settings/providers/anthropic", member, "PATCH", {
        enabled: false,
      })
    ).status,
    403,
  );
  const saved = await req("/settings", owner, "PUT", {
    extendKey: "extend-secret",
    jevKey: "jev-secret",
    provider: "openai",
    model: "gpt-4.1-mini",
    providerKey: "openai-secret",
  });
  assert.equal(saved.status, 200);
  const read = await req("/settings", owner);
  assert.equal(JSON.stringify(read).includes("openai-secret"), false);
  assert.equal(JSON.stringify(read).includes("extend-secret"), false);
  const raw = (await runtime.store.one<{
    settings: string;
  }>("SELECT settings FROM orgs WHERE id=?", orgId))!.settings;
  assert.equal(raw.includes("secret"), false);
  assert.equal(
    JSON.parse(runtime.store.decrypt(raw)).extendKey,
    "extend-secret",
  );
});
test("search and outbound routing exclude unauthorized source material", async () => {
  await upload(
    owner,
    "# Classified\n\nNEVER-SEND-194 belongs only to the owner.",
    undefined,
    "secret.md",
  );
  outbound.length = 0;
  const result = await req("/search", member, "POST", { query: "launch code" });
  assert.equal(result.status, 200);
  assert.ok(result.data.results.some((r: any) => r.documentId === doc));
  assert.equal(JSON.stringify(outbound).includes("NEVER-SEND-194"), false);
  assert.equal(JSON.stringify(outbound).includes("Classified"), false);
});
test("the model can reply without searching the document library", async () => {
  const chat = (await req("/chats", owner, "POST")).data.id;
  outbound.length = 0;
  const response = await req(`/chats/${chat}/messages`, owner, "POST", {
    content: "Hello",
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.messages[1].content, "Hello! How can I help?");
  assert.deepEqual(response.data.messages[1].sources, []);
  assert.deepEqual(response.data.messages[1].trace, []);
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].url, "https://api.openai.com/v1/responses");
  assert.equal(outbound[0].body.store, false);
  assert.ok(
    outbound[0].body.tools.some(
      (tool: any) => tool.name === "search_documents",
    ),
  );
});
let chatId: string;
test("chat is owner-scoped and uses permission-filtered source excerpts", async () => {
  chatId = (await req("/chats", member, "POST")).data.id;
  outbound.length = 0;
  const answer = await req(`/chats/${chatId}/messages`, member, "POST", {
    content: "What is the launch code?",
  });
  assert.equal(answer.status, 200, JSON.stringify(answer.data));
  assert.match(answer.data.messages[1].content, /ORCHID-739/);
  assert.equal((await req(`/chats/${chatId}`, owner)).status, 404);
  assert.equal(
    (
      await req(`/chats/${chatId}/messages`, outsider, "POST", {
        content: "Show the history",
      })
    ).status,
    404,
  );
  assert.equal(JSON.stringify(outbound).includes("NEVER-SEND-194"), false);
});
test("revoking a source hides chat history and prevents reuse as prompt context", async () => {
  await req(`/resources/${doc}/access`, owner, "PUT", {
    access: "restricted",
    grants: [],
  });
  const history = await req(`/chats/${chatId}`, member);
  assert.equal(history.data.blocked, true);
  assert.deepEqual(history.data.messages, []);
  assert.equal(JSON.stringify(history.data).includes("ORCHID"), false);
  for (const path of [
    `/chats/${chatId}/outline`,
    `/chats/${chatId}/history?start=0&end=100`,
  ]) {
    const hidden = await req(path, member);
    assert.equal(hidden.data.blocked, true);
    assert.equal(hidden.data.messageCount, 0);
    assert.equal(JSON.stringify(hidden.data).includes("ORCHID"), false);
  }
  outbound.length = 0;
  assert.equal(
    (
      await req(`/chats/${chatId}/messages`, member, "POST", {
        content: "Repeat the code",
      })
    ).status,
    403,
  );
  assert.equal(outbound.length, 0);
  const list = await req("/chats", member);
  assert.equal(list.data[0].title, "Sources no longer available");
});
test("revocation during generation prevents persistence and response disclosure", async () => {
  await req(`/resources/${doc}/access`, owner, "PUT", {
    access: "organization",
    grants: [],
  });
  const c = (await req("/chats", member, "POST")).data.id;
  revokeDuringAnswer = async () =>
    await runtime.store.run(
      "UPDATE resources SET access='restricted' WHERE id=?",
      doc,
    );
  const answer = await req(`/chats/${c}/messages`, member, "POST", {
    content: "launch code",
  });
  revokeDuringAnswer = undefined;
  assert.equal(answer.status, 403);
  assert.equal(JSON.stringify(answer).includes("ORCHID"), false);
  assert.equal((await req(`/chats/${c}`, member)).data.messages.length, 0);
});
test("asynchronous Extend parsing produces a navigable index", async () => {
  const pdf = await upload(owner, "%PDF-1.4\n", undefined, "document.pdf");
  const resource = await req(`/resources/${pdf}`, owner);
  assert.equal(resource.data.status, "ready");
  assert.equal(resource.data.parsed.source, "extend");
  assert.equal(resource.data.parsed.nodes[0].blocks[0].type, "text");
  assert.ok(outbound.some((r) => r.url.endsWith("/files/upload")));
  assert.equal(
    outbound.findLast((r) => r.url.endsWith("/parse_runs"))?.body.config
      .advancedOptions.alwaysConvertToPdf,
    false,
  );
});
test("unsafe provider endpoints and ambient file credentials are rejected", async () => {
  for (const url of [
    "http://localhost:8080",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://10.0.0.1",
  ])
    assert.throws(() => validateProviderURL(url));
  assert.equal(isPublicAddress("192.168.1.1"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(
    (
      await req("/settings", owner, "PUT", {
        provider: "vertex",
        model: "model",
        providerConfig: { googleAuthOptions: { keyFilename: "/etc/passwd" } },
      })
    ).status,
    400,
  );
});
test("invitations are single-use, email-bound, and never allow role escalation", async () => {
  const invitation = (
    await req("/invitations", owner, "POST", { email: "new@local.test" })
  ).data;
  const token = new URL(invitation.url).searchParams.get("invite")!;
  assert.equal(
    (
      await req("/auth/organization/accept-invitation", outsider, "POST", {
        invitationId: token,
      })
    ).status,
    403,
  );
  const joined = await signup("new@local.test", token);
  assert.equal((await req("/me", joined)).data.role, "member");
  assert.equal(
    (
      await req("/auth/organization/accept-invitation", joined, "POST", {
        invitationId: token,
      })
    ).status,
    400,
  );
});
test("membership removal invalidates sessions and grants immediately", async () => {
  await req("/members/" + memberId, owner, "DELETE");
  assert.equal((await req("/me", member)).status, 401);
  assert.equal((await req("/resources", member)).status, 401);
  assert.equal(
    (await runtime.store.all("SELECT * FROM grants WHERE user_id=?", memberId))
      .length,
    0,
  );
});
test("heading hierarchy and link provenance survive indexing", () => {
  const parsed = buildIndex(
    [
      {
        content:
          "# Overview\nIntro\n## Detail\n[Reference](https://example.org)\n### Deeper\nMore text",
        metadata: { pageRange: { start: 3, end: 4 } },
      },
    ],
    "text",
  );
  assert.equal(parsed.nodes[0].children[0].children[0].title, "Deeper");
  assert.equal(parsed.nodes[0].children[0].links[0].url, "https://example.org");
  assert.equal(parsed.nodes[0].page, 3);
  assert.equal(parsed.nodes[0].endPage, 4);
});
test("additional formats index as text or remain safely stored", async () => {
  const code = await upload(
    owner,
    "export const enabled = true;",
    undefined,
    "settings.ts",
  );
  assert.equal((await req(`/resources/${code}`, owner)).data.status, "ready");
  const unknown = await upload(
    owner,
    "binary-data",
    undefined,
    "attachment.bin",
  );
  const stored = await req(`/resources/${unknown}`, owner);
  assert.equal(stored.data.status, "stored");
  assert.equal(stored.data.parsed, null);
  const response = await fetch(base + `/api/documents/${unknown}/content`, {
    headers: { Cookie: owner },
  });
  assert.match(response.headers.get("content-disposition")!, /^attachment/);
  const html = await upload(
    owner,
    "<script>alert(1)</script>",
    undefined,
    "page.html",
  );
  const htmlResponse = await fetch(base + `/api/documents/${html}/content`, {
    headers: { Cookie: owner },
  });
  assert.match(htmlResponse.headers.get("content-security-policy")!, /sandbox/);
  assert.match(htmlResponse.headers.get("content-disposition")!, /^attachment/);
});
test("provider credentials are isolated across adapter switches", async () => {
  await req("/settings", owner, "PUT", {
    provider: "anthropic",
    model: "model",
    providerKey: "second-secret",
  });
  const me = await req("/me", owner);
  assert.equal(me.data.chatEnabled, true);
  await req("/settings", owner, "PUT", { provider: "google", model: "model" });
  const switched = (await req("/me", owner)).data;
  assert.equal(switched.chatEnabled, true);
  assert.equal(
    switched.chatModels.some(
      (m: { provider: string }) => m.provider === "google",
    ),
    false,
  );
  assert.equal(
    switched.chatModels.some(
      (m: { provider: string }) => m.provider === "anthropic",
    ),
    true,
  );
  assert.equal(
    (
      await req("/settings/providers/anthropic", outsider, "PATCH", {
        enabled: false,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req("/settings/providers/anthropic", owner, "PATCH", {
        enabled: false,
      })
    ).status,
    200,
  );
  const disabled = (await req("/me", owner)).data;
  assert.equal(
    disabled.chatModels.some(
      (m: { provider: string }) => m.provider === "anthropic",
    ),
    false,
  );
  assert.equal(
    disabled.chatModels.some(
      (m: { provider: string }) => m.provider === "openai",
    ),
    true,
  );
  assert.equal(disabled.defaultChatModel.provider, "openai");
  assert.equal(
    (
      await req("/settings/providers/anthropic", owner, "PATCH", {
        enabled: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await req("/me", owner)).data.chatModels.some(
      (m: { provider: string }) => m.provider === "anthropic",
    ),
    true,
  );
  await req("/settings", owner, "PUT", {
    provider: "openai",
    model: "gpt-4.1-mini",
  });
  assert.equal((await req("/me", owner)).data.chatEnabled, true);
  assert.equal(
    JSON.stringify((await req("/settings", owner)).data).includes(
      "second-secret",
    ),
    false,
  );
});
test("provider setup sections save atomically and preserve omitted credentials", async () => {
  assert.equal(
    (
      await req("/settings", owner, "PUT", {
        chatProviders: [
          {
            provider: "openai",
            model: "gpt-4.1-mini",
            models: ["gpt-4.1"],
            providerEnabled: true,
          },
          { provider: "anthropic", model: "model", providerEnabled: true },
        ],
      })
    ).status,
    200,
  );
  const before = (await req("/settings", owner)).data;
  assert.equal(before.providers.openai.configured, true);
  assert.equal(before.providers.anthropic.configured, true);
  const invalid = await req("/settings", owner, "PUT", {
    chatProviders: [
      { provider: "openai", model: "changed", providerKey: "replacement" },
      {
        provider: "anthropic",
        model: "model",
        providerConfig: { baseURL: "http://localhost:8080" },
      },
    ],
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await req("/settings", owner)).data, before);
  assert.equal(
    (
      await req("/settings", owner, "PUT", {
        chatProviders: [
          { provider: "openai", model: "one" },
          { provider: "openai", model: "two" },
        ],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await req("/settings", owner, "PUT", {
        chatProviders: [{ provider: "openai", model: "gpt-4.1-mini" }],
        removedProviders: ["anthropic"],
      })
    ).status,
    200,
  );
  const afterRemoval = (await req("/settings", owner)).data;
  assert.equal(afterRemoval.providers.anthropic, undefined);
  assert.equal(afterRemoval.providers.openai.configured, true);
});
test("production bootstrap requires a token and closes after the first account", async () => {
  const oldEnv = process.env.NODE_ENV,
    oldSignup = process.env.ALLOW_SIGNUP,
    oldToken = process.env.BOOTSTRAP_TOKEN;
  const isolatedDir = mkdtempSync(join(tmpdir(), "jevbox-bootstrap-"));
  const isolatedDatabase = await testDatabase();
  const isolated = await createApp({
    workers: ["auth-email", "chat-answer"],
    databaseUrl: isolatedDatabase.url,
    directory: isolatedDir,
    origin,
    rateLimits: false,
    sendAuthEmail: mailbox.sendAuthEmail,
  });
  const local = isolated.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => local.once("listening", resolve));
  const address = local.address();
  assert.ok(address && typeof address !== "string");
  const register = (bootstrapToken?: string) =>
    fetch(`http://127.0.0.1:${address.port}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        Origin: origin,
        "X-Jevbox-Request": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "bootstrap@local.test",
        password: "secure-password-123",
        name: "Owner",
        organization: "Workspace",
        bootstrapToken,
      }),
    });
  try {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_SIGNUP = "false";
    process.env.BOOTSTRAP_TOKEN = "bootstrap-test-token";
    assert.equal((await register()).status, 403);
    assert.equal((await register("wrong")).status, 403);
    assert.equal((await register("bootstrap-test-token")).status, 200);
    assert.equal((await register("bootstrap-test-token")).status, 403);
  } finally {
    for (const [key, value] of Object.entries({
      NODE_ENV: oldEnv,
      ALLOW_SIGNUP: oldSignup,
      BOOTSTRAP_TOKEN: oldToken,
    }))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await new Promise<void>((resolve) => local.close(() => resolve()));
    await isolatedDatabase.cleanup(isolated.store);
    rmSync(isolatedDir, { recursive: true, force: true });
  }
});
test("tree search finds deeply nested content beyond summary and excerpt limits", async () => {
  const cookie = await signup("long-content@local.test");
  assert.equal(
    (
      await req("/settings", cookie, "PUT", {
        jevKey: "test-key",
        chatProviders: [],
      })
    ).status,
    200,
  );
  const id = await upload(
    cookie,
    "# Overview\nGeneral information.\n## Details\n" +
      "Ordinary content. ".repeat(1000) +
      "\nUNIQUEDEEPTERM",
  );
  scoreContext = async (body) =>
    Response.json({
      answers: {
        usefulness: {
          type: "score",
          score: body.state.includes("UNIQUEDEEPTERM") ? 3 : 0,
        },
      },
    });
  try {
    const result = await req("/search", cookie, "POST", {
      query: "UNIQUEDEEPTERM",
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.results[0].documentId, id);
    assert.match(result.data.results[0].content, /UNIQUEDEEPTERM/);
  } finally {
    scoreContext = undefined;
  }
});
test("JEV rechecks membership before every outbound batch", async () => {
  const cookie = await signup("batch-access@local.test");
  const me = (await req("/me", cookie)).data;
  const actor = {
    userId: me.user.id,
    orgId: me.organization.id,
    role: "owner" as const,
    token: "test-only",
  };
  assert.equal(
    (
      await req("/settings", cookie, "PUT", {
        jevKey: "batch-secret",
        provider: "openai",
        model: "gpt-4.1-mini",
      })
    ).status,
    200,
  );
  const parsed = JSON.stringify(
    buildIndex([{ content: "# Source\nProtected content" }], "text"),
  );
  for (let i = 0; i < 255; i++)
    await runtime.store.run(
      "INSERT INTO resources(id,org_id,owner_id,kind,name,status,parsed,created) VALUES(?,?,?,'document',?,'ready',?,?)",
      randomUUID(),
      actor.orgId,
      actor.userId,
      `Document ${i}`,
      parsed,
      new Date().toISOString(),
    );
  let calls = 0;
  const provider = createProviders(runtime.store, async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    if (calls === 2)
      await runtime.store.run(
        "DELETE FROM members WHERE org_id=? AND user_id=?",
        actor.orgId,
        actor.userId,
      );
    return choiceResponse(body);
  });
  const result = await provider.retrieve(actor, "protected");
  assert.equal(calls, 2);
  assert.deepEqual(result.results, []);
});
test("only admins manage organization roles, and the last admin is preserved", async () => {
  const adminCookie = await signup("roles-admin@local.test");
  const self = (await req("/me", adminCookie)).data;
  assert.equal(self.role, "admin");
  const invitation = await req("/invitations", adminCookie, "POST", {
    email: "roles-member@local.test",
  });
  const memberCookie = await signup(
    "roles-member@local.test",
    new URL(invitation.data.url).searchParams.get("invite")!,
  );
  const other = (await req("/me", memberCookie)).data;
  assert.equal(other.role, "member");
  assert.equal(
    (
      await req(`/members/${other.user.id}`, memberCookie, "PATCH", {
        role: "admin",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req(`/members/${self.user.id}`, adminCookie, "PATCH", {
        role: "member",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await req(`/members/${other.user.id}`, adminCookie, "PATCH", {
        role: "owner",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await req(`/members/${other.user.id}`, outsider, "PATCH", {
        role: "admin",
      })
    ).status,
    404,
  );
  const privateId = await upload(
    adminCookie,
    "Private administration does not bypass file permissions",
  );
  assert.equal(
    (
      await req(`/members/${other.user.id}`, adminCookie, "PATCH", {
        role: "admin",
      })
    ).status,
    200,
  );
  assert.equal((await req("/settings", memberCookie)).status, 200);
  assert.equal(
    (await req(`/resources/${privateId}`, memberCookie)).status,
    404,
  );
  assert.equal(
    (
      await req(`/members/${self.user.id}`, adminCookie, "PATCH", {
        role: "member",
      })
    ).status,
    200,
  );
  assert.equal((await req("/settings", adminCookie)).status, 403);
  assert.equal(
    (
      await req(`/members/${other.user.id}`, memberCookie, "PATCH", {
        role: "member",
      })
    ).status,
    400,
  );
});
test("chat attachments scope retrieval and reject unauthorized IDs before outbound calls", async () => {
  const cookie = await signup("attachments@local.test");
  await req("/settings", cookie, "PUT", {
    provider: "openai",
    model: "gpt-4.1-mini",
    models: ["approved-alternate"],
    providerKey: "attachment-secret",
    jevKey: "test-key",
  });
  const selected = await upload(
    cookie,
    "# Selected content\nThis document describes access controls.",
  );
  await upload(
    cookie,
    "# OUTSIDE_SCOPE_MARKER\nUnrelated content must not enter the prompt.",
  );
  const foreign = await upload(
    outsider,
    "# FOREIGN_SCOPE_MARKER\nNever disclose.",
  );
  const chat = (await req("/chats", cookie, "POST")).data.id;
  const before = outbound.length;
  assert.equal(
    (
      await req(`/chats/${chat}/messages`, cookie, "POST", {
        content: "Summarize this",
        documentIds: [foreign],
      })
    ).status,
    404,
  );
  assert.equal(outbound.length, before);
  const response = await req(`/chats/${chat}/messages`, cookie, "POST", {
    content: "Summarize this",
    documentIds: [selected],
    selectedModel: { provider: "openai", model: "approved-alternate" },
  });
  assert.equal(response.status, 200);
  assert.ok(response.data.messages[1].sources.length > 0);
  assert.ok(
    response.data.messages[1].sources.every(
      (source: { documentId: string }) => source.documentId === selected,
    ),
  );
  assert.equal(response.data.messages[0].attachments[0].id, selected);
  const call = outbound.at(-1)!;
  assert.equal(call.body.model, "approved-alternate");
  assert.equal(
    JSON.stringify(call.body).includes("OUTSIDE_SCOPE_MARKER"),
    false,
  );
  assert.equal(
    JSON.stringify(call.body).includes("FOREIGN_SCOPE_MARKER"),
    false,
  );
  const me = (await req("/me", cookie)).data;
  assert.equal(me.chatModels.length, 2);
  assert.equal(JSON.stringify(me).includes("attachment-secret"), false);
  const calls = outbound.length;
  assert.equal(
    (
      await req(`/chats/${chat}/messages`, cookie, "POST", {
        content: "Summarize this",
        selectedModel: { provider: "openai", model: "unapproved-model" },
      })
    ).status,
    400,
  );
  assert.equal(outbound.length, calls);
});
test("revoking an attached document hides its saved conversation and attachment names", async () => {
  const cookie = await signup("attachment-owner@local.test");
  const invitation = (
    await req("/invitations", cookie, "POST", {
      email: "attachment-reader@local.test",
    })
  ).data;
  const reader = await signup(
    "attachment-reader@local.test",
    new URL(invitation.url).searchParams.get("invite")!,
  );
  const readerId = (await req("/me", reader)).data.user.id;
  await req("/settings", cookie, "PUT", {
    provider: "openai",
    model: "gpt-4.1-mini",
    providerKey: "secret",
    jevKey: "test-key",
  });
  const selected = await upload(
    cookie,
    "# Protected content\nAttachment evidence.",
  );
  await req(`/resources/${selected}/access`, cookie, "PUT", {
    access: "restricted",
    grants: [{ userId: readerId, role: "viewer" }],
  });
  const chat = (await req("/chats", reader, "POST")).data.id;
  assert.equal(
    (
      await req(`/chats/${chat}/messages`, reader, "POST", {
        content: "Summarize",
        documentIds: [selected],
      })
    ).status,
    200,
  );
  await req(`/resources/${selected}/access`, cookie, "PUT", {
    access: "restricted",
    grants: [],
  });
  const hidden = (await req(`/chats/${chat}`, reader)).data;
  assert.equal(hidden.blocked, true);
  assert.deepEqual(hidden.messages, []);
});

test("SpiceDB denial and service failures never fall back to SQL ownership", async () => {
  const cookie = await signup("permission-service@local.test");
  const rid = await upload(cookie, "# Private\nProtected text.");
  const chat = (await req("/chats", cookie, "POST", {})).data.id;
  const original = runtime.store.authorization.check;
  try {
    runtime.store.authorization.check = async () => false;
    assert.equal((await req("/resources", cookie)).status, 401);
    const unavailable = createAuthorization(
      process.env.SPICEDB_HTTP_URL!,
      "invalid-test-token",
    );
    runtime.store.authorization.check = unavailable.check;
    for (const [path, method, body] of [
      ["/resources", "GET", undefined],
      [`/resources/${rid}`, "GET", undefined],
      [`/documents/${rid}/content`, "GET", undefined],
      ["/search", "POST", { query: "Protected" }],
      ["/chats", "GET", undefined],
      [`/chats/${chat}`, "GET", undefined],
      [`/chats/${chat}/messages`, "POST", { content: "Protected" }],
      ["/settings", "GET", undefined],
    ] as const) {
      const result = await req(path, cookie, method, body);
      assert.equal(result.status, 503);
      assert.equal(
        JSON.stringify(result.data).includes("Protected text"),
        false,
      );
    }
  } finally {
    runtime.store.authorization.check = original;
  }
  assert.equal((await req(`/resources/${rid}`, cookie)).status, 200);
});

test("partial SpiceDB writes cannot publish a grant and retry is consistent across connections", async () => {
  const cookie = await signup("snapshot-owner@local.test");
  const me = (await req("/me", cookie)).data;
  const invitation = await req("/invitations", cookie, "POST", {
    email: "snapshot-member@local.test",
  });
  const reader = await signup(
    "snapshot-member@local.test",
    new URL(invitation.data.url).searchParams.get("invite")!,
  );
  const readerMe = (await req("/me", reader)).data;
  const rid = await upload(cookie, "# Private\nSnapshot content.");
  await runtime.store.transaction(async () => {
    for (let i = 0; i < 260; i++)
      await runtime.store.run(
        "INSERT INTO resources(id,org_id,owner_id,kind,name,created) VALUES(?,?,?,'folder',?,?)",
        randomUUID(),
        me.organization.id,
        me.user.id,
        `Category ${i}`,
        new Date().toISOString(),
      );
  });
  const before = await runtime.store.one(
    "SELECT authz_version FROM orgs WHERE id=?",
    me.organization.id,
  );
  const write = runtime.store.authorization.write;
  let attemptedVersion = "";
  try {
    runtime.store.authorization.write = async (relationships) => {
      assert.ok(relationships.length > 500);
      attemptedVersion = relationships[0].resource.objectId.split("/")[0];
      await write(relationships.slice(0, 500));
      throw new HttpError(503, "Permission service unavailable. Please retry.");
    };
    assert.equal(
      (
        await req(`/resources/${rid}/access`, cookie, "PUT", {
          access: "organization",
          grants: [],
        })
      ).status,
      503,
    );
  } finally {
    runtime.store.authorization.write = write;
  }
  assert.deepEqual(
    await runtime.store.one(
      "SELECT authz_version FROM orgs WHERE id=?",
      me.organization.id,
    ),
    before,
  );
  assert.equal((await req(`/resources/${rid}`, reader)).status, 404);
  assert.equal(
    (await req(`/resources/${rid}/access`, cookie)).data.access,
    "restricted",
  );
  const second = await createStore(directory, database.url);
  const actor = {
    userId: readerMe.user.id,
    orgId: me.organization.id,
    role: "member",
    token: "test",
  };
  try {
    assert.equal(
      (
        await req(`/resources/${rid}/access`, cookie, "PUT", {
          access: "organization",
          grants: [],
        })
      ).status,
      200,
    );
    assert.equal(await resourceAccess(second, actor, rid), true);
    assert.equal(
      (
        await req(`/resources/${rid}/access`, cookie, "PUT", {
          access: "restricted",
          grants: [],
        })
      ).status,
      200,
    );
    assert.equal(await resourceAccess(second, actor, rid), false);
    await runtime.store.run(
      "UPDATE authz_snapshots SET created=now()-interval '11 minutes' WHERE version=?",
      attemptedVersion,
    );
    await runtime.store.cleanupPermissions();
    assert.equal(
      await runtime.store.one(
        "SELECT version FROM authz_snapshots WHERE version=?",
        attemptedVersion,
      ),
      undefined,
    );
    assert.equal((await req(`/resources/${rid}`, cookie)).status, 200);
  } finally {
    await second.close();
  }
});

test("parallel permission mutations do not exhaust the connection pool", async () => {
  const cookie = await signup("concurrent-mutations@local.test");
  const results = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      req("/folders", cookie, "POST", { name: `Category ${i}` }),
    ),
  );
  assert.ok(
    results.every((result) => result.status === 201),
    JSON.stringify(results.map((result) => result.status)),
  );
  const listing = await req("/resources", cookie);
  assert.equal(listing.status, 200);
  assert.equal(listing.data.length, 16);
});

test("public links are scoped, view only, revocable and enforced by SpiceDB", async () => {
  const cookie = await signup("link-owner@local.test");
  const rid = await upload(cookie, "# Shared\nVisible through its link.");
  const privateId = await upload(cookie, "# Restricted\nHidden content.");
  assert.equal(
    (
      await req(`/resources/${rid}/access`, outsider, "PUT", {
        access: "link",
        grants: [],
      })
    ).status,
    404,
  );
  const shared = await req(`/resources/${rid}/access`, cookie, "PUT", {
    access: "link",
    grants: [],
  });
  assert.equal(shared.status, 200);
  const token = new URL(shared.data.shareUrl).pathname.split("/").pop()!;
  const prefix = `/shared/${token}`;
  const metadata = await req(prefix);
  assert.equal(metadata.status, 200);
  assert.equal(metadata.data.name, "notes.md");
  assert.equal(metadata.data.canWrite, false);
  assert.equal(metadata.data.canShare, false);
  for (const key of [
    "org_id",
    "owner_id",
    "error",
    "parse_run",
    "encrypted_token",
    "token_hash",
  ])
    assert.equal(key in metadata.data, false);
  const content = await req(`${prefix}/resources/${rid}/content`);
  assert.equal(content.status, 200);
  assert.match(content.data, /Visible through its link/);
  assert.equal((await req(`${prefix}/resources/${privateId}`)).status, 404);
  assert.equal(
    (await req(`${prefix}/resources/${privateId}/content`)).status,
    404,
  );
  assert.equal((await req(`/resources/${rid}`, outsider)).status, 404);
  assert.equal(
    (await req(`/resources/${rid}`, "", "PATCH", { name: "Changed" })).status,
    401,
  );
  assert.equal((await req("/resources")).status, 401);
  assert.equal((await req(`/shared/${"a".repeat(64)}`)).status, 404);
  const check = runtime.store.authorization.check;
  try {
    runtime.store.authorization.check = async () => {
      throw new HttpError(503, "Unavailable");
    };
    assert.equal((await req(prefix)).status, 503);
    assert.equal((await req(`${prefix}/resources/${rid}/content`)).status, 503);
  } finally {
    runtime.store.authorization.check = check;
  }
  await req(`/resources/${rid}/access`, cookie, "PUT", {
    access: "restricted",
    grants: [],
  });
  assert.equal((await req(prefix)).status, 404);
  assert.equal((await req(`${prefix}/resources/${rid}/content`)).status, 404);
  const reshared = await req(`/resources/${rid}/access`, cookie, "PUT", {
    access: "link",
    grants: [],
  });
  assert.notEqual(reshared.data.shareUrl, shared.data.shareUrl);
  assert.equal((await req(prefix)).status, 404);
});

test("folder links include only inherited descendants and failed permission writes cannot publish a link", async () => {
  const cookie = await signup("folder-link-owner@local.test");
  const folderId = (
    await req("/folders", cookie, "POST", { name: "Shared folder" })
  ).data.id;
  const inherited = await upload(cookie, "Inherited content", folderId);
  const restricted = await upload(cookie, "Restricted content", folderId);
  await req(`/resources/${inherited}/access`, cookie, "PUT", {
    access: "inherit",
    grants: [],
  });
  const shared = await req(`/resources/${folderId}/access`, cookie, "PUT", {
    access: "link",
    grants: [],
  });
  const token = new URL(shared.data.shareUrl).pathname.split("/").pop()!;
  const prefix = `/shared/${token}`;
  assert.deepEqual(
    (await req(prefix)).data.children.map((r: { id: string }) => r.id),
    [inherited],
  );
  assert.equal(
    (await req(`${prefix}/resources/${inherited}/content`)).status,
    200,
  );
  assert.equal(
    (await req(`${prefix}/resources/${restricted}/content`)).status,
    404,
  );
  await req(`/resources/${inherited}/access`, cookie, "PUT", {
    access: "restricted",
    grants: [],
  });
  assert.equal(
    (await req(`${prefix}/resources/${inherited}/content`)).status,
    404,
  );
  const write = runtime.store.authorization.write;
  try {
    runtime.store.authorization.write = async () => {
      throw new HttpError(503, "Unavailable");
    };
    assert.equal(
      (
        await req(`/resources/${restricted}/access`, cookie, "PUT", {
          access: "link",
          grants: [],
        })
      ).status,
      503,
    );
  } finally {
    runtime.store.authorization.write = write;
  }
  assert.equal(
    await runtime.store.one(
      "SELECT 1 FROM share_links WHERE resource_id=?",
      restricted,
    ),
    undefined,
  );
  assert.equal(
    (await req(`/resources/${restricted}/access`, cookie)).data.access,
    "restricted",
  );
});

test("folder subtree moves replace SpiceDB parent and inherited edges and revoke old user and link access", async () => {
  const suffix = randomUUID();
  const cookie = await signup(`graph-owner-${suffix}@local.test`);
  const me = (await req("/me", cookie)).data;
  const readers: { session: string; id: string }[] = [];
  for (const label of ["source", "target"]) {
    const email = `graph-${label}-${suffix}@local.test`;
    const invitation = await req("/invitations", cookie, "POST", { email });
    const session = await signup(
      email,
      new URL(invitation.data.url).searchParams.get("invite")!,
    );
    readers.push({ session, id: (await req("/me", session)).data.user.id });
  }
  const createFolder = async (name: string, parentId: string | null = null) => {
    const response = await req("/folders", cookie, "POST", { name, parentId });
    assert.equal(response.status, 201);
    return response.data.id as string;
  };
  const source = await createFolder("Source");
  const target = await createFolder("Target");
  const branch = await createFolder("Branch", source);
  const nested = await createFolder("Nested", branch);
  const inherited = await upload(cookie, "Inherited evidence", nested);
  const restricted = await upload(cookie, "Restricted evidence", nested);
  for (const resource of [branch, nested, inherited])
    assert.equal(
      (
        await req(`/resources/${resource}/access`, cookie, "PUT", {
          access: "inherit",
          grants: [],
        })
      ).status,
      200,
    );
  await req(`/resources/${restricted}/access`, cookie, "PUT", {
    access: "restricted",
    grants: [{ userId: readers[0].id, role: "viewer" }],
  });
  const links: string[] = [];
  for (const [index, resource] of [source, target].entries()) {
    const response = await req(`/resources/${resource}/access`, cookie, "PUT", {
      access: "link",
      grants: [{ userId: readers[index].id, role: "editor" }],
    });
    assert.equal(response.status, 200);
    links.push(new URL(response.data.shareUrl).pathname.split("/").pop()!);
  }
  const version = async () =>
    (await runtime.store.one<{ authz_version: string }>(
      "SELECT authz_version FROM orgs WHERE id=?",
      me.organization.id,
    ))!.authz_version;
  const assertEdges = async (
    snapshot: string,
    resource: string,
    parent: string | null,
    inherit: boolean,
  ) => {
    const edges = (await resourceRelationships(snapshot, resource))
      .filter((edge) => ["parent", "root", "inherited"].includes(edge.relation))
      .map(
        (edge) =>
          `${edge.relation}:${edge.subject.object.objectType}:${edge.subject.object.objectId}`,
      )
      .sort();
    const expected = parent
      ? [
          `parent:jevbox/resource:${snapshot}/${parent}`,
          ...(inherit
            ? [`inherited:jevbox/resource:${snapshot}/${parent}`]
            : []),
        ]
      : [`root:jevbox/organization:${snapshot}/${me.organization.id}`];
    assert.deepEqual(edges, expected.sort());
  };
  const assertAccess = async (
    sourceAllowed: boolean,
    targetAllowed: boolean,
  ) => {
    for (const [index, allowed] of [sourceAllowed, targetAllowed].entries()) {
      for (const resource of [branch, nested, inherited]) {
        const response = await req(
          `/resources/${resource}`,
          readers[index].session,
        );
        assert.equal(response.status, allowed ? 200 : 404);
        if (allowed) assert.equal(response.data.canWrite, true);
      }
      assert.equal(
        (await req(`/documents/${inherited}/content`, readers[index].session))
          .status,
        allowed ? 200 : 404,
      );
      assert.equal(
        (await req(`/shared/${links[index]}/resources/${inherited}/content`))
          .status,
        allowed ? 200 : 404,
      );
      assert.equal(
        (await req(`/shared/${links[index]}/resources/${restricted}/content`))
          .status,
        404,
      );
    }
  };
  const before = await version();
  await assertEdges(before, branch, source, true);
  await assertEdges(before, nested, branch, true);
  await assertEdges(before, inherited, nested, true);
  await assertEdges(before, restricted, nested, false);
  await assertAccess(true, false);
  const write = runtime.store.authorization.write;
  try {
    runtime.store.authorization.write = async (relationships) => {
      await write(relationships);
      throw new HttpError(503, "Unavailable");
    };
    assert.equal(
      (
        await req(`/resources/${branch}/move`, cookie, "POST", {
          parentId: target,
        })
      ).status,
      503,
    );
  } finally {
    runtime.store.authorization.write = write;
  }
  assert.equal(await version(), before);
  assert.equal(
    (await req(`/resources/${branch}`, cookie)).data.parent_id,
    source,
  );
  await assertAccess(true, false);
  assert.equal(
    (
      await req(`/resources/${branch}/move`, cookie, "POST", {
        parentId: target,
      })
    ).status,
    200,
  );
  const moved = await version();
  assert.notEqual(moved, before);
  await assertEdges(moved, branch, target, true);
  await assertEdges(moved, nested, branch, true);
  await assertEdges(moved, inherited, nested, true);
  await assertEdges(moved, restricted, nested, false);
  await assertAccess(false, true);
  assert.equal(
    (await req(`/resources/${restricted}`, readers[0].session)).status,
    404,
  );
  assert.equal(
    (await req(`/resources/${restricted}`, readers[1].session)).status,
    404,
  );
  assert.equal(
    (await req(`/resources/${branch}/move`, cookie, "POST", { parentId: null }))
      .status,
    200,
  );
  await assertEdges(await version(), branch, null, false);
  assert.equal(
    (await req(`/resources/${branch}`, cookie)).data.access,
    "restricted",
  );
  await assertAccess(false, false);
  assert.equal(
    (await req(`/resources/${branch}`, cookie, "DELETE")).status,
    200,
  );
  const deleted = await version();
  for (const resource of [branch, nested, inherited, restricted])
    assert.deepEqual(await resourceRelationships(deleted, resource), []);
});

test("startup rebuilds committed permission snapshots after SpiceDB relationship loss", async () => {
  const cookie = await signup(`restore-${randomUUID()}@local.test`);
  const me = (await req("/me", cookie)).data;
  const folder = (await req("/folders", cookie, "POST", { name: "Root" })).data
    .id;
  const document = await upload(cookie, "Evidence", folder);
  await req(`/resources/${document}/access`, cookie, "PUT", {
    access: "inherit",
    grants: [],
  });
  const actor = {
    userId: me.user.id,
    orgId: me.organization.id,
    role: "admin",
    token: "test",
  };
  const before = (await runtime.store.one<{ authz_version: string }>(
    "SELECT authz_version FROM orgs WHERE id=?",
    actor.orgId,
  ))!.authz_version;
  await runtime.store.authorization.removeSnapshot(before);
  assert.equal(await resourceAccess(runtime.store, actor, document), false);
  const restarted = await createStore(directory, database.url);
  try {
    const after = (await restarted.one<{ authz_version: string }>(
      "SELECT authz_version FROM orgs WHERE id=?",
      actor.orgId,
    ))!.authz_version;
    assert.notEqual(after, before);
    assert.equal(await resourceAccess(restarted, actor, document), true);
    assert.equal(await resourceAccess(runtime.store, actor, document), true);
    const edges = await resourceRelationships(after, document);
    for (const relation of ["parent", "inherited"])
      assert.equal(
        edges.find((edge) => edge.relation === relation)?.subject.object
          .objectId,
        `${after}/${folder}`,
      );
    assert.equal(
      await restarted.one(
        "SELECT 1 FROM authz_dirty WHERE org_id=?",
        actor.orgId,
      ),
      undefined,
    );
  } finally {
    await restarted.close();
  }
});

test("resource moves require ownership and destination write access and atomically update inherited permissions", async () => {
  const cookie = await signup("move-owner@local.test");
  const invitation = await req("/invitations", cookie, "POST", {
    email: "move-member@local.test",
  });
  const viewer = await signup(
    "move-member@local.test",
    new URL(invitation.data.url).searchParams.get("invite")!,
  );
  const viewerId = (await req("/me", viewer)).data.user.id;
  const source = (await req("/folders", cookie, "POST", { name: "Source" }))
    .data.id;
  const target = (
    await req("/folders", cookie, "POST", { name: "Destination" })
  ).data.id;
  const nested = (
    await req("/folders", cookie, "POST", { name: "Nested", parentId: target })
  ).data.id;
  const doc = await upload(cookie, "Shared content", source);
  await req(`/resources/${doc}/access`, cookie, "PUT", {
    access: "inherit",
    grants: [{ userId: viewerId, role: "editor" }],
  });
  const sharing = await req(`/resources/${source}/access`, cookie, "PUT", {
    access: "link",
    grants: [{ userId: viewerId, role: "viewer" }],
  });
  const token = new URL(sharing.data.shareUrl).pathname.split("/").pop()!;
  const move = (resource: string, parentId: string | null, actor = cookie) =>
    req(`/resources/${resource}/move`, actor, "POST", { parentId });
  assert.equal((await req(`/shared/${token}/resources/${doc}`)).status, 200);
  assert.equal((await move(doc, target, viewer)).status, 404);
  assert.equal((await move(doc, target, outsider)).status, 404);
  assert.equal((await move(target, target)).status, 400);
  assert.equal((await move(target, nested)).status, 400);
  assert.equal((await move(source, doc)).status, 400);
  const foreign = (await req("/folders", outsider, "POST", { name: "Other" }))
    .data.id;
  assert.equal((await move(doc, foreign)).status, 404);
  const viewerFolder = (
    await req("/folders", viewer, "POST", { name: "Private" })
  ).data.id;
  await req(`/resources/${viewerFolder}/access`, viewer, "PUT", {
    access: "organization",
    grants: [],
  });
  assert.equal((await move(doc, viewerFolder)).status, 404);
  const write = runtime.store.authorization.write;
  try {
    runtime.store.authorization.write = async () => {
      throw new HttpError(503, "Unavailable");
    };
    assert.equal((await move(doc, target)).status, 503);
  } finally {
    runtime.store.authorization.write = write;
  }
  assert.equal((await req(`/resources/${doc}`, cookie)).data.parent_id, source);
  assert.equal((await req(`/shared/${token}/resources/${doc}`)).status, 200);
  assert.equal((await move(doc, target)).status, 200);
  assert.equal((await req(`/resources/${doc}`, cookie)).data.parent_id, target);
  assert.equal((await req(`/shared/${token}/resources/${doc}`)).status, 404);
  assert.equal((await req(`/resources/${doc}`, viewer)).status, 404);
  assert.equal((await move(doc, null)).status, 200);
  const moved = (await req(`/resources/${doc}`, cookie)).data;
  assert.equal(moved.parent_id, null);
  assert.equal(moved.access, "restricted");
  assert.equal((await move(target, source)).status, 200);
  assert.equal(
    (await req(`/resources/${nested}`, cookie)).data.parent_id,
    target,
  );
});

async function contextFixture() {
  const cookie = await signup(`context-${randomUUID()}@local.test`);
  const saved = await req("/settings", cookie, "PUT", {
    jevKey: "context-secret",
    provider: "openai",
    model: "gpt-4.1-mini",
    providerKey: "context-chat-secret",
  });
  assert.equal(saved.status, 200);
  const documentId = await upload(
    cookie,
    "# Weak\nTOPIC_ONLY\n\n# Supporting\nPARTIAL_EVIDENCE\n\n# Direct\nWhat is the answer?\n" +
      "Background information. ".repeat(80) +
      "\nSPECIFIC_ANSWER",
  );
  return { cookie, documentId };
}

test("search and chat independently filter full excerpts by usefulness", async () => {
  const { cookie, documentId } = await contextFixture();
  scoreContext = async (body) => {
    assert.equal(typeof body.state, "string");
    assert.equal(body.questions.usefulness.type, "score");
    assert.equal(body.questions.usefulness.criteria.length, 4);
    const score = body.state.includes("TOPIC_ONLY")
      ? 1.49
      : body.state.includes("PARTIAL_EVIDENCE")
        ? 1.5
        : 3;
    return Response.json({ answers: { usefulness: { type: "score", score } } });
  };
  try {
    outbound.length = 0;
    const search = await req("/search", cookie, "POST", {
      query: "What is the answer?",
    });
    assert.equal(search.status, 200);
    assert.deepEqual(
      search.data.results.map((s: any) => s.score),
      [3, 1.5],
    );
    assert.ok(
      search.data.results.every((s: any) => s.documentId === documentId),
    );
    const scoring = outbound.filter((r) => r.body?.questions?.usefulness);
    assert.equal(scoring.length, 3);
    assert.ok(
      scoring.some((r) => r.body.state.indexOf("SPECIFIC_ANSWER") > 1200),
    );
    const chat = (await req("/chats", cookie, "POST")).data.id;
    outbound.length = 0;
    const answer = await req(`/chats/${chat}/messages`, cookie, "POST", {
      content: "What is the answer?",
      documentIds: [documentId],
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.data.messages[1].sources.length, 2);
    const generation = outbound.find(
      (r) =>
        r.url.includes("openai") &&
        r.body.input.some(
          (message: any) => message.type === "function_call_output",
        ),
    );
    assert.ok(generation);
    const context = JSON.parse(generation.body.input.at(-1).output);
    assert.deepEqual(
      context.sources.map((s: any) => s.citation),
      [1, 2],
    );
    assert.match(context.sources[0].text, /SPECIFIC_ANSWER/);
    assert.match(context.sources[1].text, /PARTIAL_EVIDENCE/);
    assert.equal(JSON.stringify(context).includes("TOPIC_ONLY"), false);
  } finally {
    scoreContext = undefined;
  }
});

test("empty search results reach the model without rejected excerpts", async () => {
  const { cookie, documentId } = await contextFixture();
  scoreContext = async () =>
    Response.json({
      answers: { usefulness: { type: "score", score: 1 } },
    });
  try {
    const search = await req("/search", cookie, "POST", {
      query: "What is the answer?",
    });
    assert.equal(search.status, 200);
    assert.deepEqual(search.data.results, []);
    const chat = (await req("/chats", cookie, "POST")).data.id;
    outbound.length = 0;
    const answer = await req(`/chats/${chat}/messages`, cookie, "POST", {
      content: "What is the answer?",
      documentIds: [documentId],
    });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.data.messages[1].sources, []);
    assert.equal(
      answer.data.messages[1].content,
      "No relevant sources were returned for this question.",
    );
    const generation = outbound.find(
      (r) =>
        r.url.includes("openai") &&
        r.body.input.some(
          (message: any) => message.type === "function_call_output",
        ),
    );
    assert.ok(generation);
    assert.deepEqual(
      JSON.parse(generation.body.input.at(-1).output).sources,
      [],
    );
    assert.match(
      generation.body.input[0].content,
      /Say when evidence is missing/,
    );
  } finally {
    scoreContext = undefined;
  }
});

test("context filter failures never send unfiltered excerpts to chat", async () => {
  const { cookie, documentId } = await contextFixture();
  try {
    for (const invalid of [undefined, "3", -1, 3.01]) {
      scoreContext = async () =>
        Response.json({
          answers: { usefulness: { type: "score", score: invalid } },
        });
      const search = await req("/search", cookie, "POST", {
        query: "What is the answer?",
      });
      assert.equal(search.status, 502);
    }
    scoreContext = async () => new Response("Unavailable", { status: 503 });
    const chat = (await req("/chats", cookie, "POST")).data.id;
    outbound.length = 0;
    const answer = await req(`/chats/${chat}/messages`, cookie, "POST", {
      content: "What is the answer?",
      documentIds: [documentId],
    });
    assert.equal(answer.status, 502);
    assert.equal(outbound.filter((r) => r.url.includes("openai")).length, 1);
    assert.deepEqual((await req(`/chats/${chat}`, cookie)).data.messages, []);
  } finally {
    scoreContext = undefined;
  }
});

test("context scoring rechecks permissions and excludes revoked results", async () => {
  const { cookie } = await contextFixture();
  await upload(
    cookie,
    "# First\nEvidence\n# Second\nEvidence\n# Third\nEvidence",
  );
  const me = (await req("/me", cookie)).data;
  const actor = {
    userId: me.user.id,
    orgId: me.organization.id,
    role: "owner" as const,
    token: "test-only",
  };
  let calls = 0;
  scoreContext = async () => {
    calls++;
    await runtime.store.run(
      "DELETE FROM members WHERE org_id=? AND user_id=?",
      actor.orgId,
      actor.userId,
    );
    return Response.json({
      answers: { usefulness: { type: "score", score: 3 } },
    });
  };
  try {
    const result = await createProviders(runtime.store, fakeFetch).retrieve(
      actor,
      "Evidence",
    );
    assert.ok(calls > 0 && calls <= 4);
    assert.deepEqual(result.results, []);
    assert.ok(result.trace.every((entry) => !entry.resourceId));
  } finally {
    scoreContext = undefined;
  }
});

test("bulk deletion recursively removes nested contents and deduplicates selections", async () => {
  const first = await upload(owner, "First", undefined, "first.txt");
  const foreign = await upload(outsider, "Other", undefined, "other.txt");
  const denied = await req("/resources/delete-batch", owner, "POST", {
    ids: [first, foreign],
  });
  assert.equal(denied.status, 404);
  assert.ok(
    await runtime.store.one("SELECT id FROM resources WHERE id=?", first),
  );
  const parent = (await req("/folders", owner, "POST", { name: "Batch" })).data
    .id;
  const child = await upload(owner, "Child", parent, "child.txt");
  const nested = (
    await req("/folders", owner, "POST", { name: "Nested", parentId: parent })
  ).data.id;
  const deep = await upload(owner, "Deep", nested, "deep.txt");
  const sibling = await upload(owner, "Keep", undefined, "keep.txt");
  assert.equal(
    (
      await req(`/resources/${deep}/access`, owner, "PUT", {
        access: "link",
        grants: [],
      })
    ).status,
    200,
  );
  const removed = await req("/resources/delete-batch", owner, "POST", {
    ids: [parent, nested, first, first],
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.equal(removed.data.count, 5);
  for (const id of [parent, child, nested, deep, first]) {
    assert.equal(
      await runtime.store.one("SELECT id FROM resources WHERE id=?", id),
      undefined,
    );
    assert.equal(
      (
        await runtime.store.all(
          "SELECT id FROM audit WHERE resource_id=? AND action='resource.delete'",
          id,
        )
      ).length,
      1,
    );
  }
  for (const table of ["blobs", "share_links", "grants"])
    assert.equal(
      await runtime.store.one(
        `SELECT resource_id FROM ${table} WHERE resource_id=?`,
        deep,
      ),
      undefined,
    );
  for (const id of [foreign, sibling])
    assert.ok(
      await runtime.store.one("SELECT id FROM resources WHERE id=?", id),
    );
});

test("single folder deletion recursively removes its nested documents", async () => {
  const parent = (await req("/folders", owner, "POST", { name: "Recursive" }))
    .data.id;
  const nested = (
    await req("/folders", owner, "POST", { name: "Nested", parentId: parent })
  ).data.id;
  const child = await upload(owner, "Child", nested, "child.txt");
  const removed = await req(`/resources/${parent}`, owner, "DELETE");
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  for (const id of [parent, nested, child])
    assert.equal(
      await runtime.store.one("SELECT id FROM resources WHERE id=?", id),
      undefined,
    );
  assert.equal(
    await runtime.store.one(
      "SELECT resource_id FROM blobs WHERE resource_id=?",
      child,
    ),
    undefined,
  );
  assert.equal((await req(`/documents/${child}`, owner)).status, 404);
});

test("recursive deletion checks descendant permissions before deleting anything", async () => {
  const invitation = await req("/invitations", owner, "POST", {
    email: "recursive@local.test",
  });
  const collaborator = await signup(
    "recursive@local.test",
    new URL(invitation.data.url).searchParams.get("invite")!,
  );
  const collaboratorId = (await req("/me", collaborator)).data.user.id;
  const parent = (await req("/folders", owner, "POST", { name: "Shared" })).data
    .id;
  const first = await upload(owner, "First", undefined, "first.txt");
  assert.equal(
    (
      await req(`/resources/${parent}/access`, owner, "PUT", {
        access: "restricted",
        grants: [{ userId: collaboratorId, role: "editor" }],
      })
    ).status,
    200,
  );
  const child = await upload(collaborator, "Child", parent, "child.txt");
  for (const [path, method, body] of [
    [`/resources/${parent}`, "DELETE", undefined],
    ["/resources/delete-batch", "POST", { ids: [first, parent] }],
  ] as const) {
    const denied = await req(path, owner, method, body);
    assert.equal(denied.status, 404);
    for (const id of [first, parent, child]) {
      assert.ok(
        await runtime.store.one("SELECT id FROM resources WHERE id=?", id),
      );
      assert.equal(
        await runtime.store.one(
          "SELECT id FROM audit WHERE resource_id=? AND action='resource.delete'",
          id,
        ),
        undefined,
      );
    }
  }
});

test("content ranges bound thumbnail downloads and retain permission checks", async () => {
  const content = "0123456789".repeat(3000);
  const resource = await upload(owner, content, undefined, "Range.txt");
  const response = await fetch(`${base}/api/documents/${resource}/content`, {
    headers: { Cookie: owner, Range: "bytes=0-16383" },
  });
  assert.equal(response.status, 206);
  assert.equal(
    response.headers.get("content-range"),
    `bytes 0-16383/${content.length}`,
  );
  assert.equal((await response.text()).length, 16384);
  const suffix = await fetch(`${base}/api/documents/${resource}/content`, {
    headers: { Cookie: owner, Range: "bytes=-4" },
  });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), content.slice(-4));
  const invalid = await fetch(`${base}/api/documents/${resource}/content`, {
    headers: { Cookie: owner, Range: "bytes=90000-" },
  });
  assert.equal(invalid.status, 416);
  const denied = await fetch(`${base}/api/documents/${resource}/content`, {
    headers: { Cookie: outsider, Range: "bytes=0-10" },
  });
  assert.equal(denied.status, 404);
});
