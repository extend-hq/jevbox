import type { ParsedBlock } from "../shared/parsed-blocks";
import type { Store } from "./db";
import { flatten, type ParsedDocument } from "./indexing";
import type { RetrievedSource } from "./retrieval";

export const citationSourceKey = (source: RetrievedSource) =>
  JSON.stringify([
    source.documentId,
    source.nodeId,
    source.passageId,
    source.page,
    source.endPage,
    source.blockIds,
    source.content,
  ]);

export function createCitationLocator(store: Store) {
  const documents = new Map<string, Promise<ParsedBlock[]>>();
  return async (sources: RetrievedSource[]) => {
    const blocks = new Map<string, ParsedBlock[]>();
    await Promise.all(
      [
        ...new Set(
          sources
            .filter((source) => source.blockIds.length)
            .map((source) => source.documentId),
        ),
      ].map(async (id) => {
        let pending = documents.get(id);
        if (!pending) {
          pending = store
            .one<{ parsed: string | null }>(
              "SELECT parsed FROM resources WHERE id=?",
              id,
            )
            .then((row) => {
              if (!row?.parsed) return [];
              const parsed = JSON.parse(row.parsed) as ParsedDocument;
              const saved = parsed.blocks?.length
                ? parsed.blocks
                : flatten(parsed.nodes).flatMap((node) => node.blocks ?? []);
              return [
                ...new Map(saved.map((block) => [block.id, block])).values(),
              ];
            });
          documents.set(id, pending);
        }
        blocks.set(id, await pending);
      }),
    );
    for (const source of sources) {
      const byId = new Map(
        blocks.get(source.documentId)?.map((block) => [block.id, block]),
      );
      source.citationBlocks = source.blockIds.flatMap((id) => {
        const block = byId.get(id);
        return block
          ? [{ id: block.id, page: block.page, type: block.type }]
          : [];
      });
    }
    return blocks;
  };
}

export function citationPromptSource(
  source: RetrievedSource,
  citation: number,
  blocks: ParsedBlock[] = [],
) {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  const excerpt = (block: ParsedBlock | undefined) => {
    if (!block) return undefined;
    const text = normalize(block.content);
    if (normalize(source.content).includes(text))
      return block.content.slice(0, 2000);
    return (
      source.content
        .split(/(?<=<\/tr>)|\n+/)
        .filter((part) => part.trim() && text.includes(normalize(part)))
        .join("\n")
        .slice(0, 2000) || undefined
    );
  };
  return {
    citation,
    reference: `[${citation}]`,
    title: source.name,
    documentId: source.documentId,
    nodeId: source.nodeId,
    section: source.title,
    sectionPath: source.sectionPath,
    sourcePath: [
      source.name,
      ...(source.sectionPath?.length ? source.sectionPath : [source.title]),
    ].join(" › "),
    page: source.page,
    endPage: source.endPage,
    text: source.content,
    blocks: source.citationBlocks?.map((target, index) => {
      const block = byId.get(target.id);
      return {
        reference: `[${citation}.${index + 1}]`,
        blockId: target.id,
        page: target.page,
        type: target.type,
        text: excerpt(block),
        boundingBox: block?.boundingBox,
      };
    }),
  };
}
