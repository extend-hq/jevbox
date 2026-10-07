import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { blockHighlightArea, type ParsedBlock } from "../shared/parsed-blocks";
import {
  resourceAccess,
  HttpError,
  type Actor,
  type Resource,
  type Store,
} from "./db";
import { createLimiter } from "./async";
import { flatten, type ParsedDocument } from "./indexing";
import { ProviderResponseError } from "./provider-http";
import { createThumbnailRenderer } from "./thumbnail-renderer";
import { clefLimits } from "./clef-limits";

export type ClefImage = {
  id: string;
  documentId: string;
  page: number;
  blockIds: string[];
  view: "page" | "crop";
  content_type: "image/jpeg";
  base64: string;
};

export const clefImageLimit = clefLimits.images;
const renderSlot = createLimiter(2);

export function isClefVisualBlock(block: ParsedBlock) {
  return /^(figure|image|picture|chart|diagram)$/i.test(block.type.trim());
}

function sample<T>(items: T[], count: number) {
  if (items.length <= count) return items;
  return Array.from(
    { length: count },
    (_, i) =>
      items[Math.round((i * (items.length - 1)) / Math.max(1, count - 1))],
  );
}

function filingPages(parsed: ParsedDocument, imageLimit: number) {
  const pages = Array.from({ length: parsed.pages }, (_, i) => i + 1);
  const visual = [
    ...new Set(
      parsed.blocks.filter(isClefVisualBlock).map((block) => block.page),
    ),
  ]
    .filter((page) => pages.includes(page) && page !== 1)
    .sort((a, b) => a - b);
  return [
    ...new Set([
      1,
      ...sample(visual, Math.max(2, Math.floor(imageLimit / 2))),
      parsed.pages,
      ...sample(pages, imageLimit),
    ]),
  ]
    .filter((page) => pages.includes(page))
    .slice(0, imageLimit)
    .sort((a, b) => a - b);
}

export function withClefVisualPassages(parsed: ParsedDocument): ParsedDocument {
  const covered = new Set(
    flatten(parsed.nodes).flatMap((node) =>
      (node.passages ?? []).flatMap((passage) => passage.blockIds),
    ),
  );
  const missing = parsed.blocks.filter(
    (block) => isClefVisualBlock(block) && !covered.has(block.id),
  );
  if (!missing.length) return parsed;
  return {
    ...parsed,
    nodes: [
      ...parsed.nodes,
      ...missing.map((block, index) => {
        const id = `clef-visual-${index}`;
        const content =
          block.content ||
          `Original ${block.type} on page ${block.page}. Inspect the attached visual evidence to determine its relevance.`;
        return {
          id,
          title: `${block.type} on page ${block.page}`,
          summary: content,
          page: block.page,
          endPage: block.page,
          content,
          links: [],
          blocks: [block],
          children: [],
          passages: [
            {
              id: `${id}-passage`,
              page: block.page,
              endPage: block.page,
              content,
              blockIds: [block.id],
            },
          ],
        };
      }),
    ],
  };
}

