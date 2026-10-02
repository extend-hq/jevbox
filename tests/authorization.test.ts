import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthorization } from "../server/authorization";
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
      ...Array.from({ length: 499 }, (_, i) => `resource-${i}`),
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
    assert.deepEqual(batches, [500, 1]);
    assert.deepEqual(result, [...Array(499).fill(true), false, false]);
    assert.deepEqual(
      await authorization.checkBulk("version", "resource", [], "share", "user"),
      [],
    );
    assert.deepEqual(batches, [500, 1]);
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
