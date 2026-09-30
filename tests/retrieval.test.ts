import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTraversal,
  extendRoute,
  type RouteNode,
  type Route,
} from "../server/beam-search";
import { createJev, retrievalLimits } from "../server/jev";
import { buildIndex, flatten } from "../server/indexing";
import { createProviders } from "../server/providers";
import { retrieveDocuments } from "../server/retrieval";
import type { Resource, Store, Actor } from "../server/db";
import { choiceResponse } from "./model-tools";

const actor: Actor = {
  userId: "user",
  orgId: "org",
  role: "admin",
  token: "session",
};
function document(
  id: string,
  content: string,
  parent_id: string | null = null,
): Resource {
  return {
    id,
    org_id: "org",
    owner_id: "user",
    parent_id,
    kind: "document",
    name: id,
    description: "",
    access: "restricted",
    mime: "text/markdown",
    size: content.length,
    status: "ready",
    error: null,
    parse_run: null,
    parsed: JSON.stringify(buildIndex([{ content }], "text")),
    created: "2026-09-29",
  };
}
function storeFor(
  resources: Resource[],
  allowed = new Set(resources.map((resource) => resource.id)),
) {
  return {
    store: {
      all: async () => resources,
      one: async (_sql: string, id: string) =>
        resources.find((resource) => resource.id === id),
      permission: async (_actor: Actor, _kind: string, id: string) =>
        allowed.has(id),
    } as unknown as Store,
    allowed,
  };
}
const jevFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body));
  return body.questions.usefulness
    ? Response.json({ answers: { usefulness: { type: "score", score: 3 } } })
    : choiceResponse(body);
};

test("indexing continues sections across pages and ignores headings inside code fences", () => {
  const parsed = buildIndex(
    [
      {
        content: "# Topic\nOpening\n```md\n# Code text\n```",
        metadata: { pageRange: { start: 1, end: 1 } },
      },
      {
        content: "Continued facts\n## Detail\nSupporting facts",
        metadata: { pageRange: { start: 2, end: 2 } },
      },
    ],
    "text",
  );
  assert.deepEqual(
    flatten(parsed.nodes).map((node) => node.title),
    ["Topic", "Detail"],
  );
  assert.match(parsed.nodes[0].content, /Continued facts/);
  assert.equal(parsed.nodes[0].passages!.at(-1)!.page, 2);
  assert.equal(parsed.nodes[0].endPage, 2);
});

test("all of a long section remains searchable with exact block and page provenance", async () => {
  const content =
    "# Long section\n" + "Background. ".repeat(1000) + "\nLate evidence: 739.";
  const parsed = buildIndex(
    [
      {
        content,
        metadata: { pageRange: { start: 3, end: 4 } },
        blocks: [
          {
            id: "late",
            type: "text",
            content: "Late evidence: 739.",
            metadata: { page: { number: 4 } },
          },
        ],
      },
    ],
    "extend",
  );
  const resource = document("long", "");
  resource.parsed = JSON.stringify(parsed);
  const { store } = storeFor([resource]);
  const result = await retrieveDocuments(
    store,
    actor,
    "Which value is stated?",
    "key",
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.questions.usefulness) return choiceResponse(body);
      return Response.json({
        answers: {
          usefulness: {
            type: "score",
            score: body.state.includes("739") ? 3 : 0,
          },
        },
      });
    },
  );
  assert.equal(result.results.length, 1);
  assert.match(result.results[0].content, /739/);
  assert.equal(result.results[0].page, 4);
  assert.deepEqual(result.results[0].blockIds, ["late"]);
});

