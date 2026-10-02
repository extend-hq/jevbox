import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { createDocumentVisuals } from "../server/document-visuals";
import { createThumbnailRenderer } from "../server/thumbnail-renderer";
import { buildIndex } from "../server/indexing";
import { generateAnswer } from "../server/ai";
import type { Actor, Store } from "../server/db";
import { responseUsage, textResponse } from "./model-tools";
import { THUMBNAIL_SIZE } from "../shared/thumbnails";

const actor: Actor = { orgId: "org", userId: "user", role: "admin", token: "" };
const signal = () => new AbortController().signal;
function fixture(
  allowed: () => boolean = () => true,
  mime = "application/pdf",
) {
  const parsed = buildIndex(
    [
      { content: "# Opening", metadata: { pageRange: { start: 1, end: 1 } } },
      { content: "# Closing", metadata: { pageRange: { start: 2, end: 2 } } },
    ],
    "extend",
  );
  let reads = 0;
  const store = {
    one: async () => ({
      id: "doc",
      name: "Document.pdf",
      mime,
      status: "ready",
      parsed: JSON.stringify(parsed),
    }),
    permission: async () => allowed(),
    files: {
      read: async () => {
        reads++;
        return { body: Buffer.from("document") };
      },
    },
  } as unknown as Store;
  return { store, reads: () => reads };
}

test("visual inspection deduplicates pages and retains exact image and citation provenance", async () => {
  const { store, reads } = fixture();
  const calls: unknown[] = [];
  const visuals = createDocumentVisuals(store, {
    render: async (_body, _name, _mime, _signal, options) => {
      calls.push(options);
      return { body: Buffer.from(`page-${options!.pageIndex}`), pageCount: 2 };
    },
    close: async () => {},
  });
  const result = await visuals.view(
    actor,
    { documentId: "doc", pages: [2, 2] },
    signal(),
  );
  assert.equal(reads(), 1);
  assert.deepEqual(calls, [{ pageIndex: 1, width: 1400 }]);
  assert.equal(result.results[0].page, 2);
  assert.equal(result.results[0].endPage, 2);
  assert.equal(result.results[0].passageId, "visual-page-2");
  assert.equal(result.images[0].page, 2);
  assert.equal(
    Buffer.from(result.images[0].data, "base64").toString(),
    "page-1",
  );
});

test("visual inspection fails closed on denial, revocation, and cancellation", async () => {
  const denied = fixture(() => false);
  const renderer = {
    render: async () => ({ body: Buffer.from("image"), pageCount: 2 }),
    close: async () => {},
  };
  await assert.rejects(
    createDocumentVisuals(denied.store, renderer).view(
      actor,
      { documentId: "doc", pages: [1] },
      signal(),
    ),
    /Document not found/,
  );
  assert.equal(denied.reads(), 0);
  let allowed = true;
  const revoked = fixture(() => allowed);
  const visuals = createDocumentVisuals(revoked.store, {
    ...renderer,
    render: async () => {
      allowed = false;
      return { body: Buffer.from("image"), pageCount: 2 };
    },
  });
  await assert.rejects(
    visuals.view(actor, { documentId: "doc", pages: [1] }, signal()),
    /Document not found/,
  );
  await assert.rejects(
    visuals.view(actor, { documentId: "doc", pages: [1] }, AbortSignal.abort()),
    /abort/i,
  );
});

test("visual inspection avoids rendering unsupported and out-of-range requests and bounds inputs", async () => {
  let renders = 0;
  const renderer = {
    render: async () => {
      renders++;
      return { body: Buffer.from("image"), pageCount: 2 };
    },
    close: async () => {},
  };
  for (const mime of ["text/markdown", "application/pdf"]) {
    const { store, reads } = fixture(() => true, mime);
    const visuals = createDocumentVisuals(store, renderer);
    const result = await visuals.view(
      actor,
      { documentId: "doc", pages: [3] },
      signal(),
    );
    assert.equal(result.images.length, 0);
    assert.ok(result.message);
    assert.equal(reads(), 0);
    for (const pages of [[0], [1, 2, 3], []])
      await assert.rejects(
        visuals.view(actor, { documentId: "doc", pages }, signal()),
      );
  }
  assert.equal(renders, 0);
  let checks = 0;
  const revoked = fixture(() => ++checks === 1, "text/markdown");
  await assert.rejects(
    createDocumentVisuals(revoked.store, renderer).view(
      actor,
      { documentId: "doc", pages: [1] },
      signal(),
    ),
    /Document not found/,
  );
});

