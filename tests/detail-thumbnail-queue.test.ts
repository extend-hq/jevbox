import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDetailThumbnailQueue,
  detailThumbnailCandidates,
  smallThumbnailCandidates,
} from "../src/lib/detail-thumbnail-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  assert.ok(check(), "Expected asynchronous work to finish");
}

test("small previews continue past completed visible files and include every distant file", () => {
  const candidates = Array.from({ length: 100 }, (_, i) => ({
    path: String(i),
    visible: i < 40,
    focused: i === 90,
    distance: i,
  }));
  const firstBatch = new Set(candidates.slice(0, 40).map((item) => item.path));
  const remaining = smallThumbnailCandidates(
    candidates,
    firstBatch,
    new Set(["40"]),
  );
  assert.equal(remaining.length, 59);
  assert.equal(remaining[0], "90");
  assert.ok(remaining.includes("99"));
  assert.ok(!remaining.includes("40"));
  assert.deepEqual(
    smallThumbnailCandidates(
      candidates,
      new Set(candidates.map((item) => item.path)),
      new Set(),
    ),
    [],
  );
});

test("only visible focused or large thumbnails request detail, with focus first and a bounded window", () => {
  const candidate = (
    path: string,
    pixels: number,
    focused = false,
    visible = true,
  ) => ({ path, pixels, focused, visible, distance: 10 });
  assert.deepEqual(
    detailThumbnailCandidates([
      candidate("distant", 40),
      candidate("behind", 1200, true, false),
      candidate("large", 600),
      candidate("focus", 80, true),
      candidate("larger", 700),
      candidate("extra", 400),
    ]),
    ["focus", "larger", "large"],
  );
});

test("detail rendering waits for a stable target and does not render the superseded target", async () => {
  const calls: string[] = [];
  const queue = createDetailThumbnailQueue({
    delay: 15,
    load: async (path) => {
      calls.push(path);
      return path;
    },
    apply: () => {},
    dispose: () => {},
  });
  queue.update(["first"]);
  queue.update(["second"]);
  await until(() => calls.length === 1);
  assert.deepEqual(calls, ["second"]);
  queue.dispose();
});

test("rendering is serial and stale results are disposed without replacing the small preview", async () => {
  const first = deferred<string | null>();
  const calls: string[] = [];
  const applied: string[] = [];
  const disposed: string[] = [];
  let firstSignal: AbortSignal | undefined;
  const queue = createDetailThumbnailQueue({
    delay: 0,
    load: async (path, signal) => {
      calls.push(path);
      if (path === "first") {
        firstSignal = signal;
        return first.promise;
      }
      return path;
    },
    apply: (path, value) => {
      if (value) applied.push(path);
    },
    dispose: (value) => {
      disposed.push(value);
    },
  });
  queue.update(["first", "second"]);
  await until(() => calls.length === 1);
  queue.update(["second"]);
  assert.equal(firstSignal?.aborted, true);
  assert.deepEqual(calls, ["first"]);
  first.resolve("stale");
  await until(() => applied.length === 1);
  assert.deepEqual(calls, ["first", "second"]);
  assert.deepEqual(applied, ["second"]);
  assert.deepEqual(disposed, ["stale"]);
  queue.dispose();
});

test("recent detail is reused, distant covers downgrade, and eviction releases textures", async () => {
  const calls: string[] = [];
  const applied: [string, string | null][] = [];
  const disposed: string[] = [];
  const queue = createDetailThumbnailQueue({
    capacity: 2,
    delay: 0,
    load: async (path) => {
      calls.push(path);
      return path;
    },
    apply: (path, value) => {
      applied.push([path, value]);
    },
    dispose: (value) => {
      disposed.push(value);
    },
  });
  queue.update(["first"]);
  await until(() =>
    applied.some(([path, value]) => path === "first" && value !== null),
  );
  queue.update(["second"]);
  await until(() =>
    applied.some(([path, value]) => path === "second" && value !== null),
  );
  queue.update(["first"]);
  assert.deepEqual(calls, ["first", "second"]);
  assert.ok(
    applied.some(([path, value]) => path === "second" && value === null),
  );
  queue.update(["third"]);
  await until(() => disposed.length === 1);
  assert.deepEqual(disposed, ["second"]);
  queue.dispose();
  assert.deepEqual(new Set(disposed), new Set(["first", "second", "third"]));
});

test("failed detail keeps the existing cover and does not retry repeatedly while focused", async () => {
  let calls = 0;
  const queue = createDetailThumbnailQueue<string>({
    delay: 0,
    load: async () => {
      calls++;
      throw new Error("Unavailable");
    },
    apply: (_path, value) => assert.equal(value, null),
    dispose: () => {},
  });
  queue.update(["first"]);
  await until(() => calls === 1);
  queue.update(["first"]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  queue.update([]);
  queue.update(["first"]);
  await until(() => calls === 2);
  queue.dispose();
});

test("unmount cancels pending work and disposes a late result without applying it", async () => {
  const task = deferred<string | null>();
  const disposed: string[] = [];
  let signal: AbortSignal | undefined;
  const queue = createDetailThumbnailQueue({
    delay: 0,
    load: async (_path, nextSignal) => {
      signal = nextSignal;
      return task.promise;
    },
    apply: () => assert.fail("A closed queue must not apply textures"),
    dispose: (value) => {
      disposed.push(value);
    },
  });
  queue.update(["first"]);
  await until(() => Boolean(signal));
  queue.dispose();
  assert.equal(signal?.aborted, true);
  task.resolve("late");
  await until(() => disposed.length === 1);
  assert.deepEqual(disposed, ["late"]);
});
