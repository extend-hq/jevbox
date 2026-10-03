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

test("inspection paginates the complete outline and preserves heading hierarchy and page scope", async () => {
  const parsed = buildIndex(
    Array.from({ length: 95 }, (_, i) => ({
      content: `# Heading ${i + 1}\n## Detail ${i + 1}\nEvidence`,
      metadata: { pageRange: { start: i + 1, end: i + 1 } },
    })),
    "extend",
  );
  const { store } = fixture();
  store.one = async () =>
    ({
      id: "doc",
      name: "Document",
      status: "ready",
      parsed: JSON.stringify(parsed),
    }) as never;
  const all: {
    id: string;
    title: string;
    parentId: string | null;
    parentTitle: string | null;
  }[] = [];
  let offset = 0;
  do {
    const sources = await inspectDocument(store, actor, {
      documentId: "doc",
      outlineOffset: offset,
    });
    const stats = JSON.parse(sources[0].content);
    assert.ok(stats.sections.length <= 80);
    assert.equal(stats.outlineOffset, offset);
    assert.equal(stats.totalOutlineSections, 190);
    all.push(...stats.sections);
    offset = stats.nextOutlineOffset;
  } while (offset !== null);
  assert.equal(all.length, 190);
  assert.equal(new Set(all.map((section) => section.id)).size, 190);
  const parent = all.find((section) => section.title === "Heading 95")!;
  const child = all.find((section) => section.title === "Detail 95")!;
  assert.equal(child.parentId, parent.id);
  assert.equal(child.parentTitle, parent.title);
  const scoped = await inspectDocument(store, actor, {
    documentId: "doc",
    pages: [95],
  });
  const stats = JSON.parse(scoped[0].content);
  assert.equal(stats.totalIndexedSections, 190);
  assert.deepEqual(
    stats.sections.map((section: any) => section.title),
    ["Heading 95", "Detail 95"],
  );
  assert.deepEqual(scoped[1].sectionPath, ["Heading 95", "Detail 95"]);
});

test("visual inventories paginate parsed objects with bounded content and distinguish literal frequency", async () => {
  const { parsed, store } = fixture();
  parsed.blocks = Array.from({ length: 100 }, (_, i) => ({
    ...parsed.blocks[0],
    id: `visual-${i}`,
    page: i < 50 ? 1 : 2,
    type: i % 2 ? "table" : "figure",
    content:
      i % 2
        ? "<table><tr><td>Values</td></tr></table>"
        : '<figure type="logo">Caption</figure>' + " detail".repeat(300),
  }));
  parsed.blocks.unshift({
    ...parsed.blocks[0],
    id: "context",
    type: "text",
    content: "Page context",
  });
  store.one = async () =>
    ({
      id: "doc",
      name: "Document",
      status: "ready",
      parsed: JSON.stringify(parsed),
    }) as never;
  const ids: string[] = [];
  let offset = 0;
  do {
    const sources = await inspectDocument(store, actor, {
      documentId: "doc",
      includeVisuals: true,
      visualOffset: offset,
      term: "detail",
    });
    const stats = JSON.parse(sources[0].content);
    const inventory = stats.visualInventory;
    assert.equal(inventory.total, 100);
    assert.match(inventory.method, /unverified/);
    assert.match(
      stats.termOccurrences.method,
      /not a count of distinct objects/,
    );
    assert.equal(stats.termOccurrences.count, 15000);
    for (const item of inventory.items) {
      ids.push(item.id);
      assert.ok(item.extractedContent.length <= 1200);
      assert.ok(item.nearbyText.length <= 1500);
      if (item.type === "figure") {
        assert.equal(item.figureType, "logo");
        assert.equal(item.contentTruncated, true);
      }
    }
    if (!offset) assert.equal(inventory.items[0].nearbyText, "Page context");
    offset = inventory.nextVisualOffset;
  } while (offset !== null);
  assert.equal(ids.length, 100);
  assert.equal(new Set(ids).size, 100);
  const scoped = await inspectDocument(store, actor, {
    documentId: "doc",
    includeVisuals: true,
    pages: [2],
  });
  assert.equal(JSON.parse(scoped[0].content).visualInventory.total, 50);
});

test("inspection rejects invalid page and pagination inputs", async () => {
  const { store } = fixture();
  for (const input of [
    { outlineOffset: -1 },
    { visualOffset: 1.5 },
    { pages: [0] },
    { pages: [1, 2, 3, 4, 5, 6] },
    { term: " " },
  ])
    await assert.rejects(
      inspectDocument(store, actor, { documentId: "doc", ...input }),
    );
});