test("indexing never calls a configured chat provider for text or parsed documents", async () => {
  const settings = JSON.stringify({
    extendKey: "parse-key",
    provider: "openai",
    model: "model-id",
    credentials: {
      openai: { apiKey: "chat-key", model: "model-id", enabled: true },
    },
  });
  const store = {
    decrypt: (value: string) => value,
    one: async (sql: string) =>
      sql.includes("FROM orgs")
        ? { settings }
        : {
            body: new TextEncoder().encode(
              "# Parent\nOpening\n## Child\nSource facts.",
            ),
          },
    run: async () => {},
  } as unknown as Store;
  const requests: string[] = [];
  const providers = createProviders(store, async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === "https://api.extend.ai/files/upload")
      return Response.json({ id: "file" });
    if (url === "https://api.extend.ai/parse_runs")
      return Response.json({ id: "run" });
    if (url === "https://api.extend.ai/parse_runs/run")
      return Response.json({
        status: "PROCESSED",
        output: {
          chunks: [{ content: "# Parent\nOpening\n## Child\nParsed facts." }],
        },
      });
    throw new Error("Unexpected provider request during indexing");
  });
  const text = await providers.processDocument(document("text", ""));
  assert.equal(requests.length, 0);
  assert.deepEqual(
    flatten(text!.nodes).map((node) => node.title),
    ["Parent", "Child"],
  );
  const parsed = await providers.processDocument({
    ...document("parsed", ""),
    mime: "application/pdf",
  });
  assert.equal(requests.length, 3);
  assert.ok(requests.every((url) => url.startsWith("https://api.extend.ai/")));
  assert.deepEqual(
    flatten(parsed!.nodes).map((node) => node.title),
    ["Parent", "Child"],
  );
  assert.match(
    parsed!.nodes[0].children[0].passages![0].content,
    /Parsed facts/,
  );
});

test("route scores accumulate in log space and singleton edges do not change the score", () => {
  const node: RouteNode<never> = {
    id: "node",
    children: [],
    describe: async () => "Node",
  };
  const root: Route<never> = {
    node,
    path: [],
    logProbability: 0,
    decisions: 0,
    probability: 1,
    score: 1,
  };
  let route = extendRoute(root, node, 0.8, true);
  route = extendRoute(route, node, 1, false);
  route = extendRoute(route, node, 0.2, true);
  assert.ok(Math.abs(route.score - 0.4) < 1e-10);
  assert.equal(route.decisions, 2);
  for (let i = 0; i < 1000; i++) route = extendRoute(route, node, 0.01, true);
  assert.ok(route.score > 0 && Number.isFinite(route.score));
});

test("frontier routing batches independent sibling questions and deeper evidence can repair an early choice", async () => {
  const leaf = (id: string): RouteNode<string> => ({
    id,
    value: id,
    children: [],
    describe: async () => id,
  });
  const nodes = ["a", "b"].map((id) => ({
    ...leaf(id),
    children: [leaf(`${id}1`), leaf(`${id}2`)],
  }));
  const calls: string[][] = [];
  const traversal = createTraversal(
    nodes,
    {
      choose: async (_query, menus) => {
        calls.push(menus.map((menu) => menu.id));
        return new Map<string, Record<string, number>>(
          menus.map<[string, Record<string, number>]>((menu) => [
            menu.id,
            (menu.id === "library"
              ? { a: 0.6, b: 0.4, none: 0 }
              : menu.id === "a"
                ? { a1: 0.5, a2: 0.5, none: 0 }
                : { b1: 0.99, b2: 0.01, none: 0 }) as Record<string, number>,
          ]),
        );
      },
    },
    "question",
  );
  const routes = await traversal.walk();
  assert.deepEqual(calls[1], ["a", "b"]);
  const a = routes.find((route) => route.node.id === "a1")!;
  const b = routes.find((route) => route.node.id === "b1")!;
  assert.ok(b.score > a.score);
});

test("weak evidence widens exploration into a branch pruned from the initial beam", async () => {
  const resources = Array.from({ length: 6 }, (_, i) =>
    document(`doc-${i}`, `# Section\nEvidence ${i}`),
  );
  const { store } = storeFor(resources);
  const result = await retrieveDocuments(
    store,
    actor,
    "question",
    "key",
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.questions.usefulness
        ? Response.json({
            answers: {
              usefulness: {
                type: "score",
                score: body.state.includes("Evidence 5") ? 3 : 0,
              },
            },
          })
        : choiceResponse(body);
    },
  );
  assert.deepEqual(
    result.results.map((source) => source.documentId),
    ["doc-5"],
  );
});

test("a none routing decision defers branches until their passages can be scored", async () => {
  const resources = [
    document("a", "# Outline\nBackground only."),
    document("b", "# Outline\nThe observed value is 739."),
  ];
  const { store } = storeFor(resources);
  const scored: string[] = [];
  const result = await retrieveDocuments(
    store,
    actor,
    "What is the observed value?",
    "key",
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.questions.usefulness) {
        scored.push(body.state);
        return Response.json({
          answers: {
            usefulness: {
              type: "score",
              score: body.state.includes("739") ? 3 : 1,
            },
          },
        });
      }
      return Response.json({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(
            ([id, question]: [string, any]) => [
              id,
              {
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map((key) => [
                    key,
                    key === "none" ? 1 : 0,
                  ]),
                ),
              },
            ],
          ),
        ),
      });
    },
  );
  assert.equal(scored.length, 2);
  assert.deepEqual(
    result.results.map((source) => source.documentId),
    ["b"],
  );
  assert.ok(result.trace.some((step) => step.stage === "passage"));
});

