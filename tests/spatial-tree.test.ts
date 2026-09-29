import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutSpatialTree, type SpatialEntry } from "../src/lib/spatial-tree";

test("spatial layout includes every supplied document and connects each node to its parent", () => {
  const entries: SpatialEntry[] = [
    { kind: "folder", path: "A/" },
    { kind: "folder", path: "A/B/" },
    { kind: "folder", path: "C/" },
    ...Array.from({ length: 250 }, (_, i): SpatialEntry => ({
      kind: "file",
      path: `${i % 2 ? "A/B" : "C"}/${i}.pdf`,
    })),
  ];
  const nodes = layoutSpatialTree(entries);
  assert.equal(nodes.length, entries.length + 1);
  assert.equal(nodes[0].descendants, 250);
  const paths = new Set(nodes.map((node) => node.path));
  const points = new Set(
    nodes
      .filter((node) => node.kind === "file")
      .map((node) => node.position.join(",")),
  );
  assert.equal(points.size, 250);
  for (const node of nodes.slice(1)) {
    assert.ok(paths.has(node.parent!));
    assert.ok(node.position.every(Number.isFinite));
  }
  assert.equal(nodes.find((node) => node.path === "A/")?.descendants, 125);
  assert.deepEqual(nodes, layoutSpatialTree(entries));
});

test("scoping a branch excludes other branches and keeps direct child relationships", () => {
  const entries: SpatialEntry[] = [
    { kind: "folder", path: "A/", name: "Branch" },
    { kind: "folder", path: "A/B/" },
    { kind: "file", path: "A/B/one.pdf" },
    { kind: "file", path: "A/two.pdf" },
    { kind: "folder", path: "C/" },
    { kind: "file", path: "C/three.pdf" },
  ];
  const nodes = layoutSpatialTree(entries, "A/");
  assert.equal(nodes[0].name, "Branch");
  assert.equal(nodes[0].descendants, 2);
  assert.deepEqual(
    new Set(nodes.map((node) => node.path)),
    new Set(["A/", "A/B/", "A/B/one.pdf", "A/two.pdf"]),
  );
  assert.equal(nodes.find((node) => node.path === "A/two.pdf")?.parent, "A/");
});

test("empty branches and root-level documents have finite layouts", () => {
  assert.deepEqual(layoutSpatialTree([])[0].position, [0, 0, 0]);
  const nodes = layoutSpatialTree([
    { kind: "folder", path: "A/" },
    { kind: "file", path: "one.pdf" },
  ]);
  assert.equal(nodes.length, 3);
  assert.equal(nodes.find((node) => node.path === "one.pdf")?.parent, "");
  assert.ok(nodes.every((node) => node.position.every(Number.isFinite)));
});
