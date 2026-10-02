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

test("upload admission bounds concurrent bodies and holds cancelled work until it exits", () => {
  const uploads = createUploads({} as Store, {
    limits: { ...uploadAdmissionLimits(), active: 2, activePerUser: 1 },
  });
  const a = uploads.reserve(request(), response(), "user-a", 10);
  assert.throws(
    () => uploads.reserve(request(), response(), "user-a", 10),
    status(429),
  );
  const res = response(),
    req = request();
  const b = uploads.reserve(req, res, "user-b", 10);
  b.retain();
  res.emit("close");
  assert.equal(b.signal.aborted, true);
  assert.throws(
    () => uploads.reserve(request(), response(), "user-c", 10),
    status(429),
  );
  b.release();
  const c = uploads.reserve(request(), response(), "user-c", 10);
  c.release();
  a.release();
  assert.throws(
    () => uploads.reserve(request("11"), response(), "user-a", 10),
    status(413),
  );
  assert.throws(
    () => uploads.reserve(request("1", "gzip"), response(), "user-a", 10),
    status(415),
  );
});

test("upload deadline cancels work without allowing replacement bodies before cleanup", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const uploads = createUploads({} as Store, {
      limits: {
        ...uploadAdmissionLimits(),
        activePerUser: 1,
        receiveMs: uploadLimits.receiveMs,
      },
    }),
    req = request(),
    res = response();
  const lease = uploads.reserve(req, res, "user-a", 10);
  lease.retain();
  t.mock.timers.tick(uploadLimits.receiveMs);
  assert.equal(lease.signal.aborted, true);
  assert.equal(req.destroyed, true);
  assert.throws(
    () => uploads.reserve(request(), response(), "user-a", 10),
    status(429),
  );
  lease.release();
  uploads.reserve(request(), response(), "user-a", 10).release();
});

test("upload admission supports many concurrent users and multiple uploads per user", () => {
  const uploads = createUploads({} as Store);
  const leases = Array.from({ length: 64 }, (_, i) =>
    uploads.reserve(request("1024"), response(), `user-${i}`, 2048),
  );
  try {
    assert.throws(
      () => uploads.reserve(request(), response(), "overflow", 10),
      status(429),
    );
    leases[0].release();
    leases[0].release();
    const replacement = uploads.reserve(
      request(),
      response(),
      "replacement",
      10,
    );
    assert.throws(
      () => uploads.reserve(request(), response(), "overflow", 10),
      status(429),
    );
    replacement.release();
  } finally {
    leases.forEach((lease) => lease.release());
  }
  const sameUser = Array.from({ length: 4 }, () =>
    uploads.reserve(request(), response(), "shared-user", 10),
  );
  try {
    assert.throws(
      () => uploads.reserve(request(), response(), "shared-user", 10),
      status(429),
    );
    uploads.reserve(request(), response(), "independent-user", 10).release();
    sameUser[0].release();
    const replacement = uploads.reserve(
      request(),
      response(),
      "shared-user",
      10,
    );
    assert.throws(
      () => uploads.reserve(request(), response(), "shared-user", 10),
      status(429),
    );
    replacement.release();
  } finally {
    sameUser.forEach((lease) => lease.release());
  }
});

test("upload admission enforces a byte budget for declared and chunked bodies", () => {
  const uploads = createUploads({} as Store, {
    limits: { ...uploadAdmissionLimits(), activeBytes: 10 },
  });
  const first = uploads.reserve(request("6"), response(), "first", 10);
  assert.throws(
    () => uploads.reserve(request("5"), response(), "second", 10),
    status(429),
  );
  const second = uploads.reserve(request("4"), response(), "second", 10);
  first.release();
  assert.throws(
    () => uploads.reserve(request(""), response(), "chunked", 10),
    status(429),
  );
  second.release();
  uploads.reserve(request(""), response(), "chunked", 10).release();
  const finished = response();
  uploads.reserve(request("10"), finished, "finished", 10);
  finished.emit("finish");
  uploads.reserve(request("10"), response(), "next", 10).release();
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

test("document quotas include a count cap so tiny stored files cannot exhaust metadata storage", async () => {
  const { checkStoredDocumentQuota } = await import("../server/upload-quotas");
  for (const subject of ["user", "organization", "deployment"] as const) {
    const store = {
      all: async () => [
        { subject, count: String(uploadLimits.documents[subject]), size: "0" },
      ],
    } as unknown as Store;
    await assert.rejects(
      checkStoredDocumentQuota(store, "actor", "org", 1, 1),
      /count quota/,
    );
    await checkStoredDocumentQuota(store, "actor", "org", 0);
  }
});
