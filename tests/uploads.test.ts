import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import type { Request, Response } from "express";
import { createUploads, decodeUpload, validateUpload } from "../server/uploads";
import { uploadLimits } from "../shared/uploads";
import { HttpError, type Store } from "../server/db";

const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.status === code;

test("upload limits reject empty, oversized, unsupported, disguised, and invalid text content", async () => {
  await assert.rejects(
    validateUpload("note.txt", Buffer.alloc(0)),
    status(400),
  );
  await assert.rejects(
    validateUpload("note.txt", Buffer.alloc(uploadLimits.textBytes + 1)),
    status(413),
  );
  await assert.rejects(
    validateUpload("document.pdf", Buffer.alloc(uploadLimits.fileBytes + 1)),
    status(413),
  );
  await assert.rejects(
    validateUpload("program.exe", Buffer.from("binary")),
    status(415),
  );
  await assert.rejects(
    validateUpload("document.pdf", Buffer.from("text")),
    status(400),
  );
  await assert.rejects(
    validateUpload("image.png", Buffer.from("text")),
    status(400),
  );
  await assert.rejects(
    validateUpload(
      "image.svg",
      Buffer.from('<!DOCTYPE svg [<!ENTITY x "expanded">]><svg/>'),
    ),
    status(400),
  );
  await assert.rejects(
    validateUpload(
      "image.svg",
      Buffer.from('<svg><image href="https://remote.test/image.png"/></svg>'),
    ),
    status(400),
  );
  await assert.rejects(
    validateUpload("note.txt", Buffer.from([0xff])),
    status(400),
  );
  await assert.rejects(
    validateUpload("note.txt", Buffer.from([0])),
    status(400),
  );
  await assert.rejects(validateUpload("../note.txt", Buffer.from("text")));
  await assert.rejects(validateUpload("note:stream.txt", Buffer.from("text")));
  assert.equal(
    await validateUpload("note.md", Buffer.from("# Note\nHello")),
    "text/markdown",
  );
});

test("base64 decoding is canonical, bounded, and handles the maximum inline upload", () => {
  for (const value of [
    "",
    "SGVsbG8",
    "SGVsbG8=\n",
    "data:text/plain;base64,SGk=",
    "SGk-",
    "Zh==",
  ])
    assert.throws(() => decodeUpload(value), status(400));
  assert.equal(decodeUpload("SGVsbG8K").toString(), "Hello\n");
  const content = Buffer.alloc(uploadLimits.mcpBytes, 65);
  assert.deepEqual(decodeUpload(content.toString("base64")), content);
  assert.throws(
    () =>
      decodeUpload(Buffer.alloc(uploadLimits.mcpBytes + 2).toString("base64")),
    status(413),
  );
});

test("Office validation accepts normal containers and rejects expansion, traversal, and forged lengths", async () => {
  for (const ext of ["docx", "xlsx", "pptx"]) {
    assert.ok(
      await validateUpload(
        `document.${ext}`,
        readFileSync(new URL(`./fixtures/Workspace.${ext}`, import.meta.url)),
      ),
    );
  }
  const main = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<document/>"),
  };
  await assert.rejects(
    validateUpload(
      "document.docx",
      Buffer.from(zipSync({ ...main, "../escape": strToU8("x") })),
    ),
    status(400),
  );
  const bomb = Buffer.from(
    zipSync({ ...main, "word/large.xml": new Uint8Array(9 * 1024 * 1024) }),
  );
  await assert.rejects(validateUpload("document.docx", bomb), status(400));
  const forged = Buffer.from(zipSync(main));
  const central = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  forged.writeUInt32LE(1, central + 24);
  await assert.rejects(validateUpload("document.docx", forged), status(400));
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
  const uploads = createUploads({} as Store);
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
  const uploads = createUploads({} as Store),
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

test("tiny text files cannot create unbounded pages or sections during indexing", async () => {
  await assert.rejects(
    validateUpload(
      "note.txt",
      Buffer.from("\f".repeat(uploadLimits.textPages)),
    ),
    status(413),
  );
  await assert.rejects(
    validateUpload(
      "note.txt",
      Buffer.from("# Heading\n".repeat(uploadLimits.textHeadings + 1)),
    ),
    status(413),
  );
  await assert.rejects(
    validateUpload(
      "note.txt",
      Buffer.from("\n".repeat(uploadLimits.textLines)),
    ),
    status(413),
  );
  const { buildIndex } = await import("../server/indexing");
  assert.throws(
    () =>
      buildIndex(
        Array.from({ length: uploadLimits.indexChunks + 1 }, () => ({
          content: "x",
        })),
        "text",
      ),
    status(413),
  );
  assert.throws(
    () =>
      buildIndex(
        [{ content: "x", blocks: new Array(uploadLimits.indexBlocks + 1) }],
        "text",
      ),
    status(413),
  );
  assert.throws(
    () =>
      buildIndex(
        [
          {
            content: "# Heading x\n\nx\n".repeat(300),
            blocks: Array.from({ length: 200 }, (_, i) => ({
              id: String(i),
              type: "text",
              content: "x",
            })),
          },
        ],
        "extend",
      ),
    status(413),
  );
});

test("parser responses are bounded for both declared and chunked oversized payloads", async () => {
  const { jsonRequest, ProviderResponseError } =
    await import("../server/provider-http");
  const tooLarge = uploadLimits.parserResponseBytes + 1;
  const reject = (error: unknown) =>
    error instanceof ProviderResponseError && error.retryable === false;
  await assert.rejects(
    jsonRequest(
      async () =>
        new Response("{}", { headers: { "Content-Length": String(tooLarge) } }),
      "https://provider.test",
      {},
    ),
    reject,
  );
  let cancelled = false;
  await assert.rejects(
    jsonRequest(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(tooLarge));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      "https://provider.test",
      {},
    ),
    reject,
  );
  assert.equal(cancelled, true);
  assert.deepEqual(
    await jsonRequest(
      async () => Response.json({ ok: true }),
      "https://provider.test",
      {},
    ),
    { ok: true },
  );
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
