import {
  resourceAccess,
  HttpError,
  type Actor,
  type Resource,
  type Store,
} from "./db";
import { flatten, withLayoutSections, type ParsedDocument } from "./indexing";
import type { RetrievedSource } from "./retrieval";
import { z } from "zod";

export const documentInspectionSchema = z
  .object({
    documentId: z.string().min(1).max(128),
    pages: z.array(z.number().int().positive()).max(5).optional(),
    term: z.string().trim().min(1).max(200).optional(),
    outlineOffset: z.number().int().min(0).max(1_000_000).optional(),
    includeVisuals: z.boolean().optional(),
    visualOffset: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
export type DocumentInspection = z.infer<typeof documentInspectionSchema>;

function inventoryPage<T>(items: T[], offset: number, characters: number) {
  const selected: T[] = [];
  let used = 0;
  for (const item of items.slice(offset, offset + 80)) {
    const length = JSON.stringify(item).length;
    if (selected.length && used + length > characters) break;
    selected.push(item);
    used += length;
  }
  const next = offset + selected.length;
  return { items: selected, next: next < items.length ? next : null };
}

export async function inspectDocument(
  store: Store,
  actor: Actor,
  input: DocumentInspection,
  signal?: AbortSignal,
): Promise<RetrievedSource[]> {
  input = documentInspectionSchema.parse(input);
  signal?.throwIfAborted();
  if (!(await resourceAccess(store, actor, input.documentId)))
    throw new HttpError(404, "Document not found");
  const document = await store.one<Resource>(
    "SELECT * FROM resources WHERE id=? AND org_id=? AND kind='document'",
    input.documentId,
    actor.orgId,
  );
  if (!document || document.status !== "ready" || !document.parsed)
    throw new HttpError(409, "Wait for the document to finish indexing");
  const parsed: ParsedDocument = withLayoutSections(
    JSON.parse(document.parsed),
  );
  const nodes = flatten(parsed.nodes);
  const parents = new Map<string, (typeof nodes)[number]>();
  for (const node of nodes)
    for (const child of node.children) parents.set(child.id, node);
  const sectionPath = (node: (typeof nodes)[number]) => {
    const titles = [node.title];
    let parent = parents.get(node.id);
    while (parent && titles.length < 8) {
      titles.unshift(parent.title);
      parent = parents.get(parent.id);
    }
    return titles;
  };
  const requestedPages = [...new Set(input.pages ?? [])];
  const outline = nodes
    .filter(
      (node) =>
        !requestedPages.length ||
        requestedPages.some(
          (page) => node.page <= page && node.endPage >= page,
        ),
    )
    .map((node) => ({
      id: node.id,
      title: node.title.slice(0, 500),
      titleTruncated: node.title.length > 500,
      parentId: parents.get(node.id)?.id ?? null,
      parentTitle: parents.get(node.id)?.title.slice(0, 500) ?? null,
      page: node.page,
      endPage: node.endPage,
      children: node.children.length,
    }));
  const outlineOffset = input.outlineOffset ?? 0;
  const sections = inventoryPage(outline, outlineOffset, 12000);
  const text = (
    parsed.blocks.length
      ? parsed.blocks.map((block) => block.content).join("\n")
      : parsed.markdown
  )
    .replace(/<[^>]*>/g, " ")
    .replace(/\u00ad/g, "")
    .normalize("NFKC");
  const abbreviations = new Map<string, number>();
  for (const match of text.matchAll(/\b[A-Z]{2,8}(?:-[A-Z0-9]+)*\b/g)) {
    if (
      [
        "THE",
        "AND",
        "FOR",
        "WITH",
        "FROM",
        "THIS",
        "THAT",
        "NOT",
        "ARE",
        "WAS",
        "WERE",
        "ALL",
        "NEW",
        "BY",
        "IN",
        "OF",
        "ON",
        "TO",
        "AS",
        "AT",
        "IS",
        "IT",
        "OR",
        "AN",
        "BE",
      ].includes(match[0])
    )
      continue;
    abbreviations.set(match[0], (abbreviations.get(match[0]) ?? 0) + 1);
  }
  const statistics: Record<string, unknown> = {
    document: document.name,
    pages: parsed.pages,
    extractedWordCount: text.trim().split(/\s+/u).filter(Boolean).length,
    figures: parsed.blocks.filter((block) => block.type === "figure").length,
    tables: parsed.blocks.filter((block) => block.type === "table").length,
    topAbbreviations: [...abbreviations]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term, count]) => ({ term, count })),
    countingMethod:
      "Counts use the complete extracted text or parsed blocks, not sampled search excerpts. OCR and layout conversion can differ from the original visual document. Pages are PDF page positions, not printed page numbers.",
    totalIndexedSections: nodes.length,
    outlinePages: requestedPages,
    totalOutlineSections: outline.length,
    outlineOffset,
    nextOutlineOffset: sections.next,
    sectionsTruncated: outlineOffset > 0 || sections.next !== null,
    sections: sections.items,
  };
  if (input.includeVisuals) {
    const pageBlocks = new Map<number, typeof parsed.blocks>();
    const positions = new Map<string, number>();
    for (const block of parsed.blocks) {
      const blocks = pageBlocks.get(block.page) ?? [];
      positions.set(block.id, blocks.length);
      blocks.push(block);
      pageBlocks.set(block.page, blocks);
    }
    const visuals = parsed.blocks
      .filter(
        (block) =>
          ["figure", "table"].includes(block.type) &&
          (!requestedPages.length || requestedPages.includes(block.page)),
      )
      .map((block) => {
        const blocks = pageBlocks.get(block.page)!;
        const position = positions.get(block.id)!;
        return {
          id: block.id,
          page: block.page,
          type: block.type,
          figureType:
            block.type === "figure"
              ? (block.figureType ??
                block.content.match(
                  /<figure\b[^>]*\btype=["']([^"']+)["']/i,
                )?.[1] ??
                null)
              : null,
          extractedContent: block.content.slice(0, 1200),
          contentTruncated: block.content.length > 1200,
          nearbyText: blocks
            .slice(Math.max(0, position - 2), position + 4)
            .filter((nearby) => !["figure", "table"].includes(nearby.type))
            .map((nearby) => nearby.content.slice(0, 500))
            .join("\n")
            .slice(0, 1500),
        };
      });
    const visualOffset = input.visualOffset ?? 0;
    const inventory = inventoryPage(visuals, visualOffset, 8000);
    statistics.visualInventory = {
      total: visuals.length,
      offset: visualOffset,
      nextVisualOffset: inventory.next,
      items: inventory.items,
      method:
        "An inventory of extracted figure and table blocks with nearby text. Nearby text is page context, not a verified caption or attribution. Figures can include logos and images. Captions and visual relationships are unverified parser output; missing extraction does not establish absence from the original.",
    };
  }
  if (input.term) {
    const needle = input.term.normalize("NFKC").toLocaleLowerCase();
    const haystack = text.toLocaleLowerCase();
    let count = 0,
      offset = 0;
    while ((offset = haystack.indexOf(needle, offset)) !== -1) {
      count++;
      offset += needle.length;
    }
    statistics.termOccurrences = {
      term: input.term,
      count,
      method:
        "Case-insensitive literal matches in the complete extracted text, including matches inside longer phrases. This is not a count of distinct objects, charts, tables, or categories.",
    };
  }
  const source = (
    page: number,
    title: string,
    content: string,
    blockIds: string[],
    passageId: string,
  ): RetrievedSource => {
    const node = nodes
      .filter((node) => node.page <= page && node.endPage >= page)
      .toSorted(
        (a, b) =>
          a.endPage - a.page - (b.endPage - b.page) ||
          sectionPath(b).length - sectionPath(a).length,
      )[0];
    return {
      documentId: document.id,
      name: document.name,
      nodeId: node?.id ?? nodes[0]?.id ?? "",
      sectionPath: node ? sectionPath(node) : undefined,
      passageId,
      title,
      page,
      endPage: page,
      content,
      blockIds,
      score: 3,
      routeScore: 1,
    };
  };
  const result = [
    source(
      1,
      "Document statistics and outline",
      JSON.stringify(statistics),
      [],
      "inspection-statistics",
    ),
  ];
  let remainingCharacters = Math.max(0, 24000 - result[0].content.length);
  for (const page of requestedPages) {
    if (!Number.isInteger(page) || page < 1 || page > parsed.pages) {
      result.push(
        source(
          1,
          "Page availability",
          `The document contains ${parsed.pages} pages. Page ${page} does not exist.`,
          [],
          `inspection-missing-page-${page}`,
        ),
      );
      continue;
    }
    const blocks = parsed.blocks.filter((block) => block.page === page);
    const content = blocks.length
      ? blocks.map((block) => block.content).join("\n\n")
      : nodes
          .filter((node) => node.page === page)
          .map((node) => node.content)
          .join("\n\n");
    const budget = Math.min(16000, remainingCharacters);
    const excerpt =
      content.length > budget
        ? `${content.slice(0, budget)}\n[Page excerpt truncated]`
        : content;
    remainingCharacters -= Math.min(budget, content.length);
    result.push(
      source(
        page,
        `Page ${page}`,
        excerpt,
        blocks.map((block) => block.id),
        `inspection-page-${page}`,
      ),
    );
  }
  signal?.throwIfAborted();
  if (!(await resourceAccess(store, actor, document.id)))
    throw new HttpError(404, "Document not found");
  return result;
}
