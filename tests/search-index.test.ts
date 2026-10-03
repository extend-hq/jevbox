import { isScoreRequest, scoreResponse } from "./model-tools";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIndex,
  splitPassages,
  withSearchPassages,
} from "../server/indexing";
import { normalizeIndexText, searchMetadata } from "../server/search-metadata";
import { metadataCandidates } from "../server/search-candidates";

test("table passages repeat headers and captions without cutting or dropping rows", () => {
  const rows = Array.from(
    { length: 30 },
    (_, index) =>
      `<tr><td>Measure ${index}</td><td>${index * 7}</td><td>${index * 9}</td></tr>`,
  );
  const table = `<table><caption>Amounts in thousands</caption><thead><tr><th>Measure</th><th>Earlier</th><th>Later</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const content = `Opening prose.\n\n${table}\n\nClosing prose.`;
  const passages = splitPassages(content, 500, 50);
  const tables = passages.filter((passage) =>
    passage.content.includes("<table>"),
  );
  assert.ok(tables.length > 1);
  for (const passage of tables) {
    assert.ok(passage.content.length <= 500);
    assert.match(passage.content, /Amounts in thousands/);
    assert.match(passage.content, /<th>Earlier<\/th><th>Later<\/th>/);
    assert.match(passage.content, /<\/tbody><\/table>/);
    assert.match(passage.content, /Opening prose/);
    assert.match(passage.content, /Closing prose/);
    assert.ok(content.slice(passage.start, passage.end).includes("<tr>"));
  }
  for (const row of rows)
    assert.equal(
      tables.filter((passage) => passage.content.includes(row)).length,
      1,
    );
  assert.ok(
    passages.some((passage) => passage.content.includes("Opening prose.")),
  );
  assert.ok(
    passages.some((passage) => passage.content.includes("Closing prose.")),
  );
});

test("routing profiles retain extracted abbreviations and captions without replacing source content", () => {
  const content =
    "# Evaluation\nORION evaluates NOVA. ORION and NOVA share a benchmark.\nFigure 1: Evaluation results for ORION and NOVA.\nTable 1: Comparison of both systems.\n<table><tr><th>System</th><th>Value</th></tr><tr><td>ORION</td><td>9</td></tr></table>";
  const parsed = buildIndex([{ content }], "text");
  assert.equal(parsed.markdown, content);
  assert.equal(parsed.searchProfileVersion, 1);
  assert.match(parsed.searchProfile!, /ORION/);
  assert.match(parsed.searchProfile!, /NOVA/);
  assert.match(parsed.searchProfile!, /Comparison of both systems/);
  assert.match(parsed.searchProfile!, /Evaluation results/);
  assert.ok(parsed.searchProfile!.length <= 4096);
  assert.ok(!parsed.summary!.includes("Extracted terms"));
});

test("metadata candidates prioritize rare query terms and retain matching late headings", () => {
  const documents = Array.from({ length: 80 }, (_, index) => ({
    id: String(index),
    name: "Report",
    outline:
      index === 63
        ? `${"General introduction; ".repeat(30)}Hydraulic turbine reliability`
        : "General introduction; Annual financial results",
  }));
  const candidates = metadataCandidates(
    documents,
    "What affects hydraulic turbine reliability?",
  );
  assert.equal(candidates[0].id, "63");
  assert.match(candidates[0].hint, /Hydraulic turbine reliability/);
  assert.ok(candidates.length <= 8);
  assert.deepEqual(
    metadataCandidates(documents, "How many documents are there?"),
    [],
  );
});

test("table rows larger than the target size retain every cell", () => {
  const row = `<tr><td>Label</td><td>${"Long cell. ".repeat(100)}</td></tr>`;
  const table = `<table><tr><th>Name</th><th>Detail</th></tr>${row}</table>`;
  const passages = splitPassages(table, 200);
  assert.equal(passages.length, 1);
  assert.ok(passages[0].content.includes(row));
  assert.match(passages[0].content, /<thead><tr><th>Name/);
});

test("table row spans remain with all of their dependent rows", () => {
  const group = `<tr><td rowspan="3">Group label</td><td>First value</td></tr><tr><td>Second value</td></tr><tr><td>Third value</td></tr>`;
  const content = `<table><thead><tr><th>Group</th><th>Value</th></tr></thead><tbody><tr><td>Earlier group</td><td>Other</td></tr>${group}<tr><td>Later group</td><td>Other</td></tr></tbody></table>`;
  const passages = splitPassages(content, 180);
  assert.equal(
    passages.filter((passage) => passage.content.includes(group)).length,
    1,
  );
});

test("old search passages upgrade without changing source content or block provenance", () => {
  const table = `<table><thead><tr><th>Period</th><th>Value</th></tr></thead><tbody>${"<tr><td>Later</td><td>174</td></tr>".repeat(100)}</tbody></table>`;
  const parsed = buildIndex(
    [
      {
        content: table,
        metadata: { pageRange: { start: 4, end: 4 } },
        blocks: [
          {
            id: "table-block",
            type: "table",
            content: table,
            metadata: { page: { number: 4 } },
          },
        ],
      },
    ],
    "extend",
  );
  delete parsed.passageVersion;
  parsed.nodes[0].passages = [
    {
      id: "old",
      content: "Fragment",
      page: 4,
      endPage: 4,
      blockIds: ["table-block"],
    },
  ];
  const original = structuredClone(parsed);
  const upgraded = withSearchPassages(parsed);
  assert.deepEqual(parsed, original);
  assert.equal(upgraded.markdown, parsed.markdown);
  assert.deepEqual(upgraded.blocks, parsed.blocks);
  assert.equal(upgraded.nodes[0].content, table);
  for (const passage of upgraded.nodes[0].passages!) {
    assert.match(passage.content, /<th>Period/);
    assert.deepEqual(passage.blockIds, ["table-block"]);
    assert.equal(passage.page, 4);
  }
  assert.equal(withSearchPassages(upgraded), upgraded);
});

test("document statistics count full extraction and normalize term matches", () => {
  const parsed = buildIndex(
    [
      {
        content:
          "# Overview\nABC ABC Alpha-2 Alpha - 2 Alpha-\n2 fragmented-\nword",
        metadata: { pageRange: { start: 1, end: 5 } },
      },
    ],
    "text",
  );
  const node = searchMetadata(parsed, "How many times does Alpha-2 appear?");
  const statistics = JSON.parse(node.passages![0].content);
  assert.equal(statistics.pdfPages, 5);
  assert.equal(
    statistics.queryTermOccurrences.find(
      (term: { term: string }) => term.term === "alpha-2",
    ).count,
    3,
  );
  assert.deepEqual(statistics.mostFrequentAbbreviations, [
    { term: "ABC", count: 2 },
  ]);
  assert.equal(normalizeIndexText("fragmented-\nword"), "fragmentedword");
  assert.match(statistics.countingMethod, /extraction may omit/);
});

test("document statistics distinguish numbered logical figures from split parsed panels", () => {
  const blocks = [
    { id: "panel-a", type: "figure", content: "First panel" },
    { id: "panel-b", type: "figure", content: "Second panel" },
    {
      id: "caption",
      type: "text",
      content: "Figure 1: Results from both panels.",
    },
  ];
  const parsed = buildIndex(
    [{ content: blocks.map((block) => block.content).join("\n\n"), blocks }],
    "extend",
  );
  const stats = JSON.parse(
    searchMetadata(parsed, "How many figures are there?").passages![0].content,
  );
  assert.equal(stats.parsedFigures, 2);
  assert.equal(stats.labeledFigures, 1);
  assert.deepEqual(
    stats.figureLabels.map((caption: { label: string }) => caption.label),
    ["1"],
  );
  assert.match(stats.countingMethod, /split panels/);
});

test("retrieval can select document statistics without invoking an answer model", async () => {
  const { retrieveDocuments } = await import("../server/retrieval");
  const parsed = buildIndex(
    [
      {
        content: "# Overview\nBody",
        metadata: { pageRange: { start: 1, end: 7 } },
      },
    ],
    "text",
  );
  const resource = {
    id: "resource",
    org_id: "org",
    kind: "document",
    status: "ready",
    name: "Source",
    parent_id: null,
    parsed: JSON.stringify(parsed),
  };
  const store = {
    all: async () => [resource],
    one: async () => resource,
    permission: async () => true,
    permissions: async (_actor: unknown, _kind: string, ids: string[]) =>
      ids.map(() => true),
  } as unknown as import("../server/db").Store;
  const result = await retrieveDocuments(
    store,
    { orgId: "org", userId: "user", role: "admin", token: "" },
    "How many pages are there?",
    "key",
    async (input, init) => {
      assert.equal(input, "https://api.typesafe.ai/v1/systemone");
      const body = JSON.parse(String(init?.body));
      if (isScoreRequest(body))
        return scoreResponse(body, (content) =>
          content.includes('"pdfPages":7') ? 3 : 0,
        );
      return Response.json({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(
            ([id, question]: [string, any]) => {
              const chosen = Object.keys(question.criteria).find((key) =>
                key.endsWith(":document-metadata"),
              )!;
              return [
                id,
                {
                  probabilities: Object.fromEntries(
                    Object.keys(question.criteria).map((key) => [
                      key,
                      Number(key === chosen),
                    ]),
                  ),
                },
              ];
            },
          ),
        ),
      });
    },
  );
  assert.equal(result.results.length, 1);
  assert.equal(JSON.parse(result.results[0].content).pdfPages, 7);
});

test("several partial matches do not stop exploration before complete evidence", async () => {
  const { retrieveDocuments } = await import("../server/retrieval");
  const parsed = buildIndex(
    [
      {
        content:
          "# First input\nPartial evidence.\n# Second input\nPartial evidence.\n# Third input\nPartial evidence.\n# Remaining inputs\nBackground.\n## Complete evidence\nEvery required value is stated here.",
      },
    ],
    "text",
  );
  const resource = {
    id: "resource",
    org_id: "org",
    kind: "document",
    status: "ready",
    name: "Source",
    parent_id: null,
    parsed: JSON.stringify(parsed),
  };
  const store = {
    all: async () => [resource],
    one: async () => resource,
    permission: async () => true,
    permissions: async (_actor: unknown, _kind: string, ids: string[]) =>
      ids.map(() => true),
  } as unknown as import("../server/db").Store;
  let coverageChecks = 0;
  const result = await retrieveDocuments(
    store,
    { orgId: "org", userId: "user", role: "admin", token: "" },
    "What are all of the required values?",
    "key",
    async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!isScoreRequest(body)) {
        const { choiceResponse } = await import("./model-tools");
        return choiceResponse(body);
      }
      if (
        typeof body.state === "string" &&
        (body.state.match(/Source: /g) ?? []).length >= 3
      )
        coverageChecks++;
      return scoreResponse(body, (content) =>
        content.includes("Every required value")
          ? 3
          : content.includes("Partial evidence")
            ? 2
            : 0,
      );
    },
  );
  assert.ok(coverageChecks > 0);
  assert.ok(
    result.results.some((source) =>
      source.content.includes("Every required value"),
    ),
  );
});
