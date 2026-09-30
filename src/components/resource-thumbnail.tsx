import { useCallback, useEffect, useRef, useState } from "react";
import { thumbnailUrl } from "../../shared/thumbnails";
import { FileText } from "./icons";
import { FileThumbnail } from "./extend/file-thumbnail";

export function ResourceThumbnail({
  name,
  mime,
  src,
  className = "w-8 shrink-0 rounded-sm",
  square = false,
  previewOnly = false,
  inline = false,
}: {
  name: string;
  mime: string;
  src: string;
  className?: string;
  square?: boolean;
  previewOnly?: boolean;
  inline?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    previewOnly || typeof IntersectionObserver === "undefined",
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [ratio, setRatio] = useState(0.78);
  const attempts = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (visible || !host.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "80px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    clearTimeout(retry.current);
    attempts.current = 0;
    setLoaded(false);
    setFailed(false);
    setPreview(visible ? thumbnailUrl(src) : null);
    return () => clearTimeout(retry.current);
  }, [src, visible]);
  const load = useCallback((image: HTMLImageElement) => {
    setLoaded(true);
    setFailed(false);
    setRatio(image.naturalWidth / image.naturalHeight || 0.78);
  }, []);
  const fail = useCallback(() => {
    setFailed(true);
    if (++attempts.current > 15) return;
    clearTimeout(retry.current);
    retry.current = setTimeout(() => {
      setFailed(false);
      setPreview(
        `${thumbnailUrl(src)}?attempt=${Math.floor(Date.now() / 4000)}`,
      );
    }, 4000);
  }, [src]);
  return (
    <span
      data-resource-thumbnail=""
      ref={host}
      className={previewOnly && (!loaded || failed) ? "hidden" : className}
    >
      {inline ? (
        preview && !failed ? (
          <img
            src={preview}
            alt=""
            decoding="async"
            className="block size-full object-cover"
            onLoad={(event) => load(event.currentTarget)}
            onError={fail}
          />
        ) : (
          <FileText className="block size-full text-muted-foreground" />
        )
      ) : (
        <FileThumbnail
          file={{ name, type: mime }}
          className="w-full"
          previewAspectRatio={square ? 1 : ratio}
          previewImageUrl={failed ? null : preview}
          onPreviewLoad={load}
          onPreviewError={fail}
          imageLoading="eager"
          previewContent={
            !preview || failed ? (
              <FileText className="size-4 text-muted-foreground" />
            ) : undefined
          }
        />
      )}
    </span>
  );
}
