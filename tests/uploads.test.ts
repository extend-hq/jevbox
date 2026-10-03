import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import { createUploads, decodeUpload, validateUpload } from "../server/uploads";
import { uploadLimits } from "../shared/uploads";
import { HttpError, type Store, type Resource } from "../server/db";
import { uploadAdmissionLimits } from "../server/upload-limits";

const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.status === code;

test("file uploads accept content without format validation and enforce the 250 MB boundary", async () => {
  for (const filename of [
    "document.pdf",
    "image.png",
    "image.bmp",
    "image.svg",
    "note.txt",
    "attachment.bin",
  ]) {
    assert.ok(await validateUpload(filename, Buffer.from([0xff, 0, 1])));
    assert.ok(await validateUpload(filename, Buffer.alloc(0)));
  }
  assert.equal(
    await validateUpload("attachment.bin", Buffer.from("binary")),
    "application/octet-stream",
  );
  assert.equal(
    await validateUpload(
      "note.txt",
      Buffer.allocUnsafe(uploadLimits.fileBytes),
    ),
    "text/plain",
  );
  await assert.rejects(
    validateUpload("note.txt", Buffer.allocUnsafe(uploadLimits.fileBytes + 1)),
    (error: unknown) =>
      status(413)(error) && (error as Error).message.includes("250 MB"),
  );
  await assert.rejects(validateUpload("../note.txt", Buffer.from("text")));
  await assert.rejects(validateUpload("note:stream.txt", Buffer.from("text")));
});

test("base64 uploads use the same file cap and accept files above the former inline limit", () => {
  for (const value of [
    "SGVsbG8",
    "SGVsbG8=\n",
    "data:text/plain;base64,SGk=",
    "SGk-",
    "Zh==",
  ])
    assert.throws(() => decodeUpload(value), status(400));
  assert.equal(decodeUpload("SGVsbG8K").toString(), "Hello\n");
  assert.deepEqual(decodeUpload(""), Buffer.alloc(0));
  const content = Buffer.alloc(3 * 1024 * 1024, 65);
  assert.deepEqual(decodeUpload(content.toString("base64")), content);
  assert.throws(
    () =>
      decodeUpload("A".repeat(4 * Math.ceil(uploadLimits.fileBytes / 3) + 4)),
    status(413),
  );
});

test("Office uploads defer content validation to document processing", async () => {
  for (const ext of ["docx", "xlsx", "pptx"]) {
    const filename = `document.${ext}`;
    const mime = await validateUpload(
      filename,
      readFileSync(new URL(`./fixtures/Workspace.${ext}`, import.meta.url)),
    );
    assert.ok(mime);
    assert.equal(
      await validateUpload(filename, Buffer.from("Unparsed document content")),
      mime,
    );
    assert.equal(await validateUpload(filename, Buffer.alloc(0)), mime);
    await assert.rejects(
      validateUpload(filename, Buffer.alloc(uploadLimits.fileBytes + 1)),
      status(413),
    );
  }
});

test("text that cannot index locally and unfamiliar file types are passed unchanged to Extend", async () => {
  const { createProviders } = await import("../server/providers");
  let body = Buffer.from([0xff, 0, 1]);
  const uploaded: Buffer[] = [];
  const store = {
    one: async () => ({ settings: JSON.stringify({ extendKey: "test-key" }) }),
    decrypt: (value: string) => value,
    files: { read: async () => ({ body }) },
    run: async () => {},
  } as unknown as Store;
  const providers = createProviders(store, async (input, init) => {
    if (String(input).endsWith("/files/upload")) {
      const file = (init?.body as FormData).get("file") as File;
      uploaded.push(Buffer.from(await file.arrayBuffer()));
      return Response.json({ id: "uploaded" });
    }
    if (String(input).endsWith("/parse_runs"))
      return Response.json({ id: "run" });
    return Response.json({
      status: "PROCESSED",
      output: { chunks: [{ content: "Parsed text" }] },
    });
  });
  for (const mime of [
    "text/plain",
    "application/octet-stream",
    "image/svg+xml",
  ]) {
    const parsed = await providers.processDocument({
      id: "document",
      org_id: "organization",
      name: "document",
      mime,
    } as Resource);
    assert.equal(parsed?.source, "extend");
    assert.equal(parsed?.markdown, "Parsed text");
    assert.deepEqual(uploaded.at(-1), body);
  }
  body = Buffer.alloc(3 * 1024 * 1024, 65);
  const parsed = await providers.processDocument({
    id: "document",
    org_id: "organization",
    mime: "text/plain",
  } as Resource);
  assert.equal(parsed?.source, "text");
  assert.equal(parsed?.markdown.length, body.length);
  assert.equal(uploaded.length, 3);
});

