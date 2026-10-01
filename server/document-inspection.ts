import {
  resourceAccess,
  HttpError,
  type Actor,
  type Resource,
  type Store,
} from "./db";
import { flatten, withLayoutSections, type ParsedDocument } from "./indexing";
import type { RetrievedSource } from "./retrieval";

export type DocumentInspection = {
  documentId: string;
  pages?: number[];
  term?: string;
};

export async function inspectDocument(
  store: Store,
  actor: Actor,
  input: DocumentInspection,
  signal?: AbortSignal,
): Promise<RetrievedSource[]> {
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
    sectionsTruncated: nodes.length > 80,
    sections: nodes
      .slice(0, 80)
      .map(({ title, page, endPage }) => ({
        title: title.slice(0, 120),
        page,
        endPage,
      })),
  };
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
        "Case-insensitive literal matches in the complete extracted text, including matches inside longer phrases.",
    };
  }
  const source = (
    page: number,
    title: string,
    content: string,
    blockIds: string[],
    passageId: string,
  ): RetrievedSource => ({
    documentId: document.id,
    name: document.name,
    nodeId:
      nodes.find((node) => node.page <= page && node.endPage >= page)?.id ??
      nodes[0]?.id ??
      "",
    passageId,
    title,
    page,
    endPage: page,
    content,
    blockIds,
    score: 3,
    routeScore: 1,
  });
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
  for (const page of [...new Set(input.pages ?? [])].slice(0, 5)) {
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