test("a render failure returns an explicit evidence limitation while revocation still rejects", async () => {
  let allowed = true;
  const { store } = fixture(() => allowed);
  const renderer = {
    render: async () => {
      throw new Error("Renderer unavailable");
    },
    close: async () => {},
  };
  const result = await createDocumentVisuals(store, renderer).view(
    actor,
    { documentId: "doc", pages: [1] },
    signal(),
  );
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.results, []);
  assert.match(result.message!, /could not be rendered/);
  renderer.render = async () => {
    allowed = false;
    throw new Error("Renderer unavailable");
  };
  await assert.rejects(
    createDocumentVisuals(store, renderer).view(
      actor,
      { documentId: "doc", pages: [1] },
      signal(),
    ),
    /Document not found/,
  );
});

test(
  "original PDF rendering selects the requested page at readable resolution",
  { timeout: 90000 },
  async () => {
    const pdf = await PDFDocument.create();
    for (const color of [rgb(1, 0, 0), rgb(0, 0, 1)]) {
      const page = pdf.addPage([200, 300]);
      page.drawRectangle({ x: 0, y: 0, width: 200, height: 300, color });
    }
    const renderer = createThumbnailRenderer();
    try {
      const image = await renderer.render(
        Buffer.from(await pdf.save()),
        "Document.pdf",
        "application/pdf",
        signal(),
        { pageIndex: 1, width: 1400 },
      );
      assert.equal(image.pageCount, 2);
      const metadata = await sharp(image.body).metadata();
      assert.equal(metadata.width, 1400);
      const pixel = await sharp(image.body)
        .extract({ left: 700, top: 1000, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      assert.ok(pixel[0] < 10 && pixel[1] < 10 && pixel[2] > 245);
      const thumbnail = await renderer.render(
        Buffer.from(await pdf.save()),
        "Document.pdf",
        "application/pdf",
        signal(),
      );
      assert.equal((await sharp(thumbnail.body).metadata()).width, THUMBNAIL_SIZE);
      const originalPixel = await sharp(thumbnail.body)
        .extract({ left: 100, top: 100, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      assert.ok(
        originalPixel[0] > 245 &&
          originalPixel[1] < 10 &&
          originalPixel[2] < 10,
      );
    } finally {
      await renderer.close();
    }
  },
);

test("the answer model receives original page images with numbered citations", async () => {
  const requests: any[] = [];
  const image = (
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#0000ff" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
  const answer = await generateAnswer(
    {
      provider: "openai",
      model: "model",
      credentials: { openai: { apiKey: "key", enabled: true, model: "model" } },
    },
    "Answer using evidence.",
    [{ role: "user", content: "What color is the page?" }],
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (requests.length > 1) return textResponse(body, "Blue. [1]");
      return Response.json({
        id: "tool-response",
        created_at: 1,
        model: body.model,
        usage: responseUsage,
        output: [
          {
            id: "visual-call",
            call_id: "visual-call",
            type: "function_call",
            name: "view_document_pages",
            arguments: JSON.stringify({ documentId: "doc", pages: [2] }),
            status: "completed",
          },
        ],
      });
    },
    {
      signal: signal(),
      searchDocuments: async () => ({ sources: [] }),
      viewDocumentPages: async () => ({
        sources: [{ citation: 1, page: 2, text: "Original page" }],
        images: [
          {
            documentId: "doc",
            page: 2,
            mediaType: "image/png",
            data: image,
            citation: 1,
          },
        ],
      }),
    },
  );
  assert.equal(answer, "Blue. [1]");
  assert.equal(requests.length, 2);
  const modelInput = JSON.stringify(requests[1].input);
  assert.ok(modelInput.includes(`data:image/png;base64,${image}`));
  assert.match(modelInput, /citation \[1\]/);
  assert.equal(requests[1].parallel_tool_calls, true);
  assert.equal(requests[1].store, false);
});