function request(length = "1", encoding?: string) {
  return {
    get: (name: string) => (name === "Content-Length" ? length : encoding),
    destroyed: false,
    destroy(this: { destroyed: boolean }) {
      this.destroyed = true;
    },
  } as unknown as Request;
}
function response() {
  const result = Object.assign(new EventEmitter(), {
    writableEnded: false,
    headersSent: false,
  });
  return Object.assign(result, {
    status(_code: number) {
      return result;
    },
    json(_body: unknown) {
      result.headersSent = true;
      result.writableEnded = true;
      result.emit("finish");
      return result;
    },
  }) as unknown as Response;
}

test("upload admission queues busy bodies and holds cancelled work until it exits", async () => {
  const uploads = createUploads({} as Store, {
    limits: { ...uploadAdmissionLimits(), active: 2, activePerUser: 1 },
  });
  const a = uploads.reserve(request(), response(), "user-a", 10);
  await a.ready;
  const same = uploads.reserve(request(), response(), "user-a", 10);
  let sameReady = false;
  void same.ready.then(() => {
    sameReady = true;
  });
  const res = response(),
    req = request();
  const b = uploads.reserve(req, res, "user-b", 10);
  await b.ready;
  b.retain();
  res.emit("close");
  assert.equal(b.signal.aborted, true);
  const c = uploads.reserve(request(), response(), "user-c", 10);
  let nextReady = false;
  void c.ready.then(() => {
    nextReady = true;
  });
  await Promise.resolve();
  assert.equal(sameReady, false);
  assert.equal(nextReady, false);
  b.release();
  await c.ready;
  assert.equal(nextReady, true);
  c.release();
  a.release();
  await same.ready;
  same.release();
  assert.throws(
    () => uploads.reserve(request("11"), response(), "user-a", 10),
    status(413),
  );
  assert.throws(
    () => uploads.reserve(request("1", "gzip"), response(), "user-a", 10),
    status(415),
  );
});

test("upload deadline cancels work without admitting replacement bodies before cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const uploads = createUploads({} as Store, {
    limits: { ...uploadAdmissionLimits(), activePerUser: 1 },
  });
  const req = request(),
    res = response();
  const lease = uploads.reserve(req, res, "user-a", 10);
  await lease.ready;
  lease.retain();
  t.mock.timers.tick(uploadLimits.receiveMs);
  assert.equal(lease.signal.aborted, true);
  assert.equal(req.destroyed, true);
  const next = uploads.reserve(request(), response(), "user-a", 10);
  let ready = false;
  void next.ready.then(() => {
    ready = true;
  });
  await Promise.resolve();
  assert.equal(ready, false);
  lease.release();
  await next.ready;
  next.release();
});

test("upload admission bounds waiting requests and returns retryable backpressure", async () => {
  const uploads = createUploads({} as Store, {
    limits: { ...uploadAdmissionLimits(), active: 1, waiting: 1, waitMs: 10 },
  });
  const first = uploads.reserve(request(), response(), "first", 10);
  await first.ready;
  const waiting = uploads.reserve(request(), response(), "second", 10);
  assert.throws(
    () => uploads.reserve(request(), response(), "third", 10),
    status(429),
  );
  await assert.rejects(waiting.ready, status(429));
  first.release();
  const next = uploads.reserve(request(), response(), "third", 10);
  await next.ready;
  next.release();
});

