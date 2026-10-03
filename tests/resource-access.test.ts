import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStore,
  resourcePermissionsBatch,
  type Actor,
  type Store,
  type PermissionCache,
} from "../server/db";
import { createResourceAccessReader } from "../server/resource-access";
import { retrieveDocuments } from "../server/retrieval";
import { buildIndex } from "../server/indexing";
import { testDatabase } from "./database";
import { choiceResponse, isScoreRequest, scoreResponse } from "./model-tools";

let database: Awaited<ReturnType<typeof testDatabase>>;
let store: Store;
const directory = mkdtempSync(join(tmpdir(), "jevbox-resource-access-"));
const actor: Actor = {
  userId: randomUUID(),
  orgId: randomUUID(),
  role: "admin",
  token: "test",
};
const ids = Array.from({ length: 128 }, () => randomUUID());

before(async () => {
  database = await testDatabase();
  store = await createStore(directory, database.url);
  const parsed = JSON.stringify(
    buildIndex([{ content: "# Overview\nRelevant evidence." }], "text"),
  );
  await store.transaction(async () => {
    await store.run(
      "INSERT INTO users(id,email,name,email_verified) VALUES(?,'access@local.test','Member',true)",
      actor.userId,
    );
    await store.run(
      "INSERT INTO orgs(id,name) VALUES(?,'Workspace')",
      actor.orgId,
    );
    await store.run(
      "INSERT INTO members(org_id,user_id,role) VALUES(?,?,'admin')",
      actor.orgId,
      actor.userId,
    );
    for (const id of ids)
      await store.run(
        "INSERT INTO resources(id,org_id,owner_id,kind,name,mime,status,parsed,created) VALUES(?,?,?,'document','Document','text/plain','ready',?,?)",
        id,
        actor.orgId,
        actor.userId,
        parsed,
        new Date().toISOString(),
      );
  });
});
after(async () => {
  await database?.cleanup(store);
  rmSync(directory, { recursive: true, force: true });
});

test("a stable 128-document search checks each resource once in one bulk call", async () => {
  const original = store.authorization.checkBulk;
  const snapshot = await store.one<{ authz_token: string }>(
    "SELECT authz_token FROM orgs WHERE id=?",
    actor.orgId,
  );
  assert.ok(snapshot?.authz_token);
  const batches: string[][] = [];
  store.authorization.checkBulk = async (...args) => {
    batches.push(args[2]);
    assert.equal(args[6], snapshot.authz_token);
    return original(...args);
  };
  try {
    const result = await retrieveDocuments(
      store,
      actor,
      "Relevant evidence",
      "test",
      async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        return isScoreRequest(body)
          ? scoreResponse(body, 3)
          : choiceResponse(body);
      },
    );
    assert.ok(result.results.length > 0);
    assert.equal(batches.length, 1);
    assert.deepEqual(new Set(batches[0]), new Set(ids));
  } finally {
    store.authorization.checkBulk = original;
  }
});

test("resource read, write, and share decisions use one mixed bulk call", async () => {
  const original = store.authorization.checkMany;
  let calls = 0;
  store.authorization.checkMany = async (...args) => {
    calls++;
    assert.equal(args[1].length, ids.length * 3);
    assert.ok(args[4]);
    return original(...args);
  };
  try {
    const allowed = await resourcePermissionsBatch(
      store,
      actor,
      ids.flatMap((id) =>
        (["read", "write", "share"] as const).map((action) => ({ id, action })),
      ),
    );
    assert.ok(allowed.every(Boolean));
    assert.equal(calls, 1);
  } finally {
    store.authorization.checkMany = original;
  }
});

test("individual checks inherit the stored snapshot token and token changes invalidate request caches", async () => {
  const snapshot = (await store.one<{
    authz_version: string;
    authz_token: string;
  }>("SELECT authz_version,authz_token FROM orgs WHERE id=?", actor.orgId))!;
  const original = store.authorization.check;
  const bulk = store.authorization.checkBulk;
  const cache: PermissionCache = { values: new Map() };
  const tokens: (string | null | undefined)[] = [];
  store.authorization.check = async (...args) => {
    assert.equal(args[6], snapshot.authz_token);
    return original(...args);
  };
  store.authorization.checkBulk = async (...args) => {
    tokens.push(args[6]);
    return bulk(...args);
  };
  try {
    assert.equal(
      await store.permission(actor, "organization", actor.orgId, "active_member"),
      true,
    );
    assert.deepEqual(
      await store.permissions(
        actor,
        "resource",
        [ids[0]],
        "read",
        "user",
        cache,
      ),
      [true],
    );
    await store.run("UPDATE orgs SET authz_token=NULL WHERE id=?", actor.orgId);
    assert.deepEqual(
      await store.permissions(
        actor,
        "resource",
        [ids[0]],
        "read",
        "user",
        cache,
      ),
      [true],
    );
    await store.run(
      "UPDATE orgs SET authz_token=? WHERE id=?",
      snapshot.authz_token,
      actor.orgId,
    );
    assert.deepEqual(
      await store.permissions(
        actor,
        "resource",
        [ids[0]],
        "read",
        "user",
        cache,
      ),
      [true],
    );
    assert.deepEqual(tokens, [
      snapshot.authz_token,
      null,
      snapshot.authz_token,
    ]);
  } finally {
    store.authorization.check = original;
    store.authorization.checkBulk = bulk;
    await store.run(
      "UPDATE orgs SET authz_token=? WHERE id=?",
      snapshot.authz_token,
      actor.orgId,
    );
  }
});

