import type { IndexNode } from "./indexing";
import { normalizeIndexText } from "./search-metadata";

const common = new Set(
  "a an and are as at be been being but by can could did do does each for from had has have how if in into is it its may more most no not of on or other our should so some than that the their them then there these they this those through to was we were what when where which who why will with would you your".split(
    " ",
  ),
);
const terms = (text: string) =>
  (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
    (word) => !common.has(word),
  );
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
type Sample = {
  text: string;
  node: IndexNode;
  position: number;
  words: Set<string>;
  relevance: number;
  information: number;
};

function fragments(content: string) {
  const output: string[] = [];
  for (const paragraph of content
    .replace(/^#{1,6}[\t ]+.*$/gm, "")
    .replace(/<\/t[dh]>/gi, "; ")
    .split(/\n\s*\n/)) {
    const text = normalizeIndexText(paragraph);
    let pending = "";
    for (const { segment } of segmenter.segment(text)) {
      if (pending && pending.length + segment.length > 280) {
        output.push(pending.trim());
        pending = "";
      }
      if (segment.length <= 280) pending += segment;
      else {
        for (let start = 0; start < segment.length;) {
          let end = Math.min(start + 280, segment.length);
          if (end < segment.length) {
            const space = segment.lastIndexOf(" ", end);
            if (space > start + 140) end = space;
          }
          output.push(segment.slice(start, end).trim());
          start = end;
        }
      }
    }
    if (pending.trim()) output.push(pending.trim());
  }
  return [...new Set(output)].filter((text) => text.length >= 25);
}

function similarity(a: Set<string>, b: Set<string>) {
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(1, a.size + b.size - shared);
}

function excerpt(text: string, budget: number, query: Set<string>) {
  if (text.length <= budget) return text;
  const hit = [...text.matchAll(/[\p{L}\p{N}]{2,}/gu)].find((match) =>
    query.has(match[0].toLocaleLowerCase()),
  );
  let start = Math.max(0, (hit?.index ?? 0) - Math.floor(budget / 3));
  if (start) {
    const boundary = text.indexOf(" ", start);
    if (boundary !== -1 && boundary < start + 40) start = boundary + 1;
  }
  let end = Math.min(text.length, start + budget - 2);
  if (end < text.length) {
    const boundary = text.lastIndexOf(" ", end);
    if (boundary > start + budget / 2) end = boundary;
  }
  return `${start ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function buildSectionPreviews(nodes: IndexNode[], query: string) {
  const own = new Map<IndexNode, Sample[]>();
  const all: Sample[] = [];
  const index = (node: IndexNode) => {
    const samples = fragments(node.content).map((text, position) => ({
      text,
      node,
      position,
      words: new Set(terms(text)),
      relevance: 0,
      information: 0,
    }));
    own.set(node, samples);
    all.push(...samples);
    node.children.forEach(index);
  };
  nodes.forEach(index);
  const frequencies = new Map<string, number>();
  for (const samples of own.values()) {
    const words = new Set(samples.flatMap((sample) => [...sample.words]));
    for (const word of words)
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  }
  const count = Math.max(1, own.size);
  const weight = (word: string) => {
    const frequency = frequencies.get(word) ?? 0;
    return Math.log(1 + (count - frequency + 0.5) / (frequency + 0.5));
  };
  const queryTerms = new Set(terms(query));
  const average =
    all.reduce((sum, sample) => sum + terms(sample.text).length, 0) /
    Math.max(1, all.length);
  for (const sample of all) {
    const words = terms(sample.text);
    for (const word of queryTerms) {
      const frequency = words.filter((term) => term === word).length;
      if (frequency)
        sample.relevance +=
          (weight(word) * frequency * 2.2) /
          (frequency +
            1.2 * (0.25 + (0.75 * words.length) / Math.max(1, average)));
    }
    sample.information =
      [...sample.words]
        .map(weight)
        .sort((a, b) => b - a)
        .slice(0, 12)
        .reduce((sum, value) => sum + value, 0) /
      Math.max(1, Math.min(12, sample.words.size));
  }

  const previews = new Map<string, string>();
  const visit = (node: IndexNode): Sample[] => {
    const direct = own.get(node)!;
    const pool = [...direct, ...node.children.flatMap(visit)];
    const structure = `${node.title}\nPages ${node.page}–${node.endPage}\n${node.summary}`;
    if (!pool.length) {
      previews.set(node.id, structure.slice(0, 1200));
      return pool;
    }
    const selected: Sample[] = [];
    const maxRelevance = pool.reduce(
      (max, sample) => Math.max(max, sample.relevance),
      1e-9,
    );
    const maxInformation = pool.reduce(
      (max, sample) => Math.max(max, sample.information),
      1e-9,
    );
    const choose = (candidates: Sample[], focused: boolean) => {
      const ranked = candidates
        .filter(
          (sample) =>
            !selected.some(
              (previous) =>
                previous.text === sample.text ||
                similarity(previous.words, sample.words) > 0.8,
            ),
        )
        .map((sample) => ({
          sample,
          score:
            (focused ? sample.relevance / maxRelevance : 0) +
            (0.2 * sample.information) / maxInformation +
            (selected.every((previous) => previous.node !== sample.node)
              ? 0.15
              : 0) +
            (sample.position === 0 ? 0.05 : 0) -
            0.45 *
              Math.max(
                0,
                ...selected.map((previous) =>
                  similarity(previous.words, sample.words),
                ),
              ),
        }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]) selected.push(ranked[0].sample);
    };
    if (pool.some((sample) => sample.relevance > 0)) choose(pool, true);
    const opening = direct[0] ?? pool[0];
    if (!selected.some((sample) => sample.text === opening.text))
      selected.push(opening);
    while (selected.length < 3) {
      const before = selected.length;
      choose(pool, maxRelevance > 1e-9);
      if (selected.length === before) break;
    }
    const heading = structure.slice(0, 440);
    const prefix = `${heading}\nSource excerpts (partial):`;
    const labels = selected.map(
      (sample) =>
        `\n[${sample.node.title.slice(0, 60)}, p${sample.node.page}] `,
    );
    const budget = Math.floor(
      (1200 -
        prefix.length -
        labels.reduce((sum, label) => sum + label.length, 0)) /
        selected.length,
    );
    previews.set(
      node.id,
      prefix +
        selected
          .map(
            (sample, index) =>
              labels[index] + excerpt(sample.text, budget, queryTerms),
          )
          .join(""),
    );
    return pool;
  };
  nodes.forEach(visit);
  return previews;
}
