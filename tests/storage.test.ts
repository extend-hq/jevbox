import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { createApp } from "../server/app";
import {
  createObjectStorage,
  createFileStorage,
  storageFailureDetails,
} from "../server/object-storage";
import { createProviders } from "../server/providers";
import { queues } from "../server/jobs";
import { testDatabase } from "./database";
import { authMailbox } from "./auth-mailbox";
import { runJobs } from "./jobs";
import type { Resource } from "../server/db";

const origin = "http://localhost:4310";
const mailbox = authMailbox(origin);
const directory = mkdtempSync(join(tmpdir(), "jevbox-storage-"));
const objects = new Map<string, Buffer>();
const calls: { method: string; path: string; signed: boolean }[] = [];
const envKeys = [
  "FILE_STORAGE",
  "S3_BUCKET",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_PREFIX",
];
const previous = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);
let unavailable = false;
let failPut = false;
let failDelete = false;
let runtime: Awaited<ReturnType<typeof createApp>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let server: ReturnType<typeof runtime.app.listen>;
let base: string, owner: string, outsider: string;
let documentId: string;
const content = Buffer.from("Private original stored outside PostgreSQL.");
const s3 = createServer(async (req, res) => {
  const path = new URL(req.url!, "http://localhost").pathname;
  calls.push({
    method: req.method!,
    path,
    signed: req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ") ?? false,
  });
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (
    unavailable ||
    (failPut && req.method === "PUT") ||
    (failDelete && req.method === "DELETE")
  ) {
    res
      .writeHead(503, { "Content-Type": "application/xml" })
      .end("<Error><Code>ServiceUnavailable</Code></Error>");
    return;
  }
  if (req.method === "HEAD") {
    res.writeHead(200).end();
    return;
  }
  if (req.method === "PUT") {
    objects.set(path, Buffer.concat(chunks));
    res.writeHead(200, { ETag: '"stored"' }).end();
    return;
  }
  if (req.method === "DELETE") {
    objects.delete(path);
    res.writeHead(204).end();
    return;
  }
  const body = objects.get(path);
  if (!body) {
    res
      .writeHead(404, { "Content-Type": "application/xml" })
      .end("<Error><Code>NoSuchKey</Code></Error>");
    return;
  }
  res
    .writeHead(200, {
      "Content-Length": body.length,
      "Content-Type": "application/octet-stream",
    })
    .end(body);
});

async function request(
  path: string,
  cookie = owner,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      "X-Jevbox-Request": "1",
      Cookie: cookie,
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
}
async function signup(email: string) {
  const response = await request("/api/auth/sign-up/email", "", "POST", {
    email,
    name: "Account",
    organization: "Workspace",
    password: "a-secure-password-123!",
  });
  assert.equal(response.status, 200, await response.text());
  return mailbox.signIn(base, email);
}
async function upload(body: Buffer, filename = "Document.txt") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(body)]), filename);
  return request("/api/documents", owner, "POST", form);
}
async function location(id: string, kind = "document") {
  const row = await runtime.store.one<{ bucket: string; object_key: string }>(
    "SELECT bucket,object_key FROM storage_objects WHERE resource_id=? AND kind=?",
    id,
    kind,
  );
  assert.ok(row);
  return `/${row.bucket}/${row.object_key}`;
}

