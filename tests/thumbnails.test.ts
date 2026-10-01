import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
import { createApp } from "../server/app";
import { createThumbnailJobs, enqueueThumbnail } from "../server/thumbnails";
import { queues } from "../server/jobs";
import type { BackgroundJob } from "../server/jobs";
import { randomUUID } from "node:crypto";
import { fileMime } from "../shared/file-types";
import { testDatabase } from "./database";
import { authMailbox } from "./auth-mailbox";
import { runJobs, waitForJobs } from "./jobs";

let runtime: Awaited<ReturnType<typeof createApp>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let generator: ReturnType<typeof createThumbnailJobs>;
let server: ReturnType<typeof runtime.app.listen>;
let directory: string;
let base: string;
let owner: string;
let outsider: string;
let image: Buffer;
const origin = "http://localhost:4310";
const mailbox = authMailbox(origin);
async function request(path: string, cookie = owner, body?: unknown) {
  return fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "X-Jevbox-Request": "1",
      Cookie: cookie,
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
}
async function signup(email: string) {
  const response = await request("/auth/sign-up/email", "", {
    email,
    name: "Account",
    organization: "Workspace",
    password: "a-secure-password-123!",
  });
  assert.equal(response.status, 200);
  await waitForJobs(runtime, [queues.email]);
  return mailbox.signIn(base, email, "a-secure-password-123!");
}
async function upload(body = image, name = "Image.png") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(body)]), name);
  const response = await request("/documents", owner, form);
  assert.equal(response.status, 201);
  return (await response.json()).id as string;
}
before(async () => {
  database = await testDatabase();
  directory = mkdtempSync(join(tmpdir(), "jevbox-thumbnails-"));
  runtime = await createApp({
    directory,
    databaseUrl: database.url,
    origin,
    workers: [queues.email],
    rateLimits: false,
    sendAuthEmail: mailbox.sendAuthEmail,
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  owner = await signup("thumbnail-owner@local.test");
  outsider = await signup("thumbnail-outsider@local.test");
  generator = createThumbnailJobs(runtime.store);
  image = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: "#538fb5" },
  })
    .png()
    .toBuffer();
  await runtime.store.jobs.boss.updateQueue(queues.thumbnail, {
    retryLimit: 0,
  });
});
after(async () => {
  await generator?.close();
  await runtime?.close();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await database?.cleanup();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

for (const ext of [
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "png",
  "svg",
  "json",
  "csv",
  "zip",
]) {
  test(
    `generates a bounded content thumbnail for ${ext}`,
    { timeout: 90_000 },
    async () => {
      let source: Buffer;
      if (["docx", "pptx", "xlsx"].includes(ext))
        source = readFileSync(
          new URL(`./fixtures/Workspace.${ext}`, import.meta.url),
        );
      else if (ext === "pdf") {
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const page = pdf.addPage([612, 792]);
        page.drawText("Document preview", { x: 50, y: 700, size: 32, font });
        page.drawRectangle({ x: 50, y: 350, width: 400, height: 200 });
        source = Buffer.from(await pdf.save());
      } else if (ext === "png") source = image;
      else if (ext === "svg")
        source = Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="1600" height="800" fill="#538fb5"/></svg>',
        );
      else if (ext === "zip")
        source = Buffer.from(
          zipSync({
            "readme.md": strToU8("# Guide"),
            "data.json": strToU8('{"ready":true}'),
          }),
        );
      else if (ext === "csv")
        source = Buffer.from("Item,Status\nAlpha,Ready\nBeta,Pending\n");
      else source = Buffer.from('{"workspace":{"ready":true},"items":[1,2,3]}');
      const start = performance.now();
      const result = await generator.generate(
        source,
        `Document.${ext}`,
        fileMime(`Document.${ext}`),
        AbortSignal.timeout(75_000),
      );
      assert.ok(result.width > 0 && result.width <= 256);
      assert.ok(result.height > 0 && result.height <= 256);
      assert.ok(result.pageCount >= 1);
      assert.ok(result.body.length < 128 * 1024);
      assert.equal((await sharp(result.body).metadata()).format, "webp");
      if (["pdf", "docx", "pptx", "xlsx", "json", "csv", "zip"].includes(ext)) {
        const stats = await sharp(result.body).stats();
        assert.ok(
          stats.channels.some((channel) => channel.stdev > 4),
          "Preview must contain visible content",
        );
      }
      mkdirSync("output/playwright/thumbnails", { recursive: true });
      writeFileSync(`output/playwright/thumbnails/${ext}.webp`, result.body);
      console.log(
        JSON.stringify({
          type: ext,
          originalBytes: source.length,
          thumbnailBytes: result.body.length,
          renderMs: Math.round(performance.now() - start),
        }),
      );
    },
  );
}

test("upload queues a thumbnail independently, persists it, and enforces access on every fetch", async () => {
  const id = await upload();
  const queued = await runtime.store.one<any>(
    "SELECT * FROM resources WHERE id=?",
    id,
  );
  assert.equal(queued.thumbnail_status, "queued");
  assert.equal((await request(`/documents/${id}/thumbnail`)).status, 204);
  assert.equal(
    (await request(`/documents/${id}/thumbnail`, outsider)).status,
    404,
  );
  await runJobs(runtime, [queues.thumbnail]);
  const response = await request(`/documents/${id}/thumbnail`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  const body = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(body).metadata();
  assert.ok(metadata.width! <= 256 && metadata.height! <= 256);
  const saved = await runtime.store.one<{ body: Buffer }>(
    "SELECT body FROM thumbnails WHERE resource_id=?",
    id,
  );
  assert.deepEqual(saved!.body, body);
  const resources = await (await request("/resources")).json();
  const resource = resources.find((item: any) => item.id === id);
  assert.match(
    resource.thumbnail.url,
    new RegExp(`/documents/${id}/thumbnail\\?v=`),
  );
  assert.equal(resource.thumbnail_job_id, undefined);
  const denied = await fetch(`${base}/api/documents/${id}/thumbnail`, {
    headers: {
      Cookie: outsider,
      "If-None-Match": response.headers.get("etag")!,
    },
  });
  assert.equal(denied.status, 404);
  const cached = await fetch(`${base}/api/documents/${id}/thumbnail`, {
    headers: { Cookie: owner, "If-None-Match": response.headers.get("etag")! },
  });
  assert.equal(cached.status, 304);
  await runtime.store.run("DELETE FROM resources WHERE id=?", id);
  assert.equal(
    await runtime.store.one(
      "SELECT resource_id FROM thumbnails WHERE resource_id=?",
      id,
    ),
    undefined,
  );
});

test("thumbnail admission rolls back with uploads and deduplicates ready previews", async () => {
  const id = await upload();
  const original = await runtime.store.one<any>(
    "SELECT thumbnail_job_id FROM resources WHERE id=?",
    id,
  );
  await enqueueThumbnail(runtime.store, id);
  assert.equal(
    (
      await runtime.store.one<any>(
        "SELECT thumbnail_job_id FROM resources WHERE id=?",
        id,
      )
    ).thumbnail_job_id,
    original.thumbnail_job_id,
  );
  const count = await runtime.store.one<any>(
    `SELECT count(*) FROM "${runtime.store.jobs.schema}".job WHERE name=?`,
    queues.thumbnail,
  );
  await assert.rejects(
    runtime.store.transaction(async () => {
      await runtime.store.run(
        "UPDATE resources SET thumbnail_status='pending' WHERE id=?",
        id,
      );
      await enqueueThumbnail(runtime.store, id);
      throw new Error("Rollback");
    }),
  );
  assert.equal(
    (
      await runtime.store.one<any>(
        `SELECT count(*) FROM "${runtime.store.jobs.schema}".job WHERE name=?`,
        queues.thumbnail,
      )
    ).count,
    count.count,
  );
  await runJobs(runtime, [queues.thumbnail]);
  await enqueueThumbnail(runtime.store, id);
  assert.equal(
    (
      await runtime.store.one<any>(
        "SELECT thumbnail_job_id FROM resources WHERE id=?",
        id,
      )
    ).thumbnail_job_id,
    original.thumbnail_job_id,
  );
});

test("unsupported binary content preserves the upload and thumbnail errors stay independent", async () => {
  const id = await upload(Buffer.from("opaque"), "Content.bin");
  assert.equal(
    (
      await runtime.store.one<any>(
        "SELECT thumbnail_status,status FROM resources WHERE id=?",
        id,
      )
    ).thumbnail_status,
    "unsupported",
  );
  const invalid = await upload(Buffer.from("invalid"), "Image.png");
  await runJobs(runtime, [queues.thumbnail]);
  const resource = await runtime.store.one<any>(
    "SELECT thumbnail_status,status FROM resources WHERE id=?",
    invalid,
  );
  assert.equal(resource.thumbnail_status, "failed");
  assert.equal(resource.status, "queued");
});

test("shared thumbnails are scoped and revocation also rejects conditional requests", async () => {
  const id = await upload();
  await runJobs(runtime, [queues.thumbnail]);
  const share = async (access: string) =>
    fetch(`${base}/api/resources/${id}/access`, {
      method: "PUT",
      headers: {
        Origin: origin,
        "X-Jevbox-Request": "1",
        Cookie: owner,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access, grants: [] }),
    });
  const shared = await share("link");
  assert.equal(shared.status, 200);
  const token = new URL((await shared.json()).shareUrl).pathname
    .split("/")
    .pop()!;
  const path = `/api/shared/${token}/resources/${id}/thumbnail`;
  const response = await fetch(base + path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  const metadata = await (await fetch(`${base}/api/shared/${token}`)).json();
  assert.match(
    metadata.thumbnail.url,
    new RegExp(`/shared/${token}/resources/${id}/thumbnail`),
  );
  assert.equal((await share("restricted")).status, 200);
  assert.equal(
    (
      await fetch(base + path, {
        headers: { "If-None-Match": response.headers.get("etag")! },
      })
    ).status,
    404,
  );
});

test("a replaced thumbnail attempt cannot publish stored image bytes", async () => {
  const id = await upload();
  const [fetched] = await runtime.store.jobs.boss.fetch(queues.thumbnail, {
    includeMetadata: true,
  });
  const job = {
    ...fetched,
    signal: new AbortController().signal,
  } as BackgroundJob;
  assert.equal(job.data.resourceId, id);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const worker = createThumbnailJobs(runtime.store);
  const generate = worker.generate;
  worker.generate = async (...args) => {
    entered();
    await held;
    return generate(...args);
  };
  const processing = worker.process(job);
  await started;
  await runtime.store.run(
    "UPDATE resources SET thumbnail_status='queued',thumbnail_job_id=? WHERE id=?",
    randomUUID(),
    id,
  );
  release();
  try {
    await assert.rejects(processing, /access changed/);
    assert.equal(
      await runtime.store.one(
        "SELECT resource_id FROM thumbnails WHERE resource_id=?",
        id,
      ),
      undefined,
    );
  } finally {
    await runtime.store.jobs.cancel(queues.thumbnail, job.id);
    await worker.close();
  }
});
