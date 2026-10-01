import {
  extension,
  imageExtensions,
  textExtensions,
} from "../../shared/file-types";

export type SpatialThumbnail = { url: string; release: () => void };

export async function renderSpatialThumbnail(
  source: string,
  fileName: string,
  signal: AbortSignal,
): Promise<SpatialThumbnail | null> {
  const url = new URL(source, location.href).href;
  const size = 1024;
  const format = extension(fileName);
  signal.throwIfAborted();
  let blob: Blob | undefined;
  if (format === "pdf") {
    const { loadSharedPdfEngine } = await import("./pdf-thumbnail-utils");
    const engine = await loadSharedPdfEngine();
    signal.throwIfAborted();
    const task = engine.openDocumentUrl(
      { id: `spatial-${crypto.randomUUID()}`, url },
      { mode: "auto" },
    );
    const document = await task.toPromise();
    try {
      signal.throwIfAborted();
      const page = document.pages[0];
      if (!page) return null;
      blob = await engine
        .renderThumbnail(document, page, {
          dpr: 1,
          imageType: "image/webp",
          scaleFactor: size / Math.max(page.size.width, page.size.height),
          withAnnotations: true,
        })
        .toPromise();
    } finally {
      await engine.closeDocument(document).toPromise();
    }
  } else if (format === "docx") {
    const { createDocxThumbnailRenderer, parseDocxForViewer } =
      await import("@extend-ai/react-docx");
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error("Preview unavailable");
    const document = await parseDocxForViewer(await response.blob(), {
      fileName,
      loadEmbeddedFonts: false,
    });
    signal.throwIfAborted();
    const renderer = createDocxThumbnailRenderer(document, {
      pixelRatio: 1,
      scheduling: "immediate",
    });
    try {
      blob = (
        await renderer.renderPage(0, {
          maxWidth: size,
          maxHeight: size,
          pixelRatio: 1,
          scheduling: "immediate",
          output: "blob",
          mimeType: "image/webp",
        })
      ).blob;
    } finally {
      renderer.dispose();
    }
  } else if (format === "pptx") {
    const { createPptxThumbnailRenderer, parsePresentation } =
      await import("@extend-ai/react-pptx");
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error("Preview unavailable");
    const presentation = await parsePresentation(await response.blob());
    signal.throwIfAborted();
    const renderer = createPptxThumbnailRenderer(presentation, {
      concurrency: 1,
      fonts: {
        loadEmbeddedFonts: false,
        reportMissingFonts: false,
        waitForFonts: false,
      },
    });
    try {
      blob = (
        await renderer.renderSlide(0, {
          maxWidth: size,
          maxHeight: size,
          pixelRatio: 1,
          output: "blob",
          signal,
        })
      ).data;
    } finally {
      renderer.destroy();
    }
  } else if (imageExtensions.includes(format)) {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error("Preview unavailable");
    const image = await createImageBitmap(await response.blob());
    try {
      signal.throwIfAborted();
      const scale = Math.min(1, size / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob | undefined>((resolve) =>
        canvas.toBlob(
          (value) => resolve(value ?? undefined),
          "image/webp",
          0.9,
        ),
      );
    } finally {
      image.close();
    }
  } else if (format === "xlsx" || textExtensions.includes(format)) {
    const { renderDocumentThumbnail } =
      await import("./document-thumbnail-utils");
    const result = await renderDocumentThumbnail(url, fileName, 0, size);
    signal.throwIfAborted();
    return result ? { url: result.url, release: () => {} } : null;
  }
  signal.throwIfAborted();
  if (!blob) return null;
  const preview = URL.createObjectURL(blob);
  return { url: preview, release: () => URL.revokeObjectURL(preview) };
}
