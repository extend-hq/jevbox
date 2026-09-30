import { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  useXlsxViewerController,
  useXlsxViewerThumbnails,
  XlsxViewerProvider,
} from "@extend-ai/react-xlsx";

type Preview = { url: string; pageCount: number; aspectRatio: number };
type Format = "image/webp" | "image/png";
const cache = new Map<string, Promise<Preview | null>>();

function Capture({
  pageIndex,
  width,
  format,
  done,
}: {
  pageIndex: number;
  width: number;
  format: Format;
  done: (value: Preview | null) => void;
}) {
  const { thumbnails } = useXlsxViewerThumbnails({
    includeHeaders: true,
    resolution: { maxWidth: width, maxHeight: width },
  });
  useEffect(() => {
    if (!thumbnails.length) return;
    const thumbnail = thumbnails[pageIndex];
    if (!thumbnail) {
      done(null);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = thumbnail.width;
    canvas.height = thumbnail.height;
    if (thumbnail.paint(canvas))
      done({
        url: canvas.toDataURL(format, 0.82),
        pageCount: thumbnails.length,
        aspectRatio: thumbnail.width / thumbnail.height,
      });
  }, [thumbnails, pageIndex, format, done]);
  return null;
}

function Workbook({
  file,
  fileName,
  pageIndex,
  width,
  format,
  done,
  fail,
}: {
  file: ArrayBuffer;
  fileName: string;
  pageIndex: number;
  width: number;
  format: Format;
  done: (value: Preview | null) => void;
  fail: (error: Error) => void;
}) {
  const controller = useXlsxViewerController(
    useMemo(
      () => ({ file, fileName, readOnly: true, useWorker: true }),
      [file, fileName],
    ),
  );
  useEffect(() => {
    if (controller.error) fail(controller.error);
  }, [controller.error, fail]);
  return (
    <XlsxViewerProvider controller={controller} isDark={false}>
      <Capture
        pageIndex={pageIndex}
        width={width}
        format={format}
        done={done}
      />
    </XlsxViewerProvider>
  );
}

export function renderXlsxThumbnailUrl(
  url: string,
  fileName: string,
  pageIndex: number,
  width = 320,
  format: Format = "image/webp",
) {
  const key = `${url}#${pageIndex}#${width}#${format}`;
  let result = cache.get(key);
  if (!result) {
    result = (async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("Preview unavailable");
      const file = await response.arrayBuffer();
      const host = document.createElement("div");
      const root = createRoot(host);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<Preview | null>((done, fail) => {
          timer = setTimeout(
            () => fail(new Error("Preview timed out")),
            30_000,
          );
          root.render(
            <Workbook
              file={file}
              fileName={fileName}
              pageIndex={pageIndex}
              width={width}
              format={format}
              done={done}
              fail={fail}
            />,
          );
        });
      } finally {
        clearTimeout(timer);
        root.unmount();
      }
    })();
    cache.set(key, result);
    void result.catch(() => cache.delete(key));
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return result;
}