test("upload memory backpressure queues declared and chunked bodies and cancels disconnected waiters", async () => {
  const uploads = createUploads({} as Store, {
    limits: { ...uploadAdmissionLimits(), activeBytes: 10 },
  });
  const first = uploads.reserve(request("6"), response(), "first", 10);
  const second = uploads.reserve(request("5"), response(), "second", 10);
  let ready = false;
  void second.ready.then(() => {
    ready = true;
  });
  await Promise.resolve();
  assert.equal(ready, false);
  const small = uploads.reserve(request("4"), response(), "small", 10);
  await small.ready;
  const cancelledResponse = response();
  const cancelled = uploads.reserve(
    request(""),
    cancelledResponse,
    "cancelled",
    10,
  );
  cancelledResponse.emit("close");
  await assert.rejects(cancelled.ready, /Upload cancelled/);
  first.release();
  await second.ready;
  const chunked = uploads.reserve(request(""), response(), "chunked", 10);
  let chunkedReady = false;
  void chunked.ready.then(() => {
    chunkedReady = true;
  });
  small.release();
  await Promise.resolve();
  assert.equal(chunkedReady, false);
  second.release();
  await chunked.ready;
  chunked.release();
  const oversizedBudget = uploads.reserve(
    request("11"),
    response(),
    "large",
    20,
  );
  await oversizedBudget.ready;
  oversizedBudget.release();
});

test("text and parsed documents index beyond the former page, section, text, and block caps", async () => {
  const { buildIndex } = await import("../server/indexing");
  const text =
    "\n".repeat(50001) + "\f".repeat(1001) + "# Heading\n".repeat(5001);
  assert.ok(await validateUpload("note.txt", Buffer.from(text)));
  const pages = buildIndex(
    Array.from({ length: 10001 }, () => ({ content: "Page text" })),
    "extend",
  );
  assert.equal(pages.pages, 10001);
  const sections = buildIndex(
    [{ content: "# Heading\nText\n".repeat(5001) }],
    "text",
  );
  assert.equal(sections.nodes.length, 5001);
  const blocks = buildIndex(
    [
      {
        content: "Text",
        blocks: Array.from({ length: 10001 }, (_, i) => ({
          id: String(i),
          type: "text",
          content: "",
        })),
      },
    ],
    "extend",
  );
  assert.equal(blocks.blocks.length, 10001);
  const largeText = "x".repeat(4 * 1024 * 1024 + 1);
  assert.equal(
    buildIndex([{ content: largeText }], "extend").markdown,
    largeText,
  );
});

test("parser responses above the former 16 MiB cap are accepted for declared and streamed bodies", async () => {
  const { jsonRequest } = await import("../server/provider-http");
  const payload = JSON.stringify({ content: "x".repeat(16 * 1024 * 1024 + 1) });
  const bytes = Buffer.from(payload);
  for (const declared of [true, false]) {
    const result = await jsonRequest(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 1024));
              controller.enqueue(bytes.subarray(1024));
              controller.close();
            },
          }),
          {
            headers: declared ? { "Content-Length": String(bytes.length) } : {},
          },
        ),
      "https://provider.test",
      {},
    );
    assert.equal(result.content.length, 16 * 1024 * 1024 + 1);
  }
});

test("storage and document limits apply independently to all scopes", async () => {
  const { checkStoredDocumentQuota } = await import("../server/upload-quotas");
  const defaults = uploadAdmissionLimits();
  assert.equal(defaults.storedBytes.organization, 10 * 1000 ** 3);
  for (const scope of ["user", "organization", "deployment"] as const) {
    const store = {
      one: async () => ({ count: "1", size: "10" }),
    } as unknown as Store;
    await checkStoredDocumentQuota(store, "actor", "org", 1, 1, defaults);
    await assert.rejects(
      checkStoredDocumentQuota(store, "actor", "org", 1, 1, {
        ...defaults,
        documents: { ...defaults.documents, [scope]: 1 },
      }),
      /count quota/,
    );
    await assert.rejects(
      checkStoredDocumentQuota(store, "actor", "org", 1, 1, {
        ...defaults,
        storedBytes: { ...defaults.storedBytes, [scope]: 10 },
      }),
      /storage/,
    );
    await assert.rejects(
      checkStoredDocumentQuota(store, "actor", "org", 0, 1, {
        ...defaults,
        storedBytes: { ...defaults.storedBytes, [scope]: 10 },
      }),
      /storage/,
    );
  }
});
