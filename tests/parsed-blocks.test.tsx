import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildIndex } from "../server/indexing";
import { blockHighlightArea, type ParsedBlock } from "../shared/parsed-blocks";
import {
  documentBlocks,
  ParsedBlockOverlay,
} from "../src/components/parsed-blocks";

test("indexing keeps all source blocks and geometry independent of section markdown", () => {
  const block = {
    id: "b1",
    type: "table",
    content: "Cell content",
    metadata: { page: { number: 2, width: 1000, height: 2000 } },
    boundingBox: { left: 100, top: 400, right: 500, bottom: 1000 },
  };
  const parsed = buildIndex(
    [
      { content: "# Heading\nCombined output", blocks: [block] },
      {
        content: "Continued output",
        blocks: [
          block,
          {
            id: "b2",
            type: "figure",
            content: "",
            metadata: { page: { number: 3, width: 100, height: 200 } },
            polygon: [
              { x: 10, y: 20 },
              { x: 40, y: 20 },
              { x: 40, y: 60 },
              { x: 10, y: 60 },
            ],
          },
        ],
      },
    ],
    "extend",
    { pages: [{ number: 2, rotationApplied: 90 }] },
  );
  assert.equal(parsed.pages, 3);
  assert.equal(parsed.blocks.length, 2);
  assert.equal(parsed.blocks[0].rotationApplied, 90);
  assert.deepEqual(parsed.blocks[1].boundingBox, {
    left: 10,
    top: 20,
    right: 40,
    bottom: 60,
  });
  assert.deepEqual(blockHighlightArea(parsed.blocks[0]), {
    left: 20,
    top: 50,
    width: 30,
    height: 40,
  });
  assert.deepEqual(documentBlocks(parsed), parsed.blocks);
});

test("highlights use page percentages, undo source rotations and reject unavailable geometry", () => {
  const block: ParsedBlock = {
    id: "b",
    type: "paragraph",
    content: "Text",
    page: 1,
    pageWidth: 1000,
    pageHeight: 2000,
    boundingBox: { left: 100, top: 400, right: 500, bottom: 1000 },
  };
  assert.deepEqual(blockHighlightArea(block), {
    left: 10,
    top: 20,
    width: 40,
    height: 30,
  });
  assert.deepEqual(blockHighlightArea(block, 90), {
    left: 20,
    top: 50,
    width: 30,
    height: 40,
  });
  assert.deepEqual(blockHighlightArea({ ...block, rotationApplied: 180 }), {
    left: 50,
    top: 50,
    width: 40,
    height: 30,
  });
  assert.deepEqual(blockHighlightArea({ ...block, rotationApplied: -90 }), {
    left: 50,
    top: 10,
    width: 30,
    height: 40,
  });
  assert.equal(blockHighlightArea({ ...block, pageWidth: undefined }), null);
  assert.equal(blockHighlightArea({ ...block, boundingBox: undefined }), null);
  assert.equal(
    blockHighlightArea({
      ...block,
      boundingBox: { left: 500, top: 1000, right: 100, bottom: 400 },
    }),
    null,
  );
  const markup = renderToStaticMarkup(
    <ParsedBlockOverlay
      blocks={[block, { ...block, id: "other-page", page: 2 }]}
      page={1}
      activeId="b"
      width={600}
      height={1200}
    />,
  );
  assert.match(markup, /data-selected="true"/);
  assert.match(markup, /x="60" y="240" width="240" height="360"/);
  assert.ok(!markup.includes("other-page"));
});

test("old indexes and text documents retain usable content without invented coordinates", () => {
  const parsed = buildIndex([{ content: "# Heading\nBody" }], "text");
  const blocks = documentBlocks(parsed);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].content, "# Heading\nBody");
  assert.equal(blockHighlightArea(blocks[0]), null);
  const { blocks: _blocks, ...legacy } = parsed;
  assert.deepEqual(documentBlocks(legacy), blocks);
});
