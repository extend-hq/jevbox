import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndex } from "../server/indexing";
import { buildSectionPreviews } from "../server/routing-preview";
import { retrieveDocuments } from "../server/retrieval";
import type { Actor, Resource, Store } from "../server/db";
import { choiceResponse, isScoreRequest, scoreResponse } from "./model-tools";

test("routing samples expose late query evidence through its parent without altering extraction", () => {
  const parsed = buildIndex(
    [
      {
        content:
          "# Overview\nOpening context describes the study population.\n## Methods\n" +
          "Participants were recruited at several sites. ".repeat(80) +
          "\n\nThe cobalt intervention reduced the adverse event rate by 23 percent.\n" +
          "## Discussion\nLimitations include the short follow-up period.",
      },
    ],
    "text",
  );
  const before = JSON.stringify(parsed);
  const previews = buildSectionPreviews(
    parsed.nodes,
    "What effect did the cobalt intervention have on adverse events?",
  );
  assert.match(
    previews.get(parsed.nodes[0].id)!,
    /cobalt intervention reduced/,
  );
  assert.match(previews.get(parsed.nodes[0].children[0].id)!, /23 percent/);
  assert.match(previews.get(parsed.nodes[0].id)!, /Opening context/);
  assert.equal(JSON.stringify(parsed), before);
  for (const preview of previews.values()) assert.ok(preview.length <= 1200);
});

test("routing samples cover distinct branches and preserve negation in source wording", () => {
  const parsed = buildIndex(
    [
      {
        content:
          "# Findings\n## First\nThe intervention did not improve survival in the observed population.\n" +
          "## Second\nHospital admissions decreased during the follow-up period.\n" +
          "## Third\nFollow-up assessments used telephone interviews with participants.",
      },
    ],
    "text",
  );
  const preview = buildSectionPreviews(parsed.nodes, "Compare outcomes").get(
    parsed.nodes[0].id,
  )!;
  assert.match(preview, /did not improve survival/);
  assert.match(preview, /Hospital admissions decreased/);
  assert.match(preview, /telephone interviews/);
});

test("routing samples remain bounded for long headings and deduplicate repeated excerpts", () => {
  const sentence =
    "Distinctive measurement uncertainty was reported for every observation.";
  const parsed = buildIndex(
    [
      {
        content: `# ${"Heading ".repeat(200)}\n${sentence}\n\n${sentence}\n\n${sentence}`,
      },
    ],
    "text",
  );
  const preview = buildSectionPreviews(
    parsed.nodes,
    "measurement uncertainty",
  ).get(parsed.nodes[0].id)!;
  assert.ok(preview.length <= 1200);
  assert.equal(preview.split(sentence).length - 1, 1);
  assert.match(preview, /Source excerpts \(partial\)/);
});

test("routing samples find Unicode query terms in long unsplit text", () => {
  const parsed = buildIndex(
    [
      {
        content:
          "# Measurements\n" +
          "Background context ".repeat(500) +
          "énergie quantique increased under the revised measurement protocol",
      },
    ],
    "text",
  );
  const previews = buildSectionPreviews(parsed.nodes, "énergie quantique");
  assert.match(previews.get(parsed.nodes[0].id)!, /énergie quantique/);
});

test("default routing samples source excerpts and rechecks authorization", async () => {
  const parsed = buildIndex(
    [
      {
        content:
          "# Overview\nPublic measurement results establish the observed value.",
      },
    ],
    "text",
  );
  const resources = [
    {
      id: "allowed",
      org_id: "org",
      kind: "document",
      status: "ready",
      name: "Allowed",
      parent_id: null,
      parsed: JSON.stringify(parsed),
    },
    {
      id: "blocked",
      org_id: "org",
      kind: "document",
      status: "ready",
      name: "Blocked",
      parent_id: null,
      parsed: JSON.stringify(
        buildIndex(
          [
            {
              content:
                "# Overview\nRestricted body wording must remain private.",
            },
          ],
          "text",
        ),
      ),
    },
  ] as Resource[];
  const actor = {
    orgId: "org",
    userId: "user",
    role: "admin",
    token: "",
  } as Actor;
  let allowed = true;
  let sawPreview = false;
  const store = {
    all: async () => resources,
    one: async (_sql: string, id: string) =>
      resources.find((resource) => resource.id === id),
    permission: async (_actor: Actor, _kind: string, id: string) =>
      id === "allowed" && allowed,
  } as unknown as Store;
  const result = await retrieveDocuments(
    store,
    actor,
    "observed value",
    "key",
    async (_url, init) => {
      const request = String(init?.body);
      assert.equal(request.includes("Restricted body wording"), false);
      const body = JSON.parse(request);
      if (
        !isScoreRequest(body) &&
        request.includes("Source excerpts (partial)")
      ) {
        sawPreview = true;
        assert.match(request, /Public measurement results/);
        allowed = false;
      }
      return isScoreRequest(body)
        ? scoreResponse(body, 3)
        : choiceResponse(body);
    },
  );
  assert.equal(sawPreview, true);
  assert.equal(result.results.length, 0);
  assert.ok(!result.trace.some((step) => step.resourceId === "allowed"));
});