test("candidate sections score every passage without a passage routing gate", async () => {
  const content =
    "# Overview\n" + "Background only. ".repeat(600) + "\nObserved value: 739.";
  const resource = document("a", content);
  const { store } = storeFor([resource]);
  const expected = flatten(JSON.parse(resource.parsed!).nodes).flatMap(
    (node) => node.passages ?? [],
  );
  const scored: string[] = [];
  const result = await retrieveDocuments(
    store,
    actor,
    "What is the observed value?",
    "key",
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.questions.usefulness) {
        assert.equal(
          JSON.stringify(body.questions).includes("Background only"),
          false,
        );
        return choiceResponse(body);
      }
      scored.push(body.state);
      return Response.json({
        answers: {
          usefulness: {
            type: "score",
            score: body.state.includes("739") ? 3 : 1,
          },
        },
      });
    },
  );
  assert.equal(scored.length, expected.length);
  assert.equal(result.results.length, 1);
  assert.match(result.results[0].content, /739/);
});

test("conservative lookups do not recover rejected category routes", async () => {
  const { store } = storeFor([
    document("a", "# Outline\nSource facts."),
    document("b", "# Outline\nOther facts."),
  ]);
  const result = await retrieveDocuments(
    store,
    actor,
    "question",
    "key",
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(Boolean(body.questions.usefulness), false);
      return Response.json({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(
            ([id, question]: [string, any]) => [
              id,
              {
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map((key) => [
                    key,
                    Number(key === "none"),
                  ]),
                ),
              },
            ],
          ),
        ),
      });
    },
    [],
    undefined,
    { recoverRoutes: false },
  );
  assert.deepEqual(result.results, []);
});

test("category routes stay visible beside grouped top-level documents", async () => {
  const folder: Resource = {
    ...document("category", ""),
    kind: "folder",
    description: "Technical literature.",
  };
  const resources = [
    folder,
    document("nested", "# Section\nEvidence", folder.id),
    ...Array.from({ length: 32 }, (_, i) =>
      document(`root-${i}`, "# Section\nEvidence"),
    ),
  ];
  const { store } = storeFor(resources);
  let rootChecked = false;
  await retrieveDocuments(
    store,
    actor,
    "question",
    "key",
    async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!rootChecked && !body.questions.usefulness) {
        rootChecked = true;
        assert.ok(body.questions.route_0.criteria["category:category"]);
        assert.ok(
          Object.keys(body.questions.route_0.criteria).length <=
            retrievalLimits.menuSize + 1,
        );
      }
      return jevFetch(url, init);
    },
  );
  assert.equal(rootChecked, true);
});

test("sibling authorization runs concurrently within its bound and preserves menu order", async () => {
  const resources = Array.from({ length: 32 }, (_, i) =>
    document(`doc-${i}`, "# Section\nEvidence"),
  );
  const { store } = storeFor(resources);
  let active = 0;
  let peak = 0;
  let checks = 0;
  store.permission = async () => {
    checks++;
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return true;
  };
  let checked = false;
  const result = await retrieveDocuments(
    store,
    actor,
    "question",
    "key",
    async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.questions.usefulness) {
        for (const question of Object.values(body.questions) as any[]) {
          const choices = Object.keys(question.criteria);
          if (choices.includes("document:doc-0")) {
            assert.deepEqual(
              choices.filter((id) => id !== "none"),
              resources
                .slice(0, 16)
                .map((resource) => `document:${resource.id}`),
            );
            checked = true;
          }
        }
      }
      return jevFetch(url, init);
    },
  );
  assert.ok(checked);
  assert.ok(peak > 1);
  assert.ok(peak <= retrievalLimits.authorizationConcurrency);
  assert.ok(checks > resources.length);
  assert.ok(result.results.length > 0);
});

