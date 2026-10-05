import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchFiltersSchema,
  matchesSearchFilters,
} from "../shared/search-filters";
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
