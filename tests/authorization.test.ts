import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthorization,
  type PermissionCheck,
  type Relationship,
} from "../server/authorization";
import { HttpError } from "../server/errors";

test("bulk permission checks use bounded requests and preserve denials", async () => {
  const original = globalThis.fetch;
  const batches: number[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "http://permissions.test/v1/permissions/checkbulk",
    );
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.consistency, { fullyConsistent: true });
    batches.push(body.items.length);
    return Response.json({
      pairs: body.items.map((request: { resource: { objectId: string } }) => ({
        request,
        item: {
          permissionship: request.resource.objectId.endsWith("/denied")
            ? "PERMISSIONSHIP_NO_PERMISSION"
            : request.resource.objectId.endsWith("/conditional")
              ? "PERMISSIONSHIP_CONDITIONAL_PERMISSION"
              : "PERMISSIONSHIP_HAS_PERMISSION",
        },
      })),
    });
  };
  try {
    const authorization = createAuthorization(
      "http://permissions.test",
      "secret",
    );
    const ids = [
      ...Array.from({ length: 9999 }, (_, i) => `resource-${i}`),
      "denied",
      "conditional",
    ];
    const result = await authorization.checkBulk(
      "version",
      "resource",
      ids,
      "share",
      "user",
    );
    assert.deepEqual(batches, [10000, 1]);
    assert.deepEqual(result, [...Array(9999).fill(true), false, false]);
    assert.deepEqual(
      await authorization.checkBulk("version", "resource", [], "share", "user"),
      [],
    );
    assert.deepEqual(batches, [10000, 1]);
  } finally {
    globalThis.fetch = original;
  }
});

test("bulk checks group by opaque token, deduplicate, and restore interleaved result order", async () => {
  const original = globalThis.fetch;
  const calls: { consistency: unknown; ids: string[] }[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({
      consistency: body.consistency,
      ids: body.items.map((item: any) => item.resource.objectId),
    });
    return Response.json({
      pairs: body.items.map((request: any) => ({
        request,
        item: {
          permissionship: request.resource.objectId.endsWith("/denied")
            ? "PERMISSIONSHIP_NO_PERMISSION"
            : "PERMISSIONSHIP_HAS_PERMISSION",
        },
      })),
    });
  };
  try {
    const check = (id: string, zedToken?: string | null): PermissionCheck => ({
      kind: "resource",
      id,
      permission: "read",
      zedToken,
    });
    const authorization = createAuthorization(
      "http://permissions.test",
      "secret",
    );
    assert.deepEqual(
      await authorization.checkMany(
        "version",
        [
          check("first", "opaque-z"),
          check("denied", "opaque-a"),
          check("second", "opaque-z"),
          check("first", "opaque-z"),
          check("third"),
          check("fourth", null),
          check("denied", "opaque-z"),
        ],
        "user",
        "user",
        "opaque-default",
      ),
      [true, false, true, true, true, true, false],
    );
    assert.deepEqual(calls, [
      {
        consistency: { atLeastAsFresh: { token: "opaque-z" } },
        ids: ["version/first", "version/second", "version/denied"],
      },
      {
        consistency: { atLeastAsFresh: { token: "opaque-a" } },
        ids: ["version/denied"],
      },
      {
        consistency: { atLeastAsFresh: { token: "opaque-default" } },
        ids: ["version/third"],
      },
      { consistency: { fullyConsistent: true }, ids: ["version/fourth"] },
    ]);
    calls.length = 0;
    await authorization.checkBulk(
      "version",
      "resource",
      ["first", "first"],
      "read",
      "user",
      "user",
      "opaque-z",
    );
    assert.deepEqual(calls, [
      {
        consistency: { atLeastAsFresh: { token: "opaque-z" } },
        ids: ["version/first"],
      },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("single checks use the supplied token and token errors fail closed without weaker retries", async () => {
  const original = globalThis.fetch;
  const authorization = createAuthorization(
    "http://permissions.test",
    "secret",
  );
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)).consistency, {
      atLeastAsFresh: { token: "opaque" },
    });
    return Response.json({ permissionship: "PERMISSIONSHIP_HAS_PERMISSION" });
  };
  try {
    assert.equal(
      await authorization.check(
        "version",
        "resource",
        "id",
        "read",
        "user",
        "user",
        "opaque",
      ),
      true,
    );
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ code: 3 }, { status: 400 });
    };
    await assert.rejects(
      authorization.checkBulk(
        "version",
        "resource",
        ["id"],
        "read",
        "user",
        "user",
        "opaque",
      ),
      HttpError,
    );
    assert.equal(calls, 2);
    await assert.rejects(
      authorization.checkBulk(
        "version",
        "resource",
        ["id"],
        "read",
        "user",
        "user",
        "",
      ),
      HttpError,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("relationship publication returns the final chunk token and rejects missing write tokens", async () => {
  const original = globalThis.fetch;
  const authorization = createAuthorization(
    "http://permissions.test",
    "secret",
  );
  const relationship: Relationship = {
    resource: { objectType: "jevbox/resource", objectId: "version/resource" },
    relation: "owner",
    subject: { object: { objectType: "jevbox/user", objectId: "user" } },
  };
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.updates.length <= 500);
    return Response.json({ writtenAt: { token: `write-${++calls}` } });
  };
  try {
    assert.equal(
      await authorization.write(Array(501).fill(relationship)),
      "write-2",
    );
    assert.equal(calls, 2);
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "http://permissions.test/v1/schema/read");
      return Response.json({ readAt: { token: "empty-snapshot" } });
    };
    assert.equal(await authorization.write([]), "empty-snapshot");
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(authorization.write([relationship]), HttpError);
    await assert.rejects(authorization.write([]), HttpError);
  } finally {
    globalThis.fetch = original;
  }
});

