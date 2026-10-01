import { normalizeIndexText } from "./search-metadata";

const common = new Set(
  "a an and are as at be by can company could did do does document for from have how in is it many mention mentions most of on or paper report the there this times to was were what which who why with according".split(
    " ",
  ),
);
const tokens = (text: string) =>
  new Set(
    (
      normalizeIndexText(text)
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]{2,}/gu) ?? []
    ).filter((word) => !common.has(word)),
  );

export function metadataCandidates<
  T extends { id: string; name: string; outline: string; profile?: string },
>(documents: T[], query: string) {
  const terms = tokens(query);
  const indexed = documents.map((document) => ({
    document,
    words: tokens(`${document.name}\n${document.outline}`),
    extra: tokens(document.profile ?? ""),
  }));
  const frequencies = new Map(
    [...terms].map((term) => [
      term,
      indexed.filter((entry) => entry.words.has(term) || entry.extra.has(term))
        .length,
    ]),
  );
  return indexed
    .flatMap(({ document, words, extra }) => {
      const matched = [...terms].filter(
        (term) => words.has(term) || extra.has(term),
      );
      const weights = matched.map(
        (term) =>
          Math.log(1 + documents.length / (1 + frequencies.get(term)!)) *
          (words.has(term) ? 2 : 0.75),
      );
      if (!matched.length || (matched.length < 2 && weights[0] < 2)) return [];
      const headings = document.outline
        .split(/;|\n/)
        .filter((heading) =>
          [...tokens(heading)].some((term) => terms.has(term)),
        );
      const details = (document.profile ?? "")
        .split(/;|\n/)
        .filter((entry) => [...tokens(entry)].some((term) => terms.has(term)));
      return [
        {
          ...document,
          score: weights.reduce((sum, weight) => sum + weight, 0),
          hint: `${document.name}\n${headings.join("; ") || document.outline}\n${details.join("; ")}`.slice(
            0,
            1200,
          ),
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 8);
}
