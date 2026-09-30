import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prepareCodePreview,
  readCodePreview,
  CODE_PREVIEW_BYTES,
  CODE_PREVIEW_LINES,
  CODE_PREVIEW_COLUMNS,
} from "../shared/code-thumbnail-content";

test("code previews format JSON and preserve YAML while bounding highlight work", () => {
  assert.equal(
    prepareCodePreview('{"enabled":true}', "json"),
    '{\n  "enabled": true\n}',
  );
  assert.equal(
    prepareCodePreview("enabled: true\nitems:\n  - one", "yaml"),
    "enabled: true\nitems:\n  - one",
  );
  const preview = prepareCodePreview(
    ("x".repeat(200) + "\n").repeat(1000),
    "yaml",
  );
  assert.equal(preview.split("\n").length, CODE_PREVIEW_LINES);
  assert.ok(
    preview.split("\n").every((line) => line.length <= CODE_PREVIEW_COLUMNS),
  );
});

test("code preview reads stop after the byte budget and cancel the remaining stream", async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(8192).fill(97));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await readCodePreview(new Response(stream));
  assert.equal(result.length, CODE_PREVIEW_BYTES);
  assert.ok(reads <= 3);
  assert.equal(cancelled, true);
  await assert.rejects(readCodePreview(new Response(null, { status: 403 })));
});
