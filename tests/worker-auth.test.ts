import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkers } from "../server/workers";
import type { Store } from "../server/db";

test("standalone production workers validate authentication configuration before accepting jobs", () => {
  const environment = process.env.NODE_ENV,
    secret = process.env.BETTER_AUTH_SECRET;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.BETTER_AUTH_SECRET;
    assert.throws(
      () => createWorkers({} as Store, { origin: "https://app.test" }),
      /BETTER_AUTH_SECRET is required in production/,
    );
  } finally {
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
    if (secret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = secret;
  }
});
