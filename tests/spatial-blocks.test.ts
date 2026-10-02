import assert from "node:assert/strict";
import { test } from "node:test";
import {
  spatialBlockCrop,
  spatialOutlineRows,
} from "../src/lib/spatial-blocks";
import type { ParsedBlock } from "../shared/parsed-blocks";
import type { IndexNode } from "../src/lib/api";

const block: ParsedBlock = {
  id: "a",
  type: "text",
  content: "Recognized text",
  page: 2,
  pageWidth: 1000,
  pageHeight: 2000,
  boundingBox: { left: 100, top: 400, right: 500, bottom: 1000 },
};
const node = (
  id: string,
  blocks: ParsedBlock[],
  children: IndexNode[] = [],
): IndexNode => ({
  id,
  title: id,
  summary: "",
  content: "",
  page: 2,
  endPage: 2,
  links: [],
  blocks,
  children,
});

test("outline rows preserve crop geometry and resolve parent blocks from descendants", () => {
  const rows = spatialOutlineRows({
    sections: [
      node("root", [], [node("child", [{ ...block, boundingBox: undefined }])]),
    ],
    blocks: [block],
  });
  assert.deepEqual(
    rows.map((row) => [row.depth, row.parent]),
    [
      [0, -1],
      [1, 0],
    ],
  );
  assert.equal(rows[0].blocks[0], block);
  assert.equal(rows[1].blocks[0], block);
  assert.equal(
    spatialOutlineRows(
      {
        sections: [node("root", [], [node("child", [block])])],
        blocks: [block],
      },
      1,
    ).length,
    1,
  );
});

test("page-only outlines retain all blocks in page order", () => {
  const rows = spatialOutlineRows({
    sections: [],
    blocks: [block, { ...block, id: "b", page: 1 }],
  });
  assert.deepEqual(
    rows.map((row) => row.page),
    [1, 2],
  );
  assert.equal(rows[1].blocks[0], block);
});

test("OCR crops normalize page coordinates, clamp edges, and reject missing geometry", () => {
  assert.deepEqual(spatialBlockCrop(block), {
    left: 0.1,
    top: 0.2,
    width: 0.4,
    height: 0.3,
  });
  assert.deepEqual(
    spatialBlockCrop({
      ...block,
      boundingBox: { left: -10, top: -10, right: 1200, bottom: 2100 },
    }),
    { left: 0, top: 0, width: 1, height: 1 },
  );
  assert.equal(spatialBlockCrop({ ...block, boundingBox: undefined }), null);
  assert.equal(spatialBlockCrop({ ...block, pageWidth: NaN }), null);
  assert.equal(
    spatialBlockCrop({
      ...block,
      boundingBox: { left: 500, top: 400, right: 100, bottom: 1000 },
    }),
    null,
  );
});

test("OCR crops undo parsing and native page rotation together", () => {
  assert.deepEqual(spatialBlockCrop({ ...block, rotationApplied: 90 }), {
    left: 0.2,
    top: 0.5,
    width: 0.3,
    height: 0.4,
  });
  assert.deepEqual(
    spatialBlockCrop({ ...block, rotationApplied: 90 }, 270),
    spatialBlockCrop(block),
  );
  assert.equal(spatialBlockCrop(block, 45), null);
});