test("failed snapshot publication rolls back its token and permission changes together", async () => {
  const before = await store.one(
    "SELECT authz_version,authz_token FROM orgs WHERE id=?",
    actor.orgId,
  );
  const original = store.authorization.write;
  store.authorization.write = async (relationships) => {
    await original(relationships.slice(0, 50));
    throw new Error("Publication interrupted");
  };
  try {
    await assert.rejects(
      store.run(
        "UPDATE resources SET access='organization' WHERE id=?",
        ids[0],
      ),
      /Publication interrupted/,
    );
    assert.deepEqual(
      await store.one(
        "SELECT authz_version,authz_token FROM orgs WHERE id=?",
        actor.orgId,
      ),
      before,
    );
    assert.equal(
      (
        await store.one<{ access: string }>(
          "SELECT access FROM resources WHERE id=?",
          ids[0],
        )
      )?.access,
      "restricted",
    );
  } finally {
    store.authorization.write = original;
  }
});

test("a revocation during a bulk check retries with the new snapshot token", async () => {
  const before = (await store.one<{ authz_token: string }>(
    "SELECT authz_token FROM orgs WHERE id=?",
    actor.orgId,
  ))!.authz_token;
  const original = store.authorization.checkBulk;
  const tokens: (string | null | undefined)[] = [];
  store.authorization.checkBulk = async (...args) => {
    tokens.push(args[6]);
    const allowed = await original(...args);
    if (tokens.length === 1)
      await store.run(
        "DELETE FROM members WHERE org_id=? AND user_id=?",
        actor.orgId,
        actor.userId,
      );
    return allowed;
  };
  try {
    assert.deepEqual(
      await store.permissions(actor, "resource", [ids[0]], "read", "user", {
        values: new Map(),
      }),
      [false],
    );
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0], before);
    const current = (await store.one<{ authz_token: string }>(
      "SELECT authz_token FROM orgs WHERE id=?",
      actor.orgId,
    ))!.authz_token;
    assert.notEqual(current, before);
    assert.equal(tokens[1], current);
  } finally {
    store.authorization.checkBulk = original;
    await store.run(
      "INSERT INTO members(org_id,user_id,role) VALUES(?,?,'admin') ON CONFLICT (org_id,user_id) DO NOTHING",
      actor.orgId,
      actor.userId,
    );
  }
});

test("cached decisions stay scoped to action and subject and refresh after a permission version change", async () => {
  const original = store.authorization.checkBulk;
  const cache: PermissionCache = { values: new Map() };
  let calls = 0;
  store.authorization.checkBulk = async (...args) => {
    calls++;
    return original(...args);
  };
  try {
    assert.deepEqual(
      await store.permissions(
        actor,
        "resource",
        [ids[0], ids[0]],
        "read",
        "user",
        cache,
      ),
      [true, true],
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      await store.permissions(
        actor,
        "resource",
        [ids[0]],
        "read",
        "user",
        cache,
      ),
      [true],
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      await store.permissions(
        actor,
        "resource",
        [ids[0]],
        "write",
        "user",
        cache,
      ),
      [true],
    );
    assert.equal(calls, 2);
    assert.deepEqual(
      await store.permissions(
        { ...actor, userId: randomUUID() },
        "resource",
        [ids[0]],
        "read",
        "user",
        cache,
      ),
      [false],
    );
    assert.equal(calls, 3);
    const canRead = createResourceAccessReader(store, actor);
    assert.equal(await canRead(ids[0]), true);
    assert.equal(await canRead(ids[0]), true);
    assert.equal(calls, 4);
    await store.run(
      "DELETE FROM members WHERE org_id=? AND user_id=?",
      actor.orgId,
      actor.userId,
    );
    assert.equal(await canRead(ids[0]), false);
    assert.equal(calls, 5);
    assert.deepEqual(
      await store.permissions(
        actor,
        "resource",
        [ids[0]],
        "read",
        "user",
        cache,
      ),
      [false],
    );
    assert.equal(calls, 6);
    assert.equal(await canRead(randomUUID()), false);
    assert.equal(calls, 6);
  } finally {
    store.authorization.checkBulk = original;
  }
});
