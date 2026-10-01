import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectDocument } from "../server/document-inspection";
import { buildIndex } from "../server/indexing";
import type { Store, Actor } from "../server/db";

const actor: Actor = { orgId: "org", userId: "user", role: "admin", token: "" };
function fixture(allowed: () => boolean = () => true) {
  const parsed = buildIndex(
    [
      {
        content:
          "# Opening\nABC term\n<table><tr><td>ABC term</td></tr></table>",
        metadata: { pageRange: { start: 1, end: 1 } },
        blocks: [
          {
            id: "opening",
            type: "text",
            content: "ABC term",
            metadata: { page: { number: 1 } },
          },
          {
            id: "table",
            type: "table",
            content: "<table><tr><td>ABC term</td></tr></table>",
            metadata: { page: { number: 1 } },
          },
        ],
      },
      {
        content: "# Closing\nABC other term",
        metadata: { pageRange: { start: 2, end: 2 } },
        blocks: [
          {
            id: "closing",
            type: "text",
            content: "ABC other term",
            metadata: { page: { number: 2 } },
          },
        ],
      },
    ],
    "extend",
  );
  const resource = {
    id: "doc",
    org_id: actor.orgId,
    owner_id: actor.userId,
    name: "Document",
    status: "ready",
    access: "restricted",
    parsed: JSON.stringify(parsed),
  };
  return {
    parsed,
    store: {
      one: async () => resource,
      permission: async () => allowed(),
    } as unknown as Store,
  };
}

test("document inspection computes full-text statistics and keeps exact requested page provenance", async () => {
  const { store } = fixture();
  const sources = await inspectDocument(store, actor, {
    documentId: "doc",
    term: "TERM",
    pages: [2, 2, 3],
  });
  const stats = JSON.parse(sources[0].content);
  assert.equal(stats.pages, 2);
  assert.equal(stats.extractedWordCount, 7);
  assert.equal(stats.tables, 1);
  assert.equal(stats.termOccurrences.count, 3);
  assert.deepEqual(stats.topAbbreviations[0], { term: "ABC", count: 3 });
  assert.equal(sources.length, 3);
  assert.equal(sources[1].page, 2);
  assert.deepEqual(sources[1].blockIds, ["closing"]);
  assert.match(sources[1].content, /ABC other term/);
  assert.match(sources[2].content, /Page 3 does not exist/);
});

test("inspection fails closed when access is absent or revoked during reading", async () => {
  const denied = fixture(() => false);
  await assert.rejects(
    inspectDocument(denied.store, actor, { documentId: "doc" }),
    /Document not found/,
  );
  let checks = 0;
  const revoked = fixture(() => ++checks === 1);
  await assert.rejects(
    inspectDocument(revoked.store, actor, { documentId: "doc" }),
    /Document not found/,
  );
});

test("inspection bounds page excerpts and respects cancellation", async () => {
  const { store, parsed } = fixture();
  parsed.blocks[0].content = "Long content ".repeat(10000);
  store.one = async () =>
    ({
      id: "doc",
      org_id: actor.orgId,
      name: "Document",
      status: "ready",
      parsed: JSON.stringify(parsed),
    }) as never;
  const sources = await inspectDocument(store, actor, {
    documentId: "doc",
    pages: [1],
  });
  assert.ok(sources[1].content.length <= 16030);
  assert.match(sources[1].content, /Page excerpt truncated/);
  await assert.rejects(
    inspectDocument(store, actor, { documentId: "doc" }, AbortSignal.abort()),
    /abort/i,
  );
});
