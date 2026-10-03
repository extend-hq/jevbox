export type SpatialEntry = {
  path: string;
  name?: string;
  kind: "folder" | "file";
  parentPath?: string;
};
export type SpatialNode = {
  path: string;
  parent: string | null;
  name: string;
  kind: "root" | "folder" | "file";
  position: [number, number, number];
  depth: number;
  descendants: number;
  /** Stable 0–1 value per node, used to desynchronise floating motion. */
  seed: number;
};

/** Distance between neighbouring documents on a ring, in world units. */
const SPATIAL_DOCUMENT_SPACING = 5.5;
/** Vertical drop from a folder to the level its contents hang on. */
const SPATIAL_LEVEL_DROP = 8;
const FIRST_RING = 4;
const RING_GAP = 5;
const RING_STEP_DOWN = 1.5;
const BRANCH_GAP = 6;

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Concentric rings of documents under a folder. A lone document hangs straight
 * below; small sets huddle on one ring; larger ones fill outward rings that
 * step down slightly, giving each folder a shallow bowl of pages.
 */
function rings(files: number) {
  const result: { radius: number; count: number }[] = [];
  if (files === 1) return [{ radius: 0, count: 1 }];
  let remaining = files;
  for (let k = 0; remaining > 0; k++) {
    const radius = FIRST_RING + k * RING_GAP;
    const capacity = Math.max(
      3,
      Math.floor((2 * Math.PI * radius) / SPATIAL_DOCUMENT_SPACING),
    );
    const count = Math.min(remaining, capacity);
    result.push({
      radius:
        k === 0
          ? Math.max(2.6, (count * SPATIAL_DOCUMENT_SPACING) / (2 * Math.PI))
          : radius,
      count,
    });
    remaining -= count;
  }
  return result;
}

/**
 * Lays a library out as a cone tree: every folder hangs its documents on rings
 * one level below it, and its sub-folders branch outward on the same level as
 * the apexes of their own cones, spaced so sibling subtrees never overlap.
 */
export function layoutSpatialTree(
  entries: readonly SpatialEntry[],
  scope = "",
) {
  const folders = new Map(
    entries
      .filter((entry) => entry.kind === "folder")
      .map((entry) => [entry.path, entry]),
  );
  const children = new Map<string, SpatialEntry[]>();
  for (const entry of entries) {
    if (entry.path === scope || (scope && !entry.path.startsWith(scope)))
      continue;
    const trimmed = entry.path.replace(/\/$/, "");
    const parent =
      entry.parentPath ?? trimmed.slice(0, trimmed.lastIndexOf("/") + 1);
    if (parent && parent !== scope && !folders.has(parent)) continue;
    const list = children.get(parent) ?? [];
    list.push(entry);
    children.set(parent, list);
  }
  const counts = new Map<string, number>();
  function count(path: string): number {
    const existing = counts.get(path);
    if (existing !== undefined) return existing;
    const total = (children.get(path) ?? []).reduce(
      (sum, entry) => sum + (entry.kind === "file" ? 1 : count(entry.path)),
      0,
    );
    counts.set(path, total);
    return total;
  }
  const split = (path: string) => {
    const list = children.get(path) ?? [];
    return {
      files: list.filter((entry) => entry.kind === "file"),
      branches: list.filter((entry) => entry.kind === "folder"),
    };
  };
  const ringOuter = (files: number) =>
    files ? (rings(files).at(-1)?.radius ?? 0) + 1.5 : 0;
  /** Distance from a folder to the centres of its sub-folder cones. */
  function branchDistance(path: string, depth: number) {
    const { files, branches } = split(path);
    if (!branches.length) return 0;
    if (branches.length === 1 && !files.length) return 0;
    const circumference = branches.reduce(
      (sum, entry) => sum + 2 * footprint(entry.path, depth + 1) + BRANCH_GAP,
      0,
    );
    return Math.max(
      ringOuter(files.length) +
        BRANCH_GAP +
        Math.max(...branches.map((entry) => footprint(entry.path, depth + 1))),
      circumference / (2 * Math.PI),
    );
  }
  const footprints = new Map<string, number>();
  /** Horizontal radius a folder's whole subtree needs. */
  function footprint(path: string, depth: number): number {
    const cached = footprints.get(path);
    if (cached !== undefined) return cached;
    const { files, branches } = split(path);
    let radius = Math.max(2, ringOuter(files.length));
    if (branches.length)
      radius = Math.max(
        radius,
        branchDistance(path, depth) +
          Math.max(
            ...branches.map((entry) => footprint(entry.path, depth + 1)),
          ),
      );
    footprints.set(path, radius);
    return radius;
  }
  const nameOf = (entry: SpatialEntry) =>
    entry.name ?? entry.path.split("/").filter(Boolean).at(-1) ?? entry.path;
  const nodes: SpatialNode[] = [
    {
      path: scope,
      parent: null,
      kind: "root",
      name:
        folders.get(scope)?.name ??
        scope.split("/").filter(Boolean).at(-1) ??
        "Library",
      position: [0, 0, 0],
      depth: 0,
      descendants: count(scope),
      seed: hash(scope),
    },
  ];
  function visit(path: string, depth: number, apex: readonly number[]) {
    const { files, branches } = split(path);
    const twist = hash(path) * Math.PI * 2;
    // The scope itself isn't drawn, so its contents sit at its own height.
    const level = depth === 1 ? apex[1] : apex[1] - SPATIAL_LEVEL_DROP;
    const layers = rings(files.length);
    let layer = 0;
    let first = 0;
    files.forEach((entry, i) => {
      while (i - first >= layers[layer].count) first += layers[layer++].count;
      const { count: slots, radius } = layers[layer];
      const theta = twist + layer * 0.5 + ((i - first) / slots) * Math.PI * 2;
      nodes.push({
        path: entry.path,
        parent: path,
        name: nameOf(entry),
        kind: "file",
        position: [
          apex[0] + Math.cos(theta) * radius,
          level - layer * RING_STEP_DOWN,
          apex[2] + Math.sin(theta) * radius,
        ],
        depth,
        descendants: 0,
        seed: hash(entry.path),
      });
    });
    if (!branches.length) return;
    const distance = branchDistance(path, depth);
    const arcs = branches.map(
      (entry) => 2 * footprint(entry.path, depth + 1) + BRANCH_GAP,
    );
    const total = arcs.reduce((sum, arc) => sum + arc, 0);
    let angle = twist + Math.PI / Math.max(2, branches.length);
    branches.forEach((entry, i) => {
      const theta = angle + (arcs[i] / total) * Math.PI;
      angle += (arcs[i] / total) * Math.PI * 2;
      const position: [number, number, number] = [
        apex[0] + Math.cos(theta) * distance,
        level,
        apex[2] + Math.sin(theta) * distance,
      ];
      nodes.push({
        path: entry.path,
        parent: path,
        name: nameOf(entry),
        kind: "folder",
        position,
        depth,
        descendants: count(entry.path),
        seed: hash(entry.path),
      });
      visit(entry.path, depth + 1, position);
    });
  }
  visit(scope, 1, [0, 0, 0]);
  return nodes;
}
