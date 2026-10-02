import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchFiltersSchema,
  matchesSearchFilters,
} from "../shared/search-filters";
import {
  outlineConnectorRoutes,
  roundedOutlineSegments,
  outlineFlowGeometry,
} from "../src/lib/spatial-outline";
import { generateAnswer } from "../server/ai";
import { textResponse, responseUsage } from "./model-tools";

test("chat exposes and forwards date, type, privacy, and folder search filters", async () => {
  const filters = {
    createdAfter: "2026-10-01",
    createdBefore: "2026-10-02",
    fileTypes: ["pdf"],
    access: ["private", "folder"],
    folderId: "f1177388-4a91-45e6-9972-1202b87643ef",
  };
  const calls: unknown[] = [];
  let requests = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requests++;
    if (requests > 1) return textResponse(body, "Filtered evidence was found.");
    const tool = body.tools.find(
      (tool: any) => tool.name === "search_documents",
    );
    assert.ok(tool.parameters.properties.filters);
    return Response.json({
      id: "filter-search",
      created_at: 1,
      model: body.model,
      status: "completed",
      usage: responseUsage,
      output: [
        {
          id: "search-call",
          call_id: "search-call",
          type: "function_call",
          name: "search_documents",
          arguments: JSON.stringify({ query: "Recent reports", filters }),
          status: "completed",
        },
      ],
    });
  };
  const answer = await generateAnswer(
    {
      provider: "openai",
      model: "test-model",
      credentials: { openai: { apiKey: "test-key" } },
    },
    "Search when evidence is needed.",
    [{ role: "user", content: "Find recent reports" }],
    fetcher,
    {
      signal: new AbortController().signal,
      searchDocuments: async (query, _signal, appliedFilters) => {
        calls.push({ query, filters: appliedFilters });
        return { sources: [] };
      },
    },
  );
  assert.deepEqual(calls, [{ query: "Recent reports", filters }]);
  assert.equal(answer, "Filtered evidence was found.");
});

test("wrapped child columns have no unused document rail and every branch meets a card", () => {
  const layout = {
    railY: 0,
    rowTop: -0.24,
    rowHeight: 0.32,
    rowsPerColumn: 24,
    columnWidth: 4.5,
    indent: 0.26,
    cardWidth: 2.9,
    gap: 0.6,
  };
  const rows = [
    { depth: 0, parent: -1 },
    ...Array.from({ length: 60 }, () => ({ depth: 1, parent: 0 })),
  ];
  const routes = outlineConnectorRoutes(rows, layout);
  assert.deepEqual(routes[0], [
    [-0.6, 0],
    [0.12 - 0.07, 0],
  ]);
  routes.slice(1).forEach((route, index) => {
    const column = Math.floor(index / 24);
    const cardLeft = column * 4.5 + 0.3 + rows[index].depth * 0.26;
    const cardY = -0.24 - (index % 24) * 0.32;
    assert.deepEqual(route.at(-1), [cardLeft + 0.02, cardY]);
    if (column > 0) assert.deepEqual(route[0], [0.3 + 2.9 - 0.02, -0.24]);
    assert.ok(roundedOutlineSegments(route).every(Number.isFinite));
  });
  rows[48] = { depth: 0, parent: -1 };
  const roots = outlineConnectorRoutes(rows, layout);
  assert.deepEqual(roots[0].at(-1), [roots[49][1][0] - 0.07, 0]);
  assert.deepEqual(outlineConnectorRoutes([], layout), []);
});

test("metal flow distances continue from the document through nested and wrapped branches", () => {
  const rows = [
    { depth: 0, parent: -1 },
    { depth: 1, parent: 0 },
    { depth: 2, parent: 1 },
    { depth: 1, parent: 0 },
    { depth: 0, parent: -1 },
  ];
  const flow = outlineFlowGeometry(rows, {
    railY: 0,
    rowTop: -0.24,
    rowHeight: 0.32,
    rowsPerColumn: 2,
    columnWidth: 4.5,
    indent: 0.26,
    cardWidth: 2.9,
    gap: 0.6,
  });
  assert.equal(flow.starts[0], 0);
  assert.equal(flow.starts.length, flow.positions.length / 6);
  assert.equal(flow.ends.length, flow.starts.length);
  assert.equal(flow.rowDistances.length, rows.length);
  flow.starts.forEach((start, i) => {
    assert.ok(Number.isFinite(start));
    assert.ok(flow.ends[i] > start);
  });
  rows.forEach((row, i) => {
    if (row.parent >= 0)
      assert.ok(flow.rowDistances[i] > flow.rowDistances[row.parent]);
  });
  assert.ok(flow.rowDistances[4] > flow.rowDistances[0]);
});

test("root branches round the rail junction as well as the row junction", () => {
  const routes = outlineConnectorRoutes([{ depth: 0, parent: -1 }], {
    railY: 0,
    rowTop: -0.24,
    rowHeight: 0.32,
    rowsPerColumn: 24,
    columnWidth: 4.5,
    indent: 0.26,
    cardWidth: 2.9,
    gap: 0.6,
  });
  const segments = roundedOutlineSegments(routes[1]);
  const vertices = Array.from({ length: segments.length / 3 }, (_, i) =>
    segments.slice(i * 3, i * 3 + 2),
  );
  assert.ok(!vertices.some(([x, y]) => x === 0.12 && y === 0));
  assert.ok(
    vertices.some(([x, y]) => x > 0.05 && x < 0.12 && y < 0 && y > -0.07),
  );
  assert.deepEqual(vertices.at(-1), [0.32, -0.24]);
});

