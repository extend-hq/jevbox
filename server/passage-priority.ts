import { normalizeIndexText } from "./search-metadata";

const common = new Set(
  "a an and are as at be been but by can could did do does for from has have how if in is it its may of on or should that the their there these this to was were what when where which who why will with would".split(
    " ",
  ),
);
const terms = (text: string) =>
  (
    normalizeIndexText(text)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((term) => !common.has(term));

export function prioritizePassages<T extends { content: string }>(
  passages: T[],
  query: string,
): T[] {
  if (passages.length < 2) return passages;
  const requested = new Set(terms(query));
  if (!requested.size) return passages;
  const frequencies = new Map<string, number>();
  const entries = passages.map((passage, index) => {
    const tokens = terms(passage.content);
    const counts = new Map<string, number>();
    for (const token of tokens)
      if (requested.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (const token of counts.keys())
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return { passage, index, counts, length: tokens.length };
  });
  const average =
    entries.reduce((sum, entry) => sum + entry.length, 0) / entries.length;
  return entries
    .map((entry) => ({
      ...entry,
      score: [...entry.counts].reduce((score, [token, count]) => {
        const frequency = frequencies.get(token)!;
        const weight = Math.log(
          1 + (entries.length - frequency + 0.5) / (frequency + 0.5),
        );
        return (
          score +
          (weight * count * 2.2) /
            (count +
              1.2 * (0.25 + (0.75 * entry.length) / Math.max(1, average)))
        );
      }, 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.passage);
}
