import assert from "node:assert/strict";
import { test } from "node:test";
import {
  citationPromptSource,
  citationSourceKey,
  createCitationLocator,
} from "../server/citation-sources";
import type { Store } from "../server/db";
import type { RetrievedSource } from "../server/retrieval";
import { documentAnswerPolicy } from "../server/answer-policy";

test("citation targets retain exact block pages, geometry, and separate repeated passages", async () => {
  const blocks = [1, 2].map((page) => ({
    id: `block-${page}`,
    page,
    type: "table",
    content: "Repeated evidence",
    pageWidth: 100,
    pageHeight: 200,
    boundingBox: { left: 10, top: 20, right: 50, bottom: 60 },
  }));
  let reads = 0;
  const store = {
    one: async () => {
      reads++;
      return { parsed: JSON.stringify({ blocks, nodes: [] }) };
    },
  } as unknown as Store;
  const sources: RetrievedSource[] = blocks.map((block) => ({
    documentId: "doc",
    name: "Document",
    nodeId: "section",
    sectionPath: ["Parent", "Section"],
    passageId: `passage-${block.page}`,
    title: "Section",
    page: block.page,
    endPage: block.page,
    content: block.content,
    blockIds: [block.id],
    score: 3,
    routeScore: 1,
  }));
  const locate = createCitationLocator(store);
  const layout = await locate(sources);
  await locate(sources);
  assert.equal(reads, 1);
  assert.notEqual(citationSourceKey(sources[0]), citationSourceKey(sources[1]));
  const prompt = citationPromptSource(sources[1], 2, layout.get("doc"));
  assert.equal(prompt.reference, "[2]");
  assert.equal(prompt.sourcePath, "Document › Parent › Section");
  assert.deepEqual(prompt.blocks, [
    {
      reference: "[2.1]",
      blockId: "block-2",
      page: 2,
      type: "table",
      text: "Repeated evidence",
      boundingBox: blocks[1].boundingBox,
    },
  ]);
  assert.deepEqual(sources[1].citationBlocks, [
    { id: "block-2", page: 2, type: "table" },
  ]);
  assert.match(documentAnswerPolicy, /Prefer a block's reference/);
  assert.match(
    documentAnswerPolicy,
    /Never invent reference numbers, paths, block IDs, page numbers, or bounding boxes/,
  );
  const scoped = { ...sources[1], content: "Supporting evidence." };
  const promptBlock = {
    ...blocks[1],
    content: "Nearby rejected text.\nSupporting evidence.\nAnother claim.",
  };
  assert.equal(
    citationPromptSource(scoped, 2, [promptBlock]).blocks?.[0].text,
    "Supporting evidence.",
  );
});