test("bulk permission checks fail closed on incomplete, mismatched or errored responses", async () => {
  const original = globalThis.fetch;
  const authorization = createAuthorization(
    "http://permissions.test",
    "secret",
  );
  try {
    for (const mode of ["missing", "mismatched", "error", "unavailable"]) {
      globalThis.fetch = async (_input, init) => {
        const request = JSON.parse(String(init?.body)).items[0];
        if (mode === "unavailable") return Response.json({}, { status: 503 });
        if (mode === "missing") return Response.json({ pairs: [] });
        return Response.json({
          pairs: [
            {
              request:
                mode === "mismatched"
                  ? {
                      ...request,
                      resource: {
                        ...request.resource,
                        objectId: "version/other",
                      },
                    }
                  : request,
              ...(mode === "error"
                ? { error: { code: 13 } }
                : {
                    item: { permissionship: "PERMISSIONSHIP_HAS_PERMISSION" },
                  }),
            },
          ],
        });
      };
      await assert.rejects(
        authorization.checkBulk(
          "version",
          "resource",
          ["resource"],
          "share",
          "user",
        ),
        (error: unknown) => error instanceof HttpError && error.status === 503,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("mixed bulk checks combine resource actions and kinds in one request", async () => {
  const original = globalThis.fetch;
  const checks: PermissionCheck[] = [
    { kind: "resource", id: "resource", permission: "read" },
    { kind: "resource", id: "resource", permission: "write" },
    { kind: "resource", id: "resource", permission: "share" },
    { kind: "chat", id: "conversation", permission: "read" },
  ];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.consistency, { fullyConsistent: true });
    assert.deepEqual(
      body.items.map((item: any) => [
        item.resource.objectType,
        item.resource.objectId,
        item.permission,
      ]),
      checks.map(({ kind, id, permission }) => [
        `jevbox/${kind}`,
        `version/${id}`,
        permission,
      ]),
    );
    return Response.json({
      pairs: body.items.map((request: any) => ({
        request,
        item: {
          permissionship:
            request.permission === "write"
              ? "PERMISSIONSHIP_NO_PERMISSION"
              : "PERMISSIONSHIP_HAS_PERMISSION",
        },
      })),
    });
  };
  try {
    assert.deepEqual(
      await createAuthorization("http://permissions.test", "secret").checkMany(
        "version",
        checks,
        "user",
      ),
      [true, false, true, true],
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
