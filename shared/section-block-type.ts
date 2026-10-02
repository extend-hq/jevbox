import type { ParsedBlock } from "./parsed-blocks";

export function sectionBlockType(node: {
  content: string;
  blocks: Pick<ParsedBlock, "content" | "type">[];
}) {
  const content = node.content.trimStart();
  const block = node.blocks.find(
    (block) => block.content.trim() && content.startsWith(block.content.trim()),
  );
  const type = block?.type;
  const normalized = type?.toLowerCase().replace(/[ -]+/g, "_");
  if (type && normalized !== "heading" && normalized !== "section_heading")
    return type;
  const heading = content.match(/^(#{1,6})[\t ]+/);
  if (heading) return heading[1].length === 1 ? "heading" : "section_heading";
  return type ?? "section";
}
