import { extension, textExtensions } from "../../shared/file-types";
import { FileText } from "./icons";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react";
import { FileThumbnail } from "./extend/file-thumbnail";
const XlsxThumbnails = lazy(() =>
  import("./xlsx-thumbnail-generator").then((module) => ({
    default: module.XlsxThumbnailUrlGenerator,
  })),
);
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
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ratio, setRatio] = useState(0.78);
  const captureSheets = useCallback((urls: string[]) => {
    setPreview(urls[0] ?? null);
    setRatio(1.6);
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setPreview(null);
    setFailed(false);
    setLoading(false);
    if (
      mime.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(name)
    )
      setPreview(src);
    else if (
      /\.(pdf|docx|pptx|json|ya?ml)$/i.test(name) ||
      mime === "application/pdf" ||
      textExtensions.includes(extension(name))
    ) {
      setLoading(true);
      void import("@/lib/document-thumbnail-utils")
        .then(({ renderDocumentThumbnail }) =>
          renderDocumentThumbnail(src, name, 0, 160),
        )
        .then((thumbnail) => {
          if (active) {
            setPreview(thumbnail?.url ?? null);
            setRatio(thumbnail?.aspectRatio ?? 0.78);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [src, mime, name, visible]);
  return (
    <span
      data-resource-thumbnail=""
      ref={host}
      className={previewOnly && (!preview || failed) ? "hidden" : className}
    >
      {visible && /\.xlsx$/i.test(name) && !preview && (
        <Suspense>
          <XlsxThumbnails url={src} fileName={name} onUrls={captureSheets} />
        </Suspense>
      )}
      {inline ? (
        preview && !failed ? (
          <img
            src={preview}
            alt=""
            className="block size-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <FileText className="block size-full text-muted-foreground" />
        )
      ) : (
        (!previewOnly || (preview && !failed)) && (
          <FileThumbnail
            file={{ name, type: mime }}
            className="w-full"
            previewAspectRatio={square ? 1 : ratio}
            previewImageUrl={preview}
            previewContent={
              !preview && !loading ? (
                <FileText className="size-4 text-muted-foreground" />
              ) : undefined
            }
            isLoading={loading}
            onPreviewError={() => setFailed(true)}
          />
        )
      )}
    </span>
  );
}