before(async () => {
  s3.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => s3.once("listening", resolve));
  const address = s3.address();
  assert.ok(address && typeof address !== "string");
  Object.assign(process.env, {
    FILE_STORAGE: "s3",
    S3_BUCKET: "private-storage",
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "test-access",
    AWS_SECRET_ACCESS_KEY: "test-secret",
    S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
    S3_FORCE_PATH_STYLE: "true",
    S3_PREFIX: "test",
  });
  delete process.env.AWS_SESSION_TOKEN;
  database = await testDatabase();
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
  const appAddress = server.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  base = `http://127.0.0.1:${appAddress.port}`;
  owner = await signup("storage-owner@local.test");
  outsider = await signup("storage-outsider@local.test");
});
after(async () => {
  await runtime?.close();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await database?.cleanup();
  await new Promise<void>((resolve) => s3.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

test("S3 configuration requires complete settings and permits IAM credentials", () => {
  assert.throws(() => createObjectStorage({ FILE_STORAGE: "s3" }), /S3_BUCKET/);
  assert.throws(
    () =>
      createObjectStorage({
        FILE_STORAGE: "s3",
        S3_BUCKET: "bucket",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "partial",
      }),
    /both AWS/,
  );
  assert.throws(
    () =>
      createObjectStorage({
        FILE_STORAGE: "s3",
        S3_BUCKET: "bucket",
        AWS_REGION: "us-east-1",
        S3_FORCE_PATH_STYLE: "yes",
      }),
    /true or false/,
  );
  const roleStorage = createObjectStorage({
    FILE_STORAGE: "s3",
    S3_BUCKET: "bucket",
    AWS_REGION: "us-east-1",
  });
  assert.ok(roleStorage);
  roleStorage.close();
});

test("storage diagnostics retain AWS status and region without raw credentials or URLs", () => {
  const details = storageFailureDetails("HeadBucket", {
    name: "Forbidden",
    message: "secret-access-key signed-url",
    stack: "secret-stack",
    credentials: { secretAccessKey: "secret-access-key" },
    $metadata: { httpStatusCode: 403, requestId: "request-id" },
    $response: {
      headers: {
        "x-amz-bucket-region": "us-east-2",
        authorization: "secret-access-key",
      },
      body: "secret-response",
    },
  });
  assert.deepEqual(details, {
    operation: "HeadBucket",
    code: "Forbidden",
    status: 403,
    bucketRegion: "us-east-2",
    requestId: "request-id",
  });
  assert.doesNotMatch(JSON.stringify(details), /secret|signed-url/);
  assert.deepEqual(
    storageFailureDetails("HeadBucket", {
      name: "https://signed-url",
      $metadata: { requestId: "https://signed-url" },
    }),
    { operation: "HeadBucket", code: "UnknownError" },
  );
});

test("a web-only process stays alive during an S3 outage and readiness fails closed", async () => {
  unavailable = true;
  let web: Awaited<ReturnType<typeof createApp>> | undefined;
  let listener: ReturnType<typeof runtime.app.listen> | undefined;
  try {
    const before = calls.length;
    web = await createApp({
      directory,
      databaseUrl: database.url,
      origin,
      workers: [],
      rateLimits: false,
      sendAuthEmail: mailbox.sendAuthEmail,
    });
    assert.equal(calls.length, before);
    listener = web.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener!.once("listening", resolve));
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(
      (await fetch(`http://127.0.0.1:${address.port}/health/live`)).status,
      200,
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${address.port}/health/ready`)).status,
      503,
    );
  } finally {
    unavailable = false;
    if (listener)
      await new Promise<void>((resolve) => listener!.close(() => resolve()));
    await web?.close();
  }
});

test("uploads use signed S3 requests and downloads retain ranges and authorization", async () => {
  const response = await upload(content);
  assert.equal(response.status, 201, await response.clone().text());
  documentId = (await response.json()).id;
  assert.deepEqual(objects.get(await location(documentId)), content);
  assert.equal(
    (
      await runtime.store.one<{ body: Buffer | null }>(
        "SELECT body FROM blobs WHERE resource_id=?",
        documentId,
      )
    )?.body,
    null,
  );
  const downloaded = await request(`/api/documents/${documentId}/content`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), content);
  const range = await request(
    `/api/documents/${documentId}/content`,
    owner,
    "GET",
    undefined,
    { Range: "bytes=2-8" },
  );
  assert.equal(range.status, 206);
  assert.deepEqual(
    Buffer.from(await range.arrayBuffer()),
    content.subarray(2, 9),
  );
  const reads = calls.length;
  assert.equal(
    (await request(`/api/documents/${documentId}/content`, outsider)).status,
    404,
  );
  assert.equal(calls.length, reads);
  assert.ok(calls.every((call) => call.signed));
  const resource = await runtime.store.one<Resource>(
    "SELECT * FROM resources WHERE id=?",
    documentId,
  );
  assert.ok(resource);
  assert.ok(await createProviders(runtime.store).processDocument(resource));
  const zip = await request("/api/resources/download", owner, "POST", {
    ids: [documentId],
  });
  assert.equal(zip.status, 200);
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.equal(strFromU8(entries["Document.txt"]), content.toString());
});

test("thumbnails and public links read S3 and link revocation remains immediate", async () => {
  await runJobs(runtime, [queues.thumbnail]);
  const thumbnailPath = await location(documentId, "thumbnail");
  assert.ok(objects.get(thumbnailPath)?.length);
  assert.equal(
    (
      await runtime.store.one<{ body: Buffer | null }>(
        "SELECT body FROM thumbnails WHERE resource_id=?",
        documentId,
      )
    )?.body,
    null,
  );
  assert.equal(
    (await request(`/api/documents/${documentId}/thumbnail`)).status,
    200,
  );
  const shared = await request(
    `/api/resources/${documentId}/access`,
    owner,
    "PUT",
    { access: "link", grants: [] },
  );
  assert.equal(shared.status, 200);
  const token = new URL((await shared.json()).shareUrl).pathname
    .split("/")
    .pop();
  const path = `/api/shared/${token}/resources/${documentId}`;
  assert.equal((await request(`${path}/content`, "")).status, 200);
  assert.equal((await request(`${path}/thumbnail`, "")).status, 200);
  assert.equal(
    (
      await request(`/api/resources/${documentId}/access`, owner, "PUT", {
        access: "restricted",
        grants: [],
      })
    ).status,
    200,
  );
  const reads = calls.length;
  assert.equal((await request(`${path}/content`, "")).status, 404);
  assert.equal(calls.length, reads);
});

test("storage outages and corruption fail closed without exposing storage details", async () => {
  unavailable = true;
  try {
    assert.equal((await request("/health/ready")).status, 503);
    const response = await request(`/api/documents/${documentId}/content`);
    assert.equal(response.status, 503);
    assert.doesNotMatch(
      await response.text(),
      /test-secret|private-storage|test-access/,
    );
  } finally {
    unavailable = false;
  }
  const path = await location(documentId);
  objects.set(path, Buffer.from("corrupt"));
  try {
    assert.equal(
      (await request(`/api/documents/${documentId}/content`)).status,
      503,
    );
  } finally {
    objects.set(path, content);
  }
});

test("legacy migration verifies S3 copies and preserves database bytes on failure", async () => {
  const original = await runtime.store.one<Resource>(
    "SELECT * FROM resources WHERE id=?",
    documentId,
  );
  assert.ok(original);
  const id = randomUUID();
  await runtime.store.run(
    "INSERT INTO resources(id,org_id,owner_id,kind,name,mime,status,created) VALUES(?,?,?,'document','Legacy.txt','text/plain','stored',?)",
    id,
    original.org_id,
    original.owner_id,
    new Date().toISOString(),
  );
  await runtime.store.run("INSERT INTO blobs VALUES(?,?)", id, content);
  assert.deepEqual(
    (await runtime.store.files.read("document", id))?.body,
    content,
  );
  failPut = true;
  try {
    await assert.rejects(
      runtime.store.files.migrateBatch(),
      /storage is unavailable/,
    );
  } finally {
    failPut = false;
  }
  assert.deepEqual(
    (
      await runtime.store.one<{ body: Buffer }>(
        "SELECT body FROM blobs WHERE resource_id=?",
        id,
      )
    )?.body,
    content,
  );
  assert.equal(await runtime.store.files.migrateBatch(), 1);
  assert.equal(await runtime.store.files.migrateBatch(), 0);
  assert.equal(
    (
      await runtime.store.one<{ body: Buffer | null }>(
        "SELECT body FROM blobs WHERE resource_id=?",
        id,
      )
    )?.body,
    null,
  );
  assert.deepEqual(objects.get(await location(id)), content);
  const fallback = createFileStorage({
    ...runtime.store,
    reserve: async () => {
      throw new Error("S3 is disabled");
    },
  });
  await assert.rejects(
    fallback.read("document", id),
    /S3 storage must be configured/,
  );
});

test("rollbacks and recursive deletion detach objects for retryable cleanup", async () => {
  const before = objects.size;
  await assert.rejects(
    runtime.store.transaction(async () => {
      await runtime.store.files.write(
        "document",
        documentId,
        Buffer.from("uncommitted"),
        "text/plain",
      );
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(objects.size, before + 1);
  assert.deepEqual(
    (await runtime.store.files.read("document", documentId))?.body,
    content,
  );
  const path = await location(documentId);
  const thumbPath = await location(documentId, "thumbnail");
  const folder = await request("/api/folders", owner, "POST", {
    name: "Folder",
    parentId: null,
  });
  assert.equal(folder.status, 201);
  const folderId = (await folder.json()).id;
  assert.equal(
    (
      await request(`/api/resources/${documentId}/move`, owner, "POST", {
        parentId: folderId,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/resources/${folderId}`, owner, "DELETE")).status,
    200,
  );
  assert.equal(
    (await request(`/api/documents/${documentId}/content`)).status,
    404,
  );
  await runtime.store.run(
    "UPDATE storage_objects SET created=now() - interval '2 hours' WHERE resource_id IS NULL",
  );
  failDelete = true;
  try {
    await assert.rejects(
      runtime.store.files.cleanup(),
      /storage is unavailable/,
    );
  } finally {
    failDelete = false;
  }
  assert.ok(objects.has(path));
  assert.ok(
    (
      await runtime.store.all(
        "SELECT object_key FROM storage_objects WHERE resource_id IS NULL",
      )
    ).length,
  );
  while (
    (
      await runtime.store.all(
        "SELECT object_key FROM storage_objects WHERE resource_id IS NULL",
      )
    ).length
  )
    await runtime.store.files.cleanup();
  assert.ok(!objects.has(path));
  assert.ok(!objects.has(thumbPath));
  assert.equal(objects.size, 1);
});
