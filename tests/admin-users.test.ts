import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { createApp } from "../server/app";
import { createAuthentication } from "../server/auth";
import { testDatabase } from "./database";

const ownerId = randomUUID();
const adminId = randomUUID();
const pendingId = randomUUID();
const origin = "http://localhost:4310";
const password = "a-secure-password-123!";
let runtime: Awaited<ReturnType<typeof createApp>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let server: ReturnType<typeof runtime.app.listen>;
let directory: string;
let base: string;
let ownerCookie: string;
let adminCookie: string;

async function request(path: string, cookie = "", body?: unknown) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Jevbox-Request": "1",
      Cookie: cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
}

before(async () => {
  database = await testDatabase();
  directory = mkdtempSync(join(tmpdir(), "jevbox-admin-users-"));
  const previousOwner = process.env.OWNER_USER_ID;
  process.env.OWNER_USER_ID = ownerId;
  try {
    runtime = await createApp({
      directory,
      databaseUrl: database.url,
      origin,
      rateLimits: false,
      sendAuthEmail: async () => {},
    });
  } finally {
    if (previousOwner === undefined) delete process.env.OWNER_USER_ID;
    else process.env.OWNER_USER_ID = previousOwner;
  }
  const hash = await hashPassword(password);
  for (const [id, email, name, verified, role, created] of [
    [ownerId, "owner@local.test", "Owner", true, "user", "2026-01-01"],
    [adminId, "admin@local.test", "Administrator", true, "admin", "2026-01-02"],
    [pendingId, "pending@local.test", "Pending", false, "user", "2026-01-03"],
  ] as const) {
    await runtime.store.run(
      "INSERT INTO users(id,email,name,email_verified,role,created_at) VALUES(?,?,?,?,?,?)",
      id,
      email,
      name,
      verified,
      role,
      created,
    );
    if (!verified) continue;
    const org = randomUUID();
    await runtime.store.run("INSERT INTO orgs(id,name) VALUES(?,?)", org, name);
    await runtime.store.run(
      "INSERT INTO members(org_id,user_id,role) VALUES(?,?,?)",
      org,
      id,
      id === ownerId ? "member" : "admin",
    );
    await runtime.store.run(
      "INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password) VALUES(?,?,'credential',?,?)",
      randomUUID(),
      id,
      id,
      hash,
    );
  }
  runtime.app.get("/{*path}", (_req, res) =>
    res.type("html").send("APP_SHELL"),
  );
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  async function signIn(email: string) {
    const response = await request("/api/auth/sign-in/email", "", {
      email,
      password,
    });
    assert.equal(response.status, 200, await response.text());
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  }
  ownerCookie = await signIn("owner@local.test");
  adminCookie = await signIn("admin@local.test");
});

after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (database) await database.cleanup(runtime?.store);
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("only the configured owner can list signups across organizations", async () => {
  const response = await request(
    "/api/auth/admin/list-users?sortBy=createdAt&sortDirection=desc&limit=2",
    ownerCookie,
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 3);
  assert.deepEqual(
    data.users.map((user: { id: string }) => user.id),
    [pendingId, adminId],
  );
  assert.equal(data.users[0].emailVerified, false);
  assert.equal(data.users[0].createdAt, "2026-01-03T00:00:00.000Z");
  assert.equal(data.users[0].password, undefined);
  const page = await request(
    "/api/auth/admin/list-users?sortBy=createdAt&sortDirection=desc&limit=2&offset=2",
    ownerCookie,
  );
  assert.deepEqual(
    (await page.json()).users.map((user: { id: string }) => user.id),
    [ownerId],
  );
  const search = await request(
    "/api/auth/admin/list-users?searchField=email&searchOperator=contains&searchValue=pending",
    ownerCookie,
  );
  assert.equal((await search.json()).total, 1);
  assert.equal(
    (await (await request("/api/me", ownerCookie)).json()).isOwner,
    true,
  );
  assert.equal((await request("/settings/users", ownerCookie)).status, 200);
});

test("anonymous users and other admins cannot access the directory or its API", async () => {
  assert.equal((await request("/api/auth/admin/list-users")).status, 401);
  assert.equal((await request("/settings/users")).status, 302);
  assert.equal(
    (await request("/api/auth/admin/list-users", adminCookie)).status,
    403,
  );
  assert.equal((await request("/settings/users", adminCookie)).status, 403);
  assert.equal((await request("/settings/users/", adminCookie)).status, 403);
  assert.equal(
    (await (await request("/api/me", adminCookie)).json()).isOwner,
    false,
  );
});

test("user administration stays read-only even for the owner", async () => {
  for (const [path, body] of [
    ["set-role", { userId: adminId, role: "user" }],
    ["remove-user", { userId: adminId }],
    ["ban-user", { userId: adminId }],
    ["impersonate-user", { userId: adminId }],
    ["set-user-password", { userId: adminId, newPassword: password }],
    ["create-user", { email: "created@local.test", name: "Created", password }],
  ] as const) {
    const response = await request(
      `/api/auth/admin/${path}`,
      ownerCookie,
      body,
    );
    assert.equal(response.status, 403, path);
    assert.equal(
      (await response.json()).message,
      "User administration is read-only",
    );
  }
  assert.equal(
    (
      await runtime.store.one<{ role: string }>(
        "SELECT role FROM users WHERE id=?",
        adminId,
      )
    )?.role,
    "admin",
  );
});

test("missing owner configuration denies even a persisted global admin", async () => {
  const previousOwner = process.env.OWNER_USER_ID;
  delete process.env.OWNER_USER_ID;
  try {
    const disabled = createAuthentication(runtime.store, {
      directory,
      origin,
      rateLimits: false,
      sendAuthEmail: async () => {},
    });
    assert.equal(disabled.isOwner(ownerId), false);
    for (const cookie of [ownerCookie, adminCookie]) {
      await assert.rejects(
        disabled.auth.api.listUsers({
          headers: new Headers({ Cookie: cookie }),
          query: {},
        }),
        (error: any) => error.statusCode === 403,
      );
    }
  } finally {
    if (previousOwner === undefined) delete process.env.OWNER_USER_ID;
    else process.env.OWNER_USER_ID = previousOwner;
  }
});

test("revoked owner sessions cannot list users", async () => {
  await runtime.store.run("DELETE FROM auth_sessions WHERE user_id=?", ownerId);
  assert.equal(
    (await request("/api/auth/admin/list-users", ownerCookie)).status,
    401,
  );
});
