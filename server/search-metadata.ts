import { flatten, type IndexNode, type ParsedDocument } from "./indexing";

export function normalizeIndexText(content: string) {
  return content
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\u00ad/g, "")
    .normalize("NFKC")
    .replace(/(\p{L})-\s*\n\s*(?=\p{Ll})/gu, "$1")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (text: string) =>
  [...text.matchAll(/[\p{L}\p{N}]+(?:[-+./][\p{L}\p{N}]+)*/gu)].map(
    (match) => match[0],
  );
const common = new Set(
  "a an and are as at be by document does for from have how in is it many mention mentions most of on or paper report the there this times to was were what which with".split(
    " ",
  ),
);

export function searchMetadata(
  parsed: ParsedDocument,
  query: string,
): IndexNode {
  const nodes = flatten(parsed.nodes);
  const raw = parsed.blocks.length
    ? parsed.blocks.map((block) => block.content).join("\n")
    : parsed.markdown;
  const tokens = words(normalizeIndexText(raw));
  const queryTokens = words(normalizeIndexText(query)).map((token) =>
    token.toLocaleLowerCase(),
  );
  const phrases = new Map<string, { tokens: string[]; count: number }>();
  for (let start = 0; start < queryTokens.length; start++) {
    if (common.has(queryTokens[start])) continue;
    for (
      let length = 1;
      length <= 6 && start + length <= queryTokens.length;
      length++
    ) {
      const phrase = queryTokens.slice(start, start + length);
      if (common.has(phrase.at(-1)!)) continue;
      phrases.set(phrase.join(" "), { tokens: phrase, count: 0 });
    }
  }
  const byFirst = new Map<
    string,
    (typeof phrases extends Map<string, infer T> ? T : never)[]
  >();
  for (const phrase of phrases.values()) {
    const candidates = byFirst.get(phrase.tokens[0]) ?? [];
    candidates.push(phrase);
    byFirst.set(phrase.tokens[0], candidates);
  }
  const lower = tokens.map((token) => token.toLocaleLowerCase());
  const literalText = normalizeIndexText(raw).toLocaleLowerCase();
  const abbreviations = new Map<string, number>();
  for (let start = 0; start < tokens.length; start++) {
    const token = tokens[start];
    if (/^[A-Z]{2,8}(?:-[A-Z0-9]+)*$/.test(token) && !common.has(lower[start]))
      abbreviations.set(token, (abbreviations.get(token) ?? 0) + 1);
    for (const phrase of byFirst.get(lower[start]) ?? [])
      if (phrase.tokens.every((token, index) => lower[start + index] === token))
        phrase.count++;
  }
  const blocks = [
    ...new Map(parsed.blocks.map((block) => [block.id, block])).values(),
  ];
  const figures = blocks.filter((block) => block.type === "figure");
  const tables = blocks.filter((block) => block.type === "table");
  const captions = blocks.flatMap((block) =>
    [
      ...block.content.matchAll(
        /^(?:#{1,6}\s*)?(Figure|Fig\.?|Table)\s+([A-Z]?\d+(?:\.\d+)?)\s*[:.]\s*(.+)/gim,
      ),
    ].map((match) => ({
      kind: /^table$/i.test(match[1]) ? "table" : "figure",
      label: match[2],
      page: block.page,
      caption: normalizeIndexText(match[3]).slice(0, 160),
    })),
  );
  const labeledFigures = [
    ...new Map(
      captions
        .filter((caption) => caption.kind === "figure")
        .map((caption) => [caption.label, caption]),
    ).values(),
  ];
  const labeledTables = [
    ...new Map(
      captions
        .filter((caption) => caption.kind === "table")
        .map((caption) => [caption.label, caption]),
    ).values(),
  ];
  const sections = nodes.map(({ title, page, endPage }) => ({
    title: title.slice(0, 160),
    page,
    endPage,
  }));
  const statistics = {
    coverage:
      "Complete indexed document; all extracted blocks are counted, rather than sampled passages.",
    pdfPages: parsed.pages,
    extractedWordCount: tokens.length,
    parsedFigures: figures.length,
    parsedTables: tables.length,
    labeledFigures: labeledFigures.length,
    labeledTables: labeledTables.length,
    figureLabels: labeledFigures.slice(0, 24),
    tableLabels: labeledTables.slice(0, 24),
    labelInventoryComplete:
      labeledFigures.length <= 24 && labeledTables.length <= 24,
    figurePages: figures.slice(0, 200).map((block) => block.page),
    tablePages: tables.slice(0, 200).map((block) => block.page),
    objectPageInventoryComplete: figures.length <= 200 && tables.length <= 200,
    mostFrequentAbbreviations: [...abbreviations]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term, count]) => ({ term, count })),
    queryTermOccurrences: [...phrases]
      .filter(([, phrase]) => phrase.count > 0)
      .sort(
        (a, b) =>
          b[1].tokens.length - a[1].tokens.length || b[0].length - a[0].length,
      )
      .slice(0, 32)
      .map(([term, phrase]) => {
        let literalCount = 0;
        let offset = 0;
        while ((offset = literalText.indexOf(term, offset)) !== -1) {
          literalCount++;
          offset += term.length;
        }
        return { term, count: phrase.count, literalCount };
      }),
    countingMethod:
      "Counts refer to extracted content, including headers, footers, and references. Word tokens contain letters or digits and internal hyphens, plus signs, slashes, or periods. Term count uses complete token sequences; literalCount also includes occurrences within compound tokens and URLs. Both use case-insensitive Unicode normalization, joined line-break hyphenation, and normalized dash/plus spacing. Abbreviations are uppercase tokens excluding common words. Parsed figures/tables count distinct objects, which may include decorative images or split panels. Labeled figures/tables count distinct numbered source captions; unlabeled or unrecognized captions are not counted. PDF page positions differ from printed page numbers; extraction may omit or misclassify visual content.",
  };
  const title =
    "Document-wide statistics, term occurrences, and section/page inventory";
  const inventory = sections.length <= 80 ? sections : sections.slice(0, 80);
  const content = JSON.stringify(statistics);
  const sectionContent = JSON.stringify({
    interpretation:
      "This is a heading inventory for locating evidence. Headings do not reproduce the complete source contents, author lists, or statements. Term frequencies do not establish surrounding factual claims.",
    indexedSections: sections.length,
    topLevelSections: parsed.nodes.length,
    inventoryComplete: inventory.length === sections.length,
    sections: inventory,
  });
  const passages = [content, sectionContent].map((content, index) => ({
    id: `document-metadata-${index + 1}`,
    content,
    page: 1,
    endPage: parsed.pages,
    blockIds: [],
  }));
  return {
    id: "document-metadata",
    title,
    summary: title,
    page: 1,
    endPage: parsed.pages,
    content: `${content}\n${sectionContent}`,
    passages,
    children: [],
    blocks: [],
    links: [],
  };
}