export function createClefImages(
  store: Store,
  actor: Actor,
  signal: AbortSignal = new AbortController().signal,
  renderer = createThumbnailRenderer(),
  filingImageLimit: number = clefImageLimit,
) {
  type Page = { body: Buffer; rotation?: number };
  const pages = new Map<string, Promise<Page>>();
  const images = new Map<string, ClefImage>();

  async function check(document: Resource) {
    signal.throwIfAborted();
    if (!(await resourceAccess(store, actor, document.id)))
      throw new HttpError(404, "Document not found");
    const current = await store.one<Resource>(
      "SELECT * FROM resources WHERE id=? AND org_id=? AND kind='document'",
      document.id,
      actor.orgId,
    );
    if (
      !current ||
      current.status !== "ready" ||
      current.parsed !== document.parsed ||
      current.mime !== document.mime ||
      current.name !== document.name
    )
      throw new HttpError(
        409,
        "The document changed while preparing visual evidence. Retry the operation.",
      );
    signal.throwIfAborted();
  }

  async function pageImage(document: Resource, page: number) {
    await check(document);
    const key = `${document.id}:${page}`;
    let pending = pages.get(key);
    if (!pending) {
      pending = renderSlot(async () => {
        await check(document);
        const body = (await store.files.read("document", document.id))?.body;
        if (!body) throw new HttpError(404, "Document content is unavailable");
        await check(document);
        let result;
        let rotation: number | undefined;
        try {
          result = await renderer.render(
            body,
            document.name,
            document.mime,
            signal,
            { pageIndex: page - 1, width: 1400 },
          );
          if (document.mime === "application/pdf") {
            try {
              const pdf = await PDFDocument.load(body, {
                updateMetadata: false,
              });
              rotation = pdf.getPage(page - 1).getRotation().angle;
            } catch {
              rotation = undefined;
            }
          }
        } catch {
          await check(document);
          throw new ProviderResponseError(
            "Unable to render visual evidence. Retry the operation.",
          );
        }
        await check(document);
        return { body: result.body, rotation };
      }, signal);
      if (pages.size >= 8) pages.delete(pages.keys().next().value!);
      pages.set(key, pending);
    }
    const result = await pending;
    await check(document);
    return result;
  }

  async function image(
    document: Resource,
    page: number,
    block?: ParsedBlock,
  ): Promise<ClefImage> {
    await check(document);
    const id = `${document.id}:${page}:${block?.id ?? "page"}`;
    const cached = images.get(id);
    if (cached) return cached;
    const rendered = await pageImage(document, page);
    let source = sharp(rendered.body, { limitInputPixels: 32_000_000 });
    let view: ClefImage["view"] = "page";
    try {
      const area =
        block && rendered.rotation !== undefined
          ? blockHighlightArea(block, rendered.rotation)
          : null;
      if (area) {
        const { width, height } = await source.metadata();
        if (width && height) {
          const left = Math.max(0, Math.floor((area.left * width) / 100) - 6);
          const top = Math.max(0, Math.floor((area.top * height) / 100) - 6);
          const right = Math.min(
            width,
            Math.ceil(((area.left + area.width) * width) / 100) + 6,
          );
          const bottom = Math.min(
            height,
            Math.ceil(((area.top + area.height) * height) / 100) + 6,
          );
          if (right > left && bottom > top) {
            source = source.extract({
              left,
              top,
              width: right - left,
              height: bottom - top,
            });
            view = "crop";
          }
        }
      }
      for (const width of [clefLimits.preparedImageDimension, 1200, 800]) {
        signal.throwIfAborted();
        const body = await source
          .clone()
          .resize({
            width,
            height: width,
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 85 })
          .toBuffer();
        if (body.length > clefLimits.preparedImageBytes) continue;
        await check(document);
        const result: ClefImage = {
          id,
          documentId: document.id,
          page,
          blockIds: block ? [block.id] : [],
          view,
          content_type: "image/jpeg",
          base64: body.toString("base64"),
        };
        if (images.size >= 32) images.delete(images.keys().next().value!);
        images.set(id, result);
        return result;
      }
    } catch {
      await check(document);
      throw new ProviderResponseError(
        "Unable to prepare visual evidence. Retry the operation.",
      );
    }
    throw new ProviderResponseError(
      "Visual evidence exceeds the image preparation limit. Retry with a smaller document.",
    );
  }

  function supported(document: Resource) {
    return (
      document.mime === "application/pdf" || document.mime.startsWith("image/")
    );
  }

  return {
    check,
    async filing(document: Resource) {
      if (!supported(document) || !document.parsed) return [];
      const parsed = JSON.parse(document.parsed) as ParsedDocument;
      const selected = document.mime.startsWith("image/")
        ? [1]
        : filingPages(parsed, filingImageLimit);
      const result = [];
      for (const page of selected) result.push(await image(document, page));
      await check(document);
      return result;
    },
    async passage(
      document: Resource,
      parsed: ParsedDocument,
      blockIds: string[],
    ) {
      if (!supported(document)) return [];
      const ids = new Set(blockIds);
      const blocks = parsed.blocks.filter(
        (block) => ids.has(block.id) && isClefVisualBlock(block),
      );
      const result = [];
      for (const block of blocks) {
        if (
          !Number.isInteger(block.page) ||
          block.page < 1 ||
          block.page > parsed.pages
        )
          continue;
        result.push(await image(document, block.page, block));
      }
      if (result.length) await check(document);
      return result;
    },
    close: async () => {
      pages.clear();
      images.clear();
      await renderer.close();
    },
  };
}

export async function clefFilingImages(
  store: Store,
  actor: Actor,
  document: Resource,
  signal: AbortSignal,
  imageLimit: number = clefImageLimit,
) {
  const images = createClefImages(store, actor, signal, undefined, imageLimit);
  try {
    return await images.filing(document);
  } finally {
    await images.close();
  }
}