test("widening keeps unrelated passages out and respects the passage budget", async () => {
  const resources = Array.from({ length: 8 }, (_, i) =>
    document(`doc-${i}`, "# Outline\nBackground only."),
  );
  const { store } = storeFor(resources);
  let scored = 0;
  const result = await retrieveDocuments(
    store,
    actor,
    "Which value is stated?",
    "key",
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.questions.usefulness) return choiceResponse(body);
      scored++;
      return Response.json({
        answers: { usefulness: { type: "score", score: 1 } },
      });
    },
    [],
    undefined,
    { maxPassages: 3 },
  );
  assert.equal(scored, 3);
  assert.deepEqual(result.results, []);
  assert.equal(result.limited, true);
});

test("large frontier requests stay bounded and recheck branches between requests", async () => {
  let revoked = false;
  const requests: any[] = [];
  const roots: RouteNode<never>[] = ["a", "b", "c", "d"].map((id) => ({
    id,
    describe: async () => id,
    children: Array.from({ length: retrievalLimits.menuSize }, (_, i) => ({
      id: `${id}-${i}`,
      children: [],
      describe: async () =>
        id === "b" && revoked ? undefined : `${id} `.repeat(600),
    })),
  }));
  const traversal = createTraversal(
    roots,
    createJev("key", async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (body.questions.route_0.criteria["a-0"]) revoked = true;
      assert.ok(
        String(init?.body).length < retrievalLimits.routingCharacters + 3000,
      );
      return choiceResponse(body);
    }),
    "question",
  );
  await traversal.walk();
  assert.ok(requests.length >= 4);
  assert.equal(JSON.stringify(requests.slice(1)).includes('"b-0"'), false);
});

test("large menus use one hierarchy of distributions rather than independently normalized batches", async () => {
  const resources = Array.from({ length: 260 }, (_, i) =>
    document(`doc-${i}`, "# Section\nEvidence"),
  );
  const { store } = storeFor(resources);
  let calls = 0;
  const result = await retrieveDocuments(
    store,
    actor,
    "question",
    "key",
    async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!body.questions.usefulness) {
        calls++;
        for (const question of Object.values(body.questions) as any[])
          assert.ok(
            Object.keys(question.criteria).length <=
              retrievalLimits.menuSize + 1,
          );
        if (calls === 1)
          assert.ok(
            Object.keys(body.questions.route_0.criteria).some((key) =>
              key.includes("group"),
            ),
          );
      }
      return jevFetch(url, init);
    },
  );
  assert.ok(result.results.length > 0);
  assert.ok(calls >= 2);
});

test("missing keys, invalid distributions, and invalid scores fail without lexical fallback", async () => {
  const { store } = storeFor([
    document("a", "# A\nEvidence"),
    document("b", "# B\nEvidence"),
  ]);
  await assert.rejects(
    retrieveDocuments(store, actor, "Evidence", undefined, jevFetch),
    /Connect TypeSafe/,
  );
  const jev = createJev("key", async () =>
    Response.json({
      answers: { route_0: { probabilities: { a: 1, b: 1, none: 0 } } },
    }),
  );
  await assert.rejects(
    jev.choose("question", [
      {
        id: "root",
        choices: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
      },
    ]),
    /invalid routing distribution/,
  );
  await assert.rejects(
    createJev("key", async () =>
      Response.json({ answers: { usefulness: { type: "score", score: "3" } } }),
    ).score("question", "Evidence"),
    /invalid score/,
  );
});

test("nested categories remain a real hierarchy and unauthorized sources never enter routing prompts", async () => {
  const folder = (id: string, parent_id: string | null): Resource => ({
    ...document(id, ""),
    kind: "folder",
    parent_id,
    description: id,
  });
  const resources = [
    folder("outer", null),
    folder("inner", "outer"),
    document("visible", "# Section\nEvidence", "inner"),
    document("restricted", "# PRIVATE\nPrivate facts", "inner"),
  ];
  const { store } = storeFor(resources, new Set(["outer", "inner", "visible"]));
  const bodies: unknown[] = [];
  const result = await retrieveDocuments(
    store,
    actor,
    "question",
    "key",
    async (url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jevFetch(url, init);
    },
  );
  assert.deepEqual(
    result.trace
      .filter((step) => step.stage === "category")
      .map((step) => step.label),
    ["outer", "inner"],
  );
  assert.equal(JSON.stringify(bodies).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(bodies).includes("restricted"), false);
});

test("access revoked during scoring excludes results and retrieval paths", async () => {
  const { store, allowed } = storeFor([document("a", "# A\nEvidence")]);
  const result = await retrieveDocuments(
    store,
    actor,
    "question",
    "key",
    async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.questions.usefulness) allowed.clear();
      return jevFetch(url, init);
    },
  );
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.trace, []);
});
