import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitHubStars } from "../server/github-stars";

test("concurrent star requests share a daily cache and retain the last count on failures", async () => {
  let time = 0;
  let requests = 0;
  let response = Response.json({ stargazers_count: 1234 });
  const stars = createGitHubStars(
    async () => {
      requests++;
      return response.clone();
    },
    () => time,
  );
  assert.deepEqual(
    await Promise.all([stars(), stars(), stars()]),
    [1234, 1234, 1234],
  );
  assert.equal(requests, 1);
  time += 86_399_999;
  assert.equal(await stars(), 1234);
  assert.equal(requests, 1);
  time++;
  response = new Response(null, { status: 503 });
  assert.equal(await stars(), 1234);
  assert.equal(await stars(), 1234);
  assert.equal(requests, 2);
  time += 900_000;
  response = Response.json({ stargazers_count: 1500 });
  assert.equal(await stars(), 1500);
  assert.equal(requests, 3);
});

test("unavailable or malformed star counts fall back without showing invented counts", async () => {
  for (const value of [undefined, -1, "42", 1.5]) {
    const stars = createGitHubStars(async () =>
      Response.json({ stargazers_count: value }),
    );
    assert.equal(await stars(), null);
  }
  const stars = createGitHubStars(async () => {
    throw new Error("Unavailable");
  });
  assert.equal(await stars(), null);
});
