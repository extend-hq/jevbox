import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createJsonFoldingModel,
  createVisibleJsonDocument,
  mapVisibleJsonLineToOriginal,
} from "../src/lib/json-folding";

test("JSON folding ignores delimiters inside escaped strings and preserves original line positions", () => {
  const source = JSON.stringify(
    {
      text: 'braces { [ and quote " escaped \\',
      rows: [{ value: 1 }, { value: 2 }],
      tail: true,
    },
    null,
    2,
  );
  const model = createJsonFoldingModel(source);
  assert.equal(model.ranges.length, 4);
  const array = model.ranges.find((range) => range.kind === "array")!;
  const folded = createVisibleJsonDocument(source, model, new Set([array.key]));
  assert.ok(folded.lineCount < model.lineCount);
  assert.equal(folded.collapsedFolds.length, 1);
  const tailLine = folded.contents
    .split("\n")
    .findIndex((line) => line.includes('"tail"'));
  assert.equal(
    mapVisibleJsonLineToOriginal(folded, tailLine),
    source.split("\n").findIndex((line) => line.includes('"tail"')),
  );
  assert.equal(
    createVisibleJsonDocument(source, model, new Set()).contents,
    source,
  );
});

test("folding an ancestor hides nested folds without losing their state", () => {
  const source = JSON.stringify({ items: [{ deep: { answer: 3 } }] }, null, 2);
  const model = createJsonFoldingModel(source);
  const nested = new Set(
    model.ranges.filter((range) => range.depth >= 1).map((range) => range.key),
  );
  const folded = createVisibleJsonDocument(source, model, nested);
  assert.equal(folded.collapsedFolds.length, 1);
  const outer = model.ranges.find((range) => range.depth === 1)!;
  nested.delete(outer.key);
  const expanded = createVisibleJsonDocument(source, model, nested);
  assert.equal(expanded.collapsedFolds.length, 1);
  assert.ok(expanded.collapsedFolds[0].range.depth > outer.depth);
});