test("shared outline trunks are drawn once and every segment belongs to the document tree", () => {
  const rows = [
    { depth: 0, parent: -1 },
    ...Array.from({ length: 60 }, () => ({ depth: 1, parent: 0 })),
  ];
  const layout = {
    railY: 0,
    rowTop: -0.24,
    rowHeight: 0.32,
    rowsPerColumn: 24,
    columnWidth: 4.5,
    indent: 0.26,
    cardWidth: 2.9,
    gap: 0.6,
  };
  const { positions } = outlineFlowGeometry(rows, layout);
  const segments = Array.from({ length: positions.length / 6 }, (_, i) => ({
    a: [positions[i * 6], positions[i * 6 + 1]],
    b: [positions[i * 6 + 3], positions[i * 6 + 4]],
  }));
  const onSegment = (point: number[], a: number[], b: number[]) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return (
      Math.abs(
        Math.hypot(point[0] - a[0], point[1] - a[1]) +
          Math.hypot(point[0] - b[0], point[1] - b[1]) -
          length,
      ) < 0.000001
    );
  };
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (const b of segments.slice(i + 1)) {
      const horizontal =
        Math.abs(a.a[1] - a.b[1]) < 0.000001 &&
        Math.abs(b.a[1] - b.b[1]) < 0.000001 &&
        Math.abs(a.a[1] - b.a[1]) < 0.000001;
      const vertical =
        Math.abs(a.a[0] - a.b[0]) < 0.000001 &&
        Math.abs(b.a[0] - b.b[0]) < 0.000001 &&
        Math.abs(a.a[0] - b.a[0]) < 0.000001;
      if (!horizontal && !vertical) continue;
      const axis = horizontal ? 0 : 1;
      const overlap =
        Math.min(
          Math.max(a.a[axis], a.b[axis]),
          Math.max(b.a[axis], b.b[axis]),
        ) -
        Math.max(
          Math.min(a.a[axis], a.b[axis]),
          Math.min(b.a[axis], b.b[axis]),
        );
      assert.ok(
        overlap < 0.000001,
        "shared trunks must not stack repeated strokes",
      );
    }
  }
  const cards = rows.map((row, i) => ({
    left: Math.floor(i / 24) * 4.5 + 0.3 + row.depth * 0.26,
    right: Math.floor(i / 24) * 4.5 + 0.3 + 2.9,
    y: -0.24 - (i % 24) * 0.32,
  }));
  const onCard = (point: number[], card: (typeof cards)[number]) =>
    point[0] >= card.left - 0.000001 &&
    point[0] <= card.right + 0.000001 &&
    Math.abs(point[1] - card.y) <= 0.125;
  const reached = new Set<number>([0]);
  const attached = new Set<number>();
  let previous = -1;
  while (reached.size + attached.size !== previous) {
    previous = reached.size + attached.size;
    for (const index of reached) {
      const segment = segments[index];
      cards.forEach((card, i) => {
        if (onCard(segment.a, card) || onCard(segment.b, card)) attached.add(i);
      });
      segments.forEach((other, i) => {
        if (
          onSegment(other.a, segment.a, segment.b) ||
          onSegment(other.b, segment.a, segment.b) ||
          onSegment(segment.a, other.a, other.b) ||
          onSegment(segment.b, other.a, other.b)
        )
          reached.add(i);
      });
    }
    for (const index of attached)
      segments.forEach((segment, i) => {
        if (onCard(segment.a, cards[index]) || onCard(segment.b, cards[index]))
          reached.add(i);
      });
  }
  assert.equal(reached.size, segments.length, "no disconnected segments");
  assert.equal(
    attached.size,
    rows.length,
    "every card connects back to the document",
  );
});

test("search filters validate dates and include the entire final UTC day", () => {
  assert.equal(
    searchFiltersSchema.safeParse({
      createdAfter: "2026-10-03",
      createdBefore: "2026-10-02",
    }).success,
    false,
  );
  assert.equal(
    searchFiltersSchema.safeParse({ createdAfter: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    searchFiltersSchema.safeParse({ access: ["admin"] }).success,
    false,
  );
  const filters = searchFiltersSchema.parse({
    createdAfter: "2026-10-02",
    createdBefore: "2026-10-02",
    access: ["folder"],
    fileTypes: ["spreadsheet"],
  });
  const resource = {
    created: "2026-10-02T23:59:59.999Z",
    mime: "text/csv",
    access: "inherit",
  };
  assert.equal(matchesSearchFilters(resource, filters), true);
  assert.equal(
    matchesSearchFilters(
      { ...resource, created: "2026-10-03T00:00:00Z" },
      filters,
    ),
    false,
  );
  assert.equal(
    matchesSearchFilters({ ...resource, access: "restricted" }, filters),
    false,
  );
  assert.equal(
    matchesSearchFilters({ ...resource, mime: "application/pdf" }, filters),
    false,
  );
});

test("outline corners are rounded while endpoints and short branches stay connected", () => {
  const points = roundedOutlineSegments([
    [0, 0],
    [0, -1],
    [1, -1],
  ]);
  assert.deepEqual(points.slice(0, 3), [0, 0, -0.01]);
  assert.deepEqual(points.slice(-3), [1, -1, -0.01]);
  assert.ok(
    points.some((value, i) => i % 3 === 0 && value > 0 && value < 0.07),
  );
  for (let i = 6; i < points.length; i += 6)
    assert.deepEqual(points.slice(i, i + 3), points.slice(i - 3, i));
  assert.ok(
    roundedOutlineSegments([
      [0, 0],
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
    ]).every(Number.isFinite),
  );
});
