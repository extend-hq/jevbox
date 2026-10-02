import {
  blockHighlightArea,
  type ParsedBlock,
} from "../../shared/parsed-blocks";
import type { IndexNode } from "./api";

export type SpatialOutlineRow = {
  id: string;
  title: string;
  page: number;
  depth: number;
  parent: number;
  blocks: ParsedBlock[];
};

export function spatialOutlineRows(
  structure: { sections: IndexNode[]; blocks: ParsedBlock[] } | null,
  maxRows = 72,
  maxDepth = 3,
) {
  const rows: SpatialOutlineRow[] = [];
  const byId = new Map(structure?.blocks.map((block) => [block.id, block]));
  const collect = (node: IndexNode): ParsedBlock[] => {
    const blocks = node.blocks.length
      ? node.blocks
      : node.children.flatMap(collect);
    return [
      ...new Map(
        blocks.map((block) => [block.id, byId.get(block.id) ?? block]),
      ).values(),
    ];
  };
  const visit = (nodes: IndexNode[], depth: number, parent: number) => {
    for (const node of nodes) {
      if (rows.length >= maxRows) return;
      const index = rows.length;
      rows.push({
        id: node.id,
        title: node.title || "Untitled section",
        page: node.page,
        depth,
        parent,
        blocks: collect(node),
      });
      if (depth < maxDepth) visit(node.children, depth + 1, index);
    }
  };
  if (structure?.sections.length) visit(structure.sections, 0, -1);
  else {
    const pages = new Map<number, ParsedBlock[]>();
    for (const block of structure?.blocks ?? [])
      pages.set(block.page, [...(pages.get(block.page) ?? []), block]);
    for (const [page, blocks] of [...pages].sort(([a], [b]) => a - b)) {
      if (rows.length >= maxRows) break;
      rows.push({
        id: `page-${page}`,
        title: `Page ${page}`,
        page,
        depth: 0,
        parent: -1,
        blocks,
      });
    }
  }
  return rows;
}

export function spatialBlockCrop(block: ParsedBlock, rotation = 0) {
  const area = blockHighlightArea(block, rotation);
  return (
    area && {
      left: area.left / 100,
      top: area.top / 100,
      width: area.width / 100,
      height: area.height / 100,
    }
  );
}

export const SPATIAL_BLOCK_BATCH = 12;
