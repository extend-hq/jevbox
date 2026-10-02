import { z } from "zod";
import {
  resourceAccess,
  HttpError,
  type Store,
  type Actor,
  type Resource,
} from "./db";
import { flatten, type ParsedDocument } from "./indexing";
import { createLimiter } from "./async";
import { createThumbnailRenderer } from "./thumbnail-renderer";
import type { RetrievedSource } from "./retrieval";

export const documentVisualSchema = z
  .object({
    documentId: z.string().min(1).max(128),
    pages: z.array(z.number().int().positive()).min(1).max(2),
  })
  .strict();
export type DocumentVisualInput = z.infer<typeof documentVisualSchema>;
export type DocumentPageImage = {
  documentId: string;
  page: number;
  mediaType: "image/png";
  data: string;
};

export function createDocumentVisuals(
  store: Store,
  renderer = createThumbnailRenderer(),
) {
  const slot = createLimiter(2);
  return {
    async view(actor: Actor, raw: DocumentVisualInput, signal: AbortSignal) {
      const input = documentVisualSchema.parse(raw);
      const check = async () => {
        signal.throwIfAborted();
        if (!(await resourceAccess(store, actor, input.documentId)))
          throw new HttpError(404, "Document not found");
      };
      await check();
      const document = await store.one<Resource>(
        "SELECT * FROM resources WHERE id=? AND org_id=? AND kind='document'",
        input.documentId,
        actor.orgId,
      );
      if (!document || document.status !== "ready" || !document.parsed)
        throw new HttpError(409, "Wait for the document to finish indexing");
      const results: RetrievedSource[] = [];
      const images: DocumentPageImage[] = [];
      if (document.mime !== "application/pdf") {
        await check();
        return {
          results,
          images,
          message:
            "Original page images are available for PDF documents. Use inspect_document to read this document's extracted content.",
        };
      }
      const parsed = JSON.parse(document.parsed) as ParsedDocument;
      const pages = [...new Set(input.pages)];
      if (pages.some((page) => page > parsed.pages)) {
        await check();
        return {
          results,
          images,
          message: `The document contains ${parsed.pages} PDF pages. Request page positions within this range.`,
        };
      }
      const body = (await store.files.read("document", document.id))?.body;
      if (!body) throw new HttpError(404, "Document content is unavailable");
      await check();
      const nodes = flatten(parsed.nodes);
      const rendered = await Promise.all(
        pages.map((page) =>
          slot(async () => {
            await check();
            let result;
            try {
              result = await renderer.render(
                body,
                document.name,
                document.mime,
                signal,
                { pageIndex: page - 1, width: 1400 },
              );
            } catch {
              await check();
              return { page, body: undefined };
            }
            if (result.body.length > 5 * 1024 * 1024)
              throw new HttpError(
                413,
                "Rendered page is too large for visual inspection",
              );
            await check();
            return { page, body: result.body };
          }, signal),
        ),
      );
      for (const { page, body: image } of rendered) {
        if (!image) continue;
        results.push({
          documentId: document.id,
          name: document.name,
          nodeId:
            nodes.find((node) => node.page <= page && node.endPage >= page)
              ?.id ?? "",
          passageId: `visual-page-${page}`,
          title: `Original PDF page ${page}`,
          page,
          endPage: page,
          content: `Original PDF page ${page}, rendered directly from the uploaded document. The accompanying page image is the visual evidence for this citation. PDF page positions can differ from printed page numbers.`,
          blockIds: [],
          score: 3,
          routeScore: 1,
        });
        images.push({
          documentId: document.id,
          page,
          mediaType: "image/png",
          data: image.toString("base64"),
        });
      }
      await check();
      return {
        results,
        images,
        ...(rendered.some((page) => !page.body)
          ? {
              message:
                "Some original page images could not be rendered. Use extracted text for supported facts, and say visual properties are not established on unavailable pages; do not infer them from generated captions.",
            }
          : {}),
      };
    },
    close: () => renderer.close(),
  };
}
