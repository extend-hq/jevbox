import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import {
  apiRateLimits,
  createApiRateLimiter,
  createAnonymousRateLimiter,
} from "../server/rate-limits";

async function withLimiter(
  limiter: ReturnType<typeof createApiRateLimiter>,
  run: (
    request: (user: string, method?: string) => Promise<Response>,
  ) => Promise<void>,
) {
  const app = express();
  app.use(limiter);
  app.all("/api/probe", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = (user: string, method = "GET") =>
    fetch(`http://127.0.0.1:${address.port}/api/probe`, {
      method,
      headers: { Authorization: user },
    });
  try {
    await run(request);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("API limits isolate users sharing an IP and separate reads from writes", async () => {
  await withLimiter(
    createApiRateLimiter((req) => req.header("Authorization")!, {
      read: 2,
      write: 1,
    }),
    async (request) => {
      assert.equal((await request("first")).status, 200);
      assert.equal((await request("first", "HEAD")).status, 200);
      const blockedRead = await request("first");
      assert.equal(blockedRead.status, 429);
      assert.equal(blockedRead.headers.get("ratelimit-limit"), "2");
      assert.ok(Number(blockedRead.headers.get("retry-after")) > 0);
      assert.equal((await request("second")).status, 200);
      assert.equal((await request("first", "POST")).status, 200);
      assert.equal((await request("first", "DELETE")).status, 429);
      assert.equal((await request("second", "POST")).status, 200);
    },
  );
});

test("API sanity ceilings allow ordinary request bursts above the old limit", async () => {
  await withLimiter(
    createApiRateLimiter((req) => req.header("Authorization")!, {
      read: 3000,
      write: 600,
    }),
    async (request) => {
      for (let index = 0; index < 200; index++) {
        const response = await request("first");
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("ratelimit-limit"), "3000");
        await response.arrayBuffer();
      }
      const response = await request("first", "POST");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("ratelimit-limit"), "600");
    },
  );
});

test("anonymous requests retain a shared IP ceiling", async () => {
  await withLimiter(createAnonymousRateLimiter(), async (request) => {
    for (let index = 0; index < 180; index++) {
      const response = await request(index % 2 ? "first" : "second");
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    assert.equal((await request("third")).status, 429);
  });
});

test("API ceilings are configurable and reject invalid limits", () => {
  const previousRead = process.env.API_READ_LIMIT_PER_MINUTE;
  const previousWrite = process.env.API_WRITE_LIMIT_PER_MINUTE;
  try {
    delete process.env.API_READ_LIMIT_PER_MINUTE;
    delete process.env.API_WRITE_LIMIT_PER_MINUTE;
    assert.deepEqual(apiRateLimits(), { read: 3000, write: 600 });
    process.env.API_READ_LIMIT_PER_MINUTE = "4500";
    process.env.API_WRITE_LIMIT_PER_MINUTE = "900";
    assert.deepEqual(apiRateLimits(), { read: 4500, write: 900 });
    process.env.API_WRITE_LIMIT_PER_MINUTE = "0";
    assert.throws(apiRateLimits);
  } finally {
    if (previousRead === undefined)
      delete process.env.API_READ_LIMIT_PER_MINUTE;
    else process.env.API_READ_LIMIT_PER_MINUTE = previousRead;
    if (previousWrite === undefined)
      delete process.env.API_WRITE_LIMIT_PER_MINUTE;
    else process.env.API_WRITE_LIMIT_PER_MINUTE = previousWrite;
  }
});
