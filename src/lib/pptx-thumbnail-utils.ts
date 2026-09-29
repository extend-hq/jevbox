"use client";

import {
  createPptxThumbnailRenderer,
  parsePresentation,
  type PptxThumbnailRenderer,
} from "@extend-ai/react-pptx";

const THUMBNAIL_WIDTH = 360;
const THUMBNAIL_HEIGHT = 203;

type PptxThumbnailSource = {
  pageCount: number;
  renderer: PptxThumbnailRenderer;
};

type PptxThumbnailResult = {
  aspectRatio: number;
  pageCount: number;
  url: string;
};

const sourceCache = new Map<string, Promise<PptxThumbnailSource>>();
const thumbnailCache = new Map<string, Promise<PptxThumbnailResult | null>>();

function getPptxThumbnailSource(url: string) {
  let sourcePromise = sourceCache.get(url);

  if (!sourcePromise) {
    sourcePromise = parsePresentation(url).then((presentation) => ({
      pageCount: presentation.document.slides.length,
      renderer: createPptxThumbnailRenderer(presentation, {
        concurrency: 2,
        fonts: {
          loadEmbeddedFonts: false,
          reportMissingFonts: false,
          waitForFonts: false,
        },
      }),
    }));
    sourcePromise.catch(() => sourceCache.delete(url));
    sourceCache.set(url, sourcePromise);
  }
  return sourcePromise;
}

export function renderPptxThumbnailUrl({
  pageIndex,
  url,
}: {
  pageIndex: number;
  url: string;
}) {
  const cacheKey = `${url}#${pageIndex}`;
  let thumbnailPromise = thumbnailCache.get(cacheKey);

  if (!thumbnailPromise) {
    thumbnailPromise = getPptxThumbnailSource(url).then(
      async ({ pageCount, renderer }) => {
        if (pageIndex < 0 || pageIndex >= pageCount) return null;

        const result = await renderer.renderSlide(pageIndex, {
          maxHeight: THUMBNAIL_HEIGHT,
          maxWidth: THUMBNAIL_WIDTH,
          output: "blob",
          pixelRatio: 1,
        });

        return {
          pageCount,
          url: URL.createObjectURL(result.data),
          aspectRatio: result.width / result.height,
        };
      },
    );
    thumbnailPromise.catch(() => thumbnailCache.delete(cacheKey));
    thumbnailCache.set(cacheKey, thumbnailPromise);
  }
  return thumbnailPromise;
}
