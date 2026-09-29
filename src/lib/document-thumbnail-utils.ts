import { extension, textExtensions } from "../../shared/file-types";
export async function renderDocumentThumbnail(
  url: string,
  fileName: string,
  pageIndex = 0,
  width = 320,
): Promise<{ url: string; pageCount: number; aspectRatio?: number } | null> {
  const absoluteUrl = new URL(url, location.href).href;
  switch (extension(fileName)) {
    case "pdf": {
      const { loadPdfDocument, renderPdfThumbnailUrl } =
        await import("./pdf-thumbnail-utils");
      const document = await loadPdfDocument(absoluteUrl);
      const page = document.pages[pageIndex];
      if (!page) return null;
      const preview = await renderPdfThumbnailUrl({
        url: absoluteUrl,
        pageIndex,
        width,
      });
      return preview
        ? {
            url: preview,
            pageCount: document.pageCount,
            aspectRatio: page.size.width / page.size.height,
          }
        : null;
    }
    case "docx": {
      const { renderDocxThumbnailUrl } = await import("./docx-thumbnail-utils");
      return renderDocxThumbnailUrl({ url: absoluteUrl, fileName, pageIndex });
    }
    case "pptx": {
      const { renderPptxThumbnailUrl } = await import("./pptx-thumbnail-utils");
      const result = await renderPptxThumbnailUrl({
        url: absoluteUrl,
        pageIndex,
      });
      return result;
    }
    case "json":
    case "yaml":
    case "yml": {
      if (pageIndex !== 0) return null;
      const { renderCodeThumbnail } = await import("./code-thumbnail-utils");
      return renderCodeThumbnail(
        absoluteUrl,
        extension(fileName) === "json" ? "json" : "yaml",
        width,
      );
    }
    default: {
      if (pageIndex === 0 && textExtensions.includes(extension(fileName))) {
        const { renderCodeThumbnail } = await import("./code-thumbnail-utils");
        return renderCodeThumbnail(absoluteUrl, "text", width);
      }
      return null;
    }
  }
}
