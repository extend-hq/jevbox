import { runJobs, waitForJobs } from "./jobs";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, scryptSync } from "node:crypto";
import { Pool } from "pg";
import { createApp } from "../server/app";
import { createAuthentication } from "../server/auth";
import { createWorkers } from "../server/workers";
import { queues } from "../server/jobs";
import { testDatabase } from "./database";
import { authMailbox } from "./auth-mailbox";

const origin = "http://localhost:4310";
const mailbox = authMailbox(origin);
const password = "a-secure-password-123!";
let runtime: Awaited<ReturnType<typeof createApp>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let server: ReturnType<typeof runtime.app.listen>;
let directory: string;
let base: string;
let owner: string;
const headers = {
  Origin: origin,
  "X-Jevbox-Request": "1",
  "Content-Type": "application/json",
};
async function request(path: string, body?: unknown, cookie = "") {
  const response = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...headers, Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
  await waitForJobs(runtime, ["auth-email"]);
  return response;
}
before(async () => {
  database = await testDatabase();
  directory = mkdtempSync(join(tmpdir(), "jevbox-auth-"));
  runtime = await createApp({
    workers: ["auth-email", "chat-answer"],
    directory,
    databaseUrl: database.url,
    origin,
    rateLimits: false,
    sendAuthEmail: mailbox.sendAuthEmail,
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (database) await database.cleanup(runtime?.store);
  if (directory) rmSync(directory, { recursive: true, force: true });
});
test("registration requires mailbox verification before access and cannot bypass organization admission", async () => {
  const response = await request("/auth/register", {
    name: "Account",
    organization: "Workspace",
    email: "auth@local.test",
    password,
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await request("/me")).status, 401);
  const rejected = await request("/auth/sign-in/email", {
    email: "auth@local.test",
    password,
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).code, "EMAIL_NOT_VERIFIED");
  assert.equal(rejected.headers.get("set-cookie"), null);
  assert.equal(
    (
      await request("/auth/sign-up/email", {
        name: "Account",
        email: "bypass@local.test",
        password,
      })
    ).status,
    403,
  );
  assert.equal(
    await runtime.store.one(
      "SELECT id FROM users WHERE email=?",
      "bypass@local.test",
    ),
    undefined,
  );
  owner = await mailbox.signIn(base, "auth@local.test");
  assert.equal((await request("/me", undefined, owner)).status, 200);
  const credential = await runtime.store.one<{ password: string }>(
    "SELECT password FROM auth_accounts WHERE user_id=(SELECT id FROM users WHERE email=?)",
    "auth@local.test",
  );
  assert.match(credential!.password, /^scrypt\$/);
});
test("session organization cannot be supplied by the client and forged cookies are rejected", async () => {
  assert.equal(
    (await request("/auth/update-session", { orgId: randomUUID() }, owner))
      .status,
    400,
  );
  assert.equal(
    (await request("/me", undefined, owner.replace(/.$/, "x"))).status,
    401,
  );
  assert.equal(
    (await request("/me", undefined, "jevbox_session=legacy-token")).status,
    401,
  );
});
test("verification rejects tampered tokens and off-origin redirects", async () => {
  const url = new URL(mailbox.messages[0].url);
  const invalid = await fetch(
    base + url.pathname + "?token=invalid&callbackURL=%2F",
    { redirect: "manual" },
  );
  assert.ok(
    invalid.status >= 400 ||
      invalid.headers.get("location")?.includes("error="),
  );
  const redirected = await request("/auth/send-verification-email", {
    email: "auth@local.test",
    callbackURL: "https://outside.test/",
  });
  assert.equal(redirected.status, 403);
});
test("password reset tokens are single-use and revoke every existing session", async () => {
  assert.equal(
    (
      await request("/auth/request-password-reset", {
        email: "auth@local.test",
        redirectTo: "/reset-password",
      })
    ).status,
    200,
  );
  const mail = mailbox.messages.findLast(
    (message) => message.kind === "password-reset",
  )!;
  const link = new URL(mail.url);
  const callback = await fetch(base + link.pathname + link.search, {
    redirect: "manual",
  });
  assert.equal(callback.status, 302);
  const token = new URL(
    callback.headers.get("location")!,
    origin,
  ).searchParams.get("token");
  assert.ok(token);
  const newPassword = "updated-secure-password-456!";
  assert.equal(
    (await request("/auth/reset-password", { token, newPassword })).status,
    200,
  );
  assert.equal((await request("/me", undefined, owner)).status, 401);
  assert.equal(
    (await request("/auth/reset-password", { token, newPassword })).status,
    400,
  );
  assert.equal(
    (
      await request("/auth/sign-in/email", {
        email: "auth@local.test",
        password,
      })
    ).status,
    401,
  );
  const signedIn = await request("/auth/sign-in/email", {
    email: "auth@local.test",
    password: newPassword,
  });
  assert.equal(signedIn.status, 200);
  owner = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const missing = await request("/auth/request-password-reset", {
    email: "missing@local.test",
    redirectTo: "/reset-password",
  });
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), {
    status: true,
    message:
      "If this email exists in our system, check your email for the reset link",
  });
});
test("logout revokes the Better Auth session", async () => {
  assert.equal((await request("/auth/logout", {}, owner)).status, 200);
  assert.equal((await request("/me", undefined, owner)).status, 401);
});
test("signing out other devices preserves the current session", async () => {
  const credentials = {
    email: "auth@local.test",
    password: "updated-secure-password-456!",
  };
  const signIn = async () => {
    const response = await request("/auth/sign-in/email", credentials);
    assert.equal(response.status, 200);
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };
  const current = await signIn();
  const other = await signIn();
  assert.equal(
    (await request("/auth/revoke-other-sessions", {}, current)).status,
    200,
  );
  assert.equal((await request("/me", undefined, current)).status, 200);
  assert.equal((await request("/me", undefined, other)).status, 401);
});
test("production requires secure configuration and issues secure cookies", async () => {
  const keys = [
    "NODE_ENV",
    "AUTH_LOCAL_DEVELOPMENT",
    "BETTER_AUTH_SECRET",
    "SMTP_HOST",
    "AUTH_EMAIL_FROM",
  ] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    process.env.NODE_ENV = "production";
    for (const key of keys.slice(1)) delete process.env[key];
    const options = {
      directory,
      origin: "https://auth.local.test",
      rateLimits: false,
    };
    assert.throws(
      () => createAuthentication(runtime.store, { ...options, origin }),
      /HTTPS/,
    );
    assert.throws(
      () => createAuthentication(runtime.store, options),
      /BETTER_AUTH_SECRET is required/,
    );
    process.env.BETTER_AUTH_SECRET = "production-test-secret-".repeat(3);
    assert.throws(
      () => createAuthentication(runtime.store, options),
      /SMTP_HOST and AUTH_EMAIL_FROM/,
    );
    const { auth } = createAuthentication(runtime.store, {
      ...options,
      sendAuthEmail: mailbox.sendAuthEmail,
    });
    const response = await auth.api.signInEmail({
      body: {
        email: "auth@local.test",
        password: "updated-secure-password-456!",
      },
      headers: new Headers({ Origin: options.origin }),
      asResponse: true,
    });
    assert.equal(response.status, 200);
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token"))!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /__Secure-jevbox/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
test(
  "parallel registration provisions every account without exhausting the connection pool",
  { timeout: 30000 },
  async () => {
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        request("/auth/register", {
          name: "Account",
          organization: "Workspace",
          email: `parallel-${index}@local.test`,
          password,
        }),
      ),
    );
    assert.ok(results.every((response) => response.status === 201));
    const members = await runtime.store.all(
      "SELECT m.user_id FROM members m JOIN users u ON u.id=m.user_id WHERE u.email LIKE 'parallel-%'",
    );
    assert.equal(members.length, 16);
  },
);
test("failed membership provisioning removes the credential account and can be retried", async () => {
  const write = runtime.store.authorization.write;
  const input = {
    name: "Account",
    organization: "Workspace",
    email: "provisioning@local.test",
    password,
  };
  try {
    runtime.store.authorization.write = async () => {
      throw new Error("Unavailable");
    };
    assert.equal((await request("/auth/register", input)).status, 500);
    assert.equal(
      await runtime.store.one(
        "SELECT id FROM users WHERE email=?",
        input.email,
      ),
      undefined,
    );
    assert.equal(
      mailbox.messages.some((message) => message.to === input.email),
      false,
    );
  } finally {
    runtime.store.authorization.write = write;
  }
  assert.equal((await request("/auth/register", input)).status, 201);
  const cookie = await mailbox.signIn(base, input.email);
  assert.equal((await request("/me", undefined, cookie)).status, 200);
});
test("account throttling survives auth recreation and changing client IPs", async () => {
  let auth = createAuthentication(runtime.store, {
    directory,
    origin,
    sendAuthEmail: mailbox.sendAuthEmail,
  }).auth;
  for (let index = 0; index < 11; index++) {
    if (index === 10)
      auth = createAuthentication(runtime.store, {
        directory,
        origin,
        sendAuthEmail: mailbox.sendAuthEmail,
      }).auth;
    await assert.rejects(
      auth.api.signInEmail({
        body: { email: "throttled@local.test", password },
        headers: new Headers({ "x-jevbox-client-ip": `192.0.2.${index + 1}` }),
      }),
      (error: any) =>
        error.status === (index < 10 ? "UNAUTHORIZED" : "TOO_MANY_REQUESTS"),
    );
  }
});
test("recovery responses do not wait for SMTP delivery", async () => {
  await runtime.workers.stop([queues.email]);
  let delivered = false;
  let release!: () => void;
  const delivery = new Promise<void>((resolve) => {
    release = resolve;
  });
  const consumer = createWorkers(runtime.store, {
    origin,
    sendAuthEmail: async () => {
      await delivery;
      delivered = true;
    },
  });
  await consumer.start([queues.email]);
  try {
    const result = await Promise.race([
      runtime.auth.api.requestPasswordReset({
        body: { email: "auth@local.test", redirectTo: "/reset-password" },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Recovery waited for SMTP")), 1000),
      ),
    ]);
    assert.equal(result.status, true);
    assert.equal(delivered, false);
    const pending = await runtime.store.jobs.boss.findJobs(queues.email);
    assert.ok(
      pending.some((job) => job.state === "active" || job.state === "created"),
    );
  } finally {
    release();
    await waitForJobs(runtime, [queues.email]);
    await consumer.stop([queues.email]);
    await runtime.workers.start([queues.email]);
  }
  assert.equal(delivered, true);
});
test("migration preserves user IDs and passwords, requires verification, and invalidates old sessions", async () => {
  const isolated = await testDatabase();
  const pool = new Pool({ connectionString: isolated.url });
  const id = randomUUID();
  const org = randomUUID();
  const salt = "a".repeat(32);
  const oldHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  await pool.query(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)",
  );
  const { readFileSync } = await import("node:fs");
  await pool.query(
    readFileSync(
      new URL("../server/migrations/001-postgres.sql", import.meta.url),
      "utf8",
    ),
  );
  await pool.query("INSERT INTO schema_migrations VALUES(1)");
  await pool.query("INSERT INTO users VALUES($1,$2,$3,$4)", [
    id,
    "migrated@local.test",
    "Account",
    oldHash,
  ]);
  await pool.query("INSERT INTO orgs(id,name) VALUES($1,'Workspace')", [org]);
  await pool.query(
    "INSERT INTO members(org_id,user_id,role) VALUES($1,$2,'admin')",
    [org, id],
  );
  await pool.query("INSERT INTO sessions VALUES('legacy',$1,$2,$3)", [
    id,
    org,
    Date.now() + 86400000,
  ]);
  const localDirectory = mkdtempSync(join(tmpdir(), "jevbox-auth-migration-"));
  let migrated: typeof runtime | undefined;
  try {
    migrated = await createApp({
      workers: ["auth-email", "chat-answer"],
      directory: localDirectory,
      databaseUrl: isolated.url,
      origin,
      rateLimits: false,
      sendAuthEmail: mailbox.sendAuthEmail,
    });
    assert.equal(
      (await migrated.store.one<{ id: string }>(
        "SELECT id FROM users WHERE email=?",
        "migrated@local.test",
      ))!.id,
      id,
    );
    const account = await migrated.store.one<{ password: string }>(
      "SELECT password FROM auth_accounts WHERE user_id=?",
      id,
    );
    assert.equal(account!.password, "legacy_scrypt$" + oldHash);
    await assert.rejects(
      migrated.auth.api.signInEmail({
        body: { email: "migrated@local.test", password },
      }),
      /Email not verified/i,
    );
    await pool.query("UPDATE users SET email_verified=true WHERE id=$1", [id]);
    const signedIn = await migrated.auth.api.signInEmail({
      body: { email: "migrated@local.test", password },
    });
    assert.equal(signedIn.user.id, id);
    assert.match(
      (await migrated.store.one<{ password: string }>(
        "SELECT password FROM auth_accounts WHERE user_id=?",
        id,
      ))!.password,
      /^scrypt\$/,
    );
    assert.equal(
      (await pool.query("SELECT to_regclass('sessions') AS name")).rows[0].name,
      null,
    );
  } finally {
    await pool.end();
    await isolated.cleanup(migrated?.store);
    rmSync(localDirectory, { recursive: true, force: true });
  }
});

