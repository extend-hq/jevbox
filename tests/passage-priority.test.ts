import assert from "node:assert/strict";
import { test } from "node:test";
import { prioritizePassages } from "../server/passage-priority";

test("late exact qualifiers reach scoring without dropping any source", () => {
  const passages = [
    { id: "first", content: "Revenue was 42 in 2022." },
    { id: "background", content: "General background. ".repeat(300) },
    {
      id: "last",
      content: "<table><tr><td>Revenue 2023</td><td>79</td></tr></table>",
    },
  ];
  const result = prioritizePassages(passages, "What was revenue in 2023?");
  assert.equal(result[0], passages[2]);
  assert.equal(result.length, passages.length);
  assert.deepEqual(new Set(result), new Set(passages));
  assert.equal(passages[0].id, "first");
});

test("unmatched and empty queries preserve source order", () => {
  const passages = [
    { content: "Opening discussion" },
    { content: "Closing notes" },
  ];
  assert.deepEqual(prioritizePassages(passages, "unrelated"), passages);
  assert.deepEqual(prioritizePassages(passages, ""), passages);
});
