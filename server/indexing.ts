import { z } from "zod";
import type { ParsedBlock } from "../shared/parsed-blocks";
import { buildSearchProfile } from "./search-metadata";
export type IndexNode = {
  id: string;
  title: string;
  summary: string;
  page: number;
  endPage: number;
  content: string;
  links: { label: string; url: string }[];
  blocks: ParsedBlock[];
  children: IndexNode[];
  passages?: IndexPassage[];
};
export type IndexPassage = {
  id: string;
  page: number;
  endPage: number;
  content: string;
  blockIds: string[];
};
export type ParsedDocument = {
  source: "extend" | "text";
  pages: number;
  nodes: IndexNode[];
  blocks: ParsedBlock[];
  markdown: string;
  indexedAt: string;
  version?: number;
  summary?: string;
  passageVersion?: number;
  searchProfile?: string;
  searchProfileVersion?: number;
};

export function splitPassages(content: string, size = 2400, overlap = 200) {
  const structured = [...content.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (!structured.length) return splitText(content, size, overlap);
  const passages: { content: string; start: number; end: number }[] = [];
  let offset = 0;
  const text = (end: number) => {
    for (const passage of splitText(content.slice(offset, end), size, overlap))
      passages.push({
        ...passage,
        start: passage.start + offset,
        end: passage.end + offset,
      });
  };
  for (const match of structured) {
    text(match.index);
    const table = match[0];
    const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
    const opening = table.match(/^<table\b[^>]*>/i)![0];
    const caption =
      table.match(/<caption\b[^>]*>[\s\S]*?<\/caption>/i)?.[0] ?? "";
    const head = table.match(/<thead\b[^>]*>[\s\S]*?<\/thead>/i);
    const headers = head
      ? rows.filter(
          (row) =>
            row.index >= head.index! &&
            row.index < head.index! + head[0].length,
        )
      : rows.filter(
          (row, index) =>
            index === 0 ||
            (/<th\b/i.test(row[0]) &&
              rows
                .slice(0, index)
                .every((previous) => /<th\b/i.test(previous[0]))),
        );
    const body = rows.filter((row) => !headers.includes(row));
    const before =
      content
        .slice(offset, match.index)
        .trim()
        .split(/\n\s*\n/)
        .at(-1)
        ?.slice(-320) ?? "";
    const after = content
      .slice(
        match.index + table.length,
        structured.find((next) => next.index > match.index)?.index,
      )
      .trim()
      .split(/\n\s*\n/)[0]
      .slice(0, 500);
    const prefix = `${before ? `${before}\n\n` : ""}${opening}${caption}<thead>${headers.map((row) => row[0]).join("")}</thead><tbody>`;
    const suffix = `</tbody></table>${after ? `\n\n${after}` : ""}`;
    if (!body.length || /<table\b/i.test(table.slice(opening.length))) {
      for (const passage of splitText(table, size, overlap))
        passages.push({
          ...passage,
          start: passage.start + match.index,
          end: passage.end + match.index,
        });
    } else {
      let group: typeof rows = [];
      let length = prefix.length + suffix.length;
      const emit = () => {
        if (!group.length) return;
        passages.push({
          content: prefix + group.map((row) => row[0]).join("") + suffix,
          start: before
            ? content.lastIndexOf(before, match.index)
            : match.index + group[0].index,
          end: after
            ? content.indexOf(after, match.index + table.length) + after.length
            : match.index + group.at(-1)!.index + group.at(-1)![0].length,
        });
        group = [];
        length = prefix.length + suffix.length;
      };
      for (let index = 0; index < body.length;) {
        let end = index + 1;
        for (
          let current = index;
          current < end && current < body.length;
          current++
        ) {
          const spans = [
            ...body[current][0].matchAll(/\browspan\s*=\s*["']?(\d+)/gi),
          ];
          end = Math.min(
            body.length,
            Math.max(
              end,
              ...spans.map((span) => current + Math.max(1, Number(span[1]))),
            ),
          );
        }
        const unit = body.slice(index, end);
        const unitLength = unit.reduce((sum, row) => sum + row[0].length, 0);
        if (group.length && length + unitLength > size) emit();
        group.push(...unit);
        length += unitLength;
        index = end;
      }
      emit();
    }
    offset = match.index + table.length;
  }
  text(content.length);
  return passages;
}

function splitText(content: string, size: number, overlap: number) {
  const passages: { content: string; start: number; end: number }[] = [];
  for (let start = 0; start < content.length;) {
    let end = Math.min(start + size, content.length);
    if (end < content.length) {
      const boundary = content.lastIndexOf("\n\n", end);
      if (boundary > start + size / 2) end = boundary;
    }
    const text = content.slice(start, end);
    if (text.trim()) passages.push({ content: text, start, end });
    if (end === content.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return passages;
}

function sectionParts(content: string) {
  const offsets = [0];
  let offset = 0;
  let fence: string | undefined;
  for (const line of content.split(/(?<=\n)/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
        fence = undefined;
    } else if (!fence && /^#{1,6}\s/.test(line) && offset > 0)
      offsets.push(offset);
    offset += line.length;
  }
  return offsets.map((start, index) =>
    content.slice(start, offsets[index + 1]),
  );
}
const boundingBoxSchema = z.object({
  left: z.number().finite(),
  top: z.number().finite(),
  right: z.number().finite(),
  bottom: z.number().finite(),
});
const chunkSchema = z
  .object({
    content: z.string(),
    metadata: z
      .object({
        pageRange: z.object({ start: z.number(), end: z.number() }).optional(),
      })
      .passthrough()
      .optional(),
    blocks: z
      .array(
        z
          .object({
            id: z.string().optional(),
            type: z.string(),
            content: z.string().default(""),
            details: z
              .object({
                figureType: z
                  .string()
                  .trim()
                  .min(1)
                  .max(100)
                  .nullish()
                  .catch(undefined),
              })
              .nullish()
              .catch(undefined),
            boundingBox: boundingBoxSchema.nullish().catch(undefined),
            polygon: z
              .array(
                z.object({ x: z.number().finite(), y: z.number().finite() }),
              )
              .nullish()
              .catch(undefined),
            metadata: z
              .object({
                page: z
                  .object({
                    number: z.number().int().positive(),
                    width: z.number().positive().nullish(),
                    height: z.number().positive().nullish(),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();
export function buildIndex(
  input: unknown,
  source: "extend" | "text",
  outputMetadata?: unknown,
): ParsedDocument {
  const chunks = z.array(chunkSchema).min(1).parse(input);
  const pageMetadata = z
    .object({
      pages: z
        .array(
          z.object({
            number: z.number().int().positive(),
            rotationApplied: z.number().finite().nullable(),
          }),
        )
        .nullish(),
    })
    .safeParse(outputMetadata);
  const pageRotations = new Map(
    pageMetadata.success
      ? pageMetadata.data.pages?.map((p) => [p.number, p.rotationApplied ?? 0])
      : [],
  );
  let seq = 0;
  const nodes: IndexNode[] = [];
  const blocks: ParsedBlock[] = [];
  const seenBlocks = new Map<string, ParsedBlock>();
  const stack: { level: number; node: IndexNode }[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const page = chunk.metadata?.pageRange?.start ?? i + 1;
    const endPage = chunk.metadata?.pageRange?.end ?? page;
    const chunkBlocks = chunk.blocks.map((b, j): ParsedBlock => {
      const id = b.id ?? `block-${i}-${j}`;
      const existing = seenBlocks.get(id);
      if (existing) return existing;
      const polygon = b.polygon;
      const boundingBox =
        b.boundingBox ??
        (polygon && polygon.length >= 3
          ? {
              left: Math.min(...polygon.map((p) => p.x)),
              right: Math.max(...polygon.map((p) => p.x)),
              top: Math.min(...polygon.map((p) => p.y)),
              bottom: Math.max(...polygon.map((p) => p.y)),
            }
          : undefined);
      const block: ParsedBlock = {
        id,
        type: b.type,
        content: b.content,
        ...(b.type === "figure" && b.details?.figureType
          ? { figureType: b.details.figureType }
          : {}),
        page: b.metadata?.page?.number ?? page,
        ...(b.metadata?.page?.width && b.metadata.page.height
          ? {
              pageWidth: b.metadata.page.width,
              pageHeight: b.metadata.page.height,
            }
          : {}),
        ...(boundingBox ? { boundingBox } : {}),
        ...(pageRotations.has(b.metadata?.page?.number ?? page)
          ? {
              rotationApplied: pageRotations.get(
                b.metadata?.page?.number ?? page,
              ),
            }
          : {}),
      };
      seenBlocks.set(id, block);
      blocks.push(block);
      return block;
    });
    const parts = sectionParts(chunk.content).filter((part) => part.trim());
    for (const part of parts.length ? parts : [""]) {
      const heading = part.match(/^(#{1,6})\s+(.+)/);
      if (!heading && stack.length) {
        append(stack.at(-1)!.node, part, page, endPage, chunkBlocks);
        stack.forEach((s) => {
          s.node.endPage = Math.max(s.node.endPage, endPage);
        });
        continue;
      }
      const level = heading?.[1].length ?? 6;
      const node: IndexNode = {
        id: `node-${++seq}`,
        title: heading?.[2].trim() ?? `Page ${page}`,
        summary: "",
        page,
        endPage,
        content: "",
        links: [],
        blocks: [],
        children: [],
        passages: [],
      };
      append(node, part, page, endPage, chunkBlocks);
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      if (stack.length) stack.at(-1)!.node.children.push(node);
      else nodes.push(node);
      stack.forEach((s) => {
        s.node.endPage = Math.max(s.node.endPage, endPage);
      });
      if (heading) stack.push({ level, node });
    }
  }
  for (const node of flatten(nodes))
    node.summary = `Pages ${node.page}–${node.endPage}. Sections: ${[node.title, ...flatten(node.children).map((child) => child.title)].join("; ")}`;
  const parsed = withLayoutSections({
    version: 1,
    passageVersion: 2,
    source,
    pages: Math.max(
      chunks.reduce(
        (last, chunk, i) =>
          Math.max(last, chunk.metadata?.pageRange?.end ?? i + 1),
        0,
      ),
      blocks.reduce((last, block) => Math.max(last, block.page), 0),
    ),
    nodes,
    blocks,
    markdown: chunks.map((c) => c.content).join("\n\n"),
    indexedAt: new Date().toISOString(),
    summary: `Document outline: ${flatten(nodes)
      .map((node) => node.title)
      .join("; ")}`,
  });
  return {
    ...parsed,
    searchProfile: buildSearchProfile(parsed),
    searchProfileVersion: 1,
  };
}

export function withSearchPassages(input: ParsedDocument): ParsedDocument {
  const parsed = withLayoutSections(input);
  if (parsed.passageVersion === 2) return parsed;
  const upgrade = (node: IndexNode): IndexNode => {
    const copy: IndexNode = {
      ...node,
      content: "",
      links: [],
      blocks: [],
      passages: [],
      children: node.children.map(upgrade),
    };
    append(copy, node.content, node.page, node.endPage, node.blocks);
    return copy;
  };
  return { ...parsed, passageVersion: 2, nodes: parsed.nodes.map(upgrade) };
}

export function withLayoutSections(parsed: ParsedDocument): ParsedDocument {
  const nodes = flatten(parsed.nodes);
  const owners = new Map<string, IndexNode>();
  for (const node of nodes)
    for (const block of node.blocks) owners.set(block.id, node);
  const moves: { block: ParsedBlock; from: IndexNode; to: IndexNode }[] = [];
  for (const page of new Set(parsed.blocks.map((block) => block.page))) {
    const paragraphs = parsed.blocks.filter(
      (block) =>
        block.page === page &&
        block.type === "text" &&
        block.content.length >= 40 &&
        block.boundingBox,
    );
    const widths = paragraphs
      .map((block) => block.boundingBox!.right - block.boundingBox!.left)
      .filter((width) => width > 0)
      .sort((a, b) => a - b);
    const columnWidth = widths[Math.floor(widths.length / 2)];
    if (
      paragraphs.length < 8 ||
      !columnWidth ||
      !paragraphs.some((a) =>
        paragraphs.some(
          (b) =>
            Math.abs(a.boundingBox!.left - b.boundingBox!.left) > columnWidth &&
            Math.min(a.boundingBox!.bottom, b.boundingBox!.bottom) >
              Math.max(a.boundingBox!.top, b.boundingBox!.top),
        ),
      )
    )
      continue;
    const headings = parsed.blocks.filter(
      (block) =>
        block.page === page &&
        block.type === "section_heading" &&
        block.boundingBox &&
        owners.has(block.id) &&
        !/^#{1,6}\s+By\s/i.test(block.content),
    );
    const contains = (heading: ParsedBlock, block: ParsedBlock) => {
      const box = heading.boundingBox!;
      const center = (block.boundingBox!.left + block.boundingBox!.right) / 2;
      return center >= box.left - 4 && center <= box.right + 4;
    };
    const parent = (heading: ParsedBlock) =>
      headings
        .filter((other) => {
          const a = other.boundingBox!;
          const b = heading.boundingBox!;
          return (
            a.bottom < b.top &&
            b.top - a.bottom < Math.max((a.bottom - a.top) * 4, 48) &&
            a.right - a.left > (b.right - b.left) * 2 &&
            contains(other, heading)
          );
        })
        .sort((a, b) => b.boundingBox!.bottom - a.boundingBox!.bottom)[0] ??
      heading;
    const placements = paragraphs.flatMap((block) => {
      const from = owners.get(block.id);
      const heading = headings
        .filter(
          (heading) =>
            heading.boundingBox!.bottom <= block.boundingBox!.top + 2 &&
            contains(heading, block),
        )
        .sort((a, b) => b.boundingBox!.bottom - a.boundingBox!.bottom)[0];
      const to = heading && owners.get(parent(heading).id);
      return from && to && from !== to ? [{ block, from, to }] : [];
    });
    const misplaced = placements.filter(({ block, from }) => {
      const heading = from.blocks.find(
        (candidate) =>
          candidate.type === "section_heading" && candidate.boundingBox,
      );
      return (
        heading &&
        (heading.boundingBox!.top > block.boundingBox!.bottom ||
          !contains(heading, block))
      );
    });
    if (misplaced.length < 2) continue;
    moves.push(
      ...placements.sort((a, b) =>
        Math.abs(a.block.boundingBox!.left - b.block.boundingBox!.left) <
        columnWidth / 2
          ? a.block.boundingBox!.top - b.block.boundingBox!.top
          : a.block.boundingBox!.left - b.block.boundingBox!.left,
      ),
    );
  }
  if (!moves.length) return parsed;
  const copies = new Map<string, IndexNode>();
  const copy = (node: IndexNode): IndexNode => {
    const result = {
      ...node,
      blocks: [...node.blocks],
      children: node.children.map(copy),
    };
    copies.set(node.id, result);
    return result;
  };
  const roots = parsed.nodes.map(copy);
  const changed = new Set<IndexNode>();
  for (const { block, from, to } of moves) {
    const previous = copies.get(from.id)!;
    const next = copies.get(to.id)!;
    previous.content = previous.content.replace(block.content, "");
    previous.blocks = previous.blocks.filter(
      (candidate) => candidate.id !== block.id,
    );
    next.content += `\n\n${block.content}`;
    next.blocks.push(block);
    changed.add(previous);
    changed.add(next);
  }
  for (const node of changed) {
    const content = node.content.trim();
    const blocks = node.blocks;
    node.content = "";
    node.blocks = [];
    node.passages = [];
    node.links = [];
    append(node, content, node.page, node.endPage, blocks);
  }
  return { ...parsed, nodes: roots };
}

function append(
  node: IndexNode,
  content: string,
  page: number,
  endPage: number,
  blocks: ParsedBlock[],
) {
  node.content += (node.content ? "\n\n" : "") + content;
  node.endPage = Math.max(node.endPage, endPage);
  for (const match of content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g))
    node.links.push({ label: match[1], url: match[2] });
  const matches = blocks.flatMap((block) => {
    const start = block.content ? content.indexOf(block.content) : -1;
    return start < 0
      ? []
      : [{ block, start, end: start + block.content.length }];
  });
  for (const { block } of matches)
    if (!node.blocks.some((existing) => existing.id === block.id)) {
      node.blocks.push(block);
    }
  for (const passage of splitPassages(content)) {
    const covered = matches.filter(
      (match) => match.start < passage.end && match.end > passage.start,
    );
    node.passages!.push({
      id: `${node.id}-passage-${node.passages!.length + 1}`,
      content: passage.content,
      page: covered.length
        ? Math.min(...covered.map((match) => match.block.page))
        : page,
      endPage: covered.length
        ? Math.max(...covered.map((match) => match.block.page))
        : endPage,
      blockIds: covered.map((match) => match.block.id),
    });
  }
}
export function flatten(nodes: IndexNode[]): IndexNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}