test("plugin invitations deliver email and grant membership only after verified acceptance", async () => {
  const address = "organization-admin@local.test";
  assert.equal(
    (
      await request("/auth/register", {
        email: address,
        name: "Administrator",
        password,
      })
    ).status,
    201,
  );
  const admin = await mailbox.signIn(base, address);
  const orgId = (await (await request("/me", undefined, admin)).json())
    .organization.id;
  for (const mode of ["expired", "canceled", "accepted"] as const) {
    const email = `invited-${mode}@local.test`;
    const invitation = await request("/invitations", { email }, admin);
    assert.equal(invitation.status, 201, await invitation.clone().text());
    const { id: invitationId } = await invitation.json();
    assert.ok(
      mailbox.messages.some(
        (message) =>
          message.kind === "invitation" &&
          message.to === email &&
          message.invitationId === invitationId,
      ),
    );
    assert.equal(
      (
        await request("/auth/register", {
          email,
          name: "Invitee",
          password,
          invite: invitationId,
        })
      ).status,
      201,
    );
    assert.equal(
      await runtime.store.one(
        "SELECT m.id FROM members m JOIN users u ON m.user_id=u.id WHERE u.email=? AND m.org_id=?",
        email,
        orgId,
      ),
      undefined,
    );
    const cookie = await mailbox.signIn(base, email);
    assert.equal((await request("/me", undefined, cookie)).status, 401);
    if (mode === "expired")
      await runtime.store.run(
        "UPDATE invites SET expires_at=now()-interval '1 second' WHERE id=?",
        invitationId,
      );
    if (mode === "canceled")
      assert.equal(
        (
          await request(
            "/auth/organization/cancel-invitation",
            { invitationId },
            admin,
          )
        ).status,
        200,
      );
    const accept = () =>
      request("/auth/organization/accept-invitation", { invitationId }, cookie);
    if (mode !== "accepted") {
      assert.equal((await accept()).status, 400);
      assert.equal((await request("/me", undefined, cookie)).status, 401);
      assert.equal(
        await runtime.store.one(
          "SELECT m.id FROM members m JOIN users u ON m.user_id=u.id WHERE u.email=? AND m.org_id=?",
          email,
          orgId,
        ),
        undefined,
      );
    } else {
      const write = runtime.store.authorization.write;
      const version = await runtime.store.one(
        "SELECT authz_version FROM orgs WHERE id=?",
        orgId,
      );
      try {
        runtime.store.authorization.write = async () => {
          throw new Error("Unavailable");
        };
        assert.equal((await accept()).status, 500);
        assert.equal(
          (
            await runtime.store.one<{ status: string }>(
              "SELECT status FROM invites WHERE id=?",
              invitationId,
            )
          )?.status,
          "pending",
        );
        assert.deepEqual(
          await runtime.store.one(
            "SELECT authz_version FROM orgs WHERE id=?",
            orgId,
          ),
          version,
        );
        assert.equal(
          await runtime.store.one(
            "SELECT m.id FROM members m JOIN users u ON m.user_id=u.id WHERE u.email=? AND m.org_id=?",
            email,
            orgId,
          ),
          undefined,
        );
      } finally {
        runtime.store.authorization.write = write;
      }
      assert.equal((await accept()).status, 200);
      const me = await (await request("/me", undefined, cookie)).json();
      assert.equal(me.organization.id, orgId);
      assert.equal(me.role, "member");
      assert.equal((await accept()).status, 400);
      assert.equal(
        (
          await request(
            "/auth/organization/invite-member",
            {
              organizationId: orgId,
              email: "unauthorized@local.test",
              role: "admin",
            },
            cookie,
          )
        ).status,
        403,
      );
      const member = await runtime.store.one<{ id: string }>(
        "SELECT id FROM members WHERE org_id=? AND user_id=?",
        orgId,
        me.user.id,
      );
      try {
        runtime.store.authorization.write = async () => {
          throw new Error("Unavailable");
        };
        assert.equal(
          (
            await request(
              "/auth/organization/update-member-role",
              { organizationId: orgId, memberId: member!.id, role: "admin" },
              admin,
            )
          ).status,
          500,
        );
        assert.equal(
          (
            await runtime.store.one<{ role: string }>(
              "SELECT role FROM members WHERE id=?",
              member!.id,
            )
          )?.role,
          "member",
        );
      } finally {
        runtime.store.authorization.write = write;
      }
      assert.equal(
        (
          await request(
            "/auth/organization/remove-member",
            { organizationId: orgId, memberIdOrEmail: member!.id },
            admin,
          )
        ).status,
        200,
      );
      assert.equal((await request("/me", undefined, cookie)).status, 401);
    }
  }
  const administrator = await runtime.store.one<{ id: string }>(
    "SELECT id FROM members WHERE org_id=? AND role='admin'",
    orgId,
  );
  assert.equal(
    (
      await request(
        "/auth/organization/update-member-role",
        { organizationId: orgId, memberId: administrator!.id, role: "member" },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/auth/organization/update-member-role",
        { organizationId: orgId, memberId: administrator!.id, role: "owner" },
        admin,
      )
    ).status,
    400,
  );
  const check = runtime.store.authorization.check;
  try {
    runtime.store.authorization.check = async () => false;
    assert.equal(
      (
        await request(
          "/auth/organization/invite-member",
          { organizationId: orgId, email: "denied@local.test", role: "member" },
          admin,
        )
      ).status,
      403,
    );
    assert.equal(
      await runtime.store.one(
        "SELECT id FROM invites WHERE email=?",
        "denied@local.test",
      ),
      undefined,
    );
  } finally {
    runtime.store.authorization.check = check;
  }
});
