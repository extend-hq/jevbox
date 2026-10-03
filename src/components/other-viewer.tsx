import { ScrollArea } from "@/components/coss/scroll-area";
import { useEffect, useState, type ReactNode } from "react";
import {
  FileArchive,
  FileCode2,
  FileText,
  Minus,
  Plus,
  RotateCcw,
  Download,
} from "@/components/icons";
import { Button } from "@/components/coss/button";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/coss/tabs";
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  useTransformEffect,
} from "react-zoom-pan-pinch";
import JsonView from "@uiw/react-json-view";
import Papa from "papaparse";
import DOMPurify from "dompurify";
import { unzipSync } from "fflate";
import { CodeViewer } from "./code-viewer";
import {
  MediaController,
  MediaControlBar,
  MediaPlayButton,
  MediaTimeRange,
  MediaTimeDisplay,
  MediaMuteButton,
  MediaVolumeRange,
  MediaFullscreenButton,
} from "media-chrome/react";
import {
  extension,
  textExtensions,
  imageExtensions,
} from "../../shared/file-types";
import { Loading, Markdown } from "./common";
import type { Resource } from "@/lib/api";
import { useDocumentNavigation } from "./extend/document-viewer-sidebar";
function ImageZoomToolbar() {
  const navigation = useDocumentNavigation();
  const controls = useControls();
  const [scale, setScale] = useState(100);
  useTransformEffect(({ state }) => {
    setScale(Math.round(state.scale * 100));
  });
  const setter = navigation?.setToolbarControls;
  const toolbar = (
    <div className="image-header-controls flex items-center gap-1 ml-2">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom out"
        onClick={() => controls.zoomOut()}
      >
        <Minus size={16} />
      </Button>
      <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
        {scale}%
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom in"
        onClick={() => controls.zoomIn()}
      >
        <Plus size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Reset zoom"
        onClick={() => controls.resetTransform()}
      >
        <RotateCcw size={16} />
      </Button>
    </div>
  );
  useEffect(() => {
    setter?.(toolbar);
  }, [setter, scale]);
  useEffect(() => () => setter?.(null), [setter]);
  return setter ? null : <div className="image-toolbar">{toolbar}</div>;
}
export function OtherViewer({
  doc,
  src = `/api/documents/${doc.id}/content`,
  imageOverlay,
}: {
  doc: Resource;
  src?: string;
  imageOverlay?: (width: number, height: number) => ReactNode;
}) {
  const [imageSize, setImageSize] = useState({ width: 100, height: 100 });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<
    { name: string; size: number; text?: string }[]
  >([]);
  const [archiveText, setArchiveText] = useState("");
  const [archiveName, setArchiveName] = useState("");
  const [page, setPage] = useState(0);
  const [blobURL, setBlobURL] = useState<string | null>(null);
  const ext = extension(doc.name);
  useEffect(() => {
    const controller = new AbortController();
    let objectURL: string | undefined;
    let active = true;
    setError("");
    setText(null);
    async function load() {
      const response = await fetch(src, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("This file is no longer available.");
      if (ext === "zip") {
        const buffer = new Uint8Array(await response.arrayBuffer());
        let total = 0;
        let count = 0;
        const files = unzipSync(buffer, {
          filter(file) {
            count++;
            total += file.originalSize;
            if (
              count > 1000 ||
              total > 20 * 1024 * 1024 ||
              file.originalSize > 5 * 1024 * 1024
            )
              throw new Error(
                "This archive is too large to preview safely. Download it to inspect locally.",
              );
            return true;
          },
        });
        const rows = Object.entries(files).map(([name, bytes]) => ({
          name,
          size: bytes.byteLength,
          ...(textExtensions.includes(extension(name))
            ? { text: new TextDecoder().decode(bytes).slice(0, 100000) }
            : {}),
        }));
        if (active) setEntries(rows);
        return;
      }
      if (imageExtensions.includes(ext)) {
        let blob = await response.blob();
        if (ext === "svg") {
          const clean = DOMPurify.sanitize(await blob.text(), {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: [
              "foreignObject",
              "image",
              "use",
              "script",
              "a",
              "style",
            ],
            FORBID_ATTR: ["href", "xlink:href", "style"],
          });
          blob = new Blob([clean], { type: "image/svg+xml" });
        }
        objectURL = URL.createObjectURL(blob);
        if (active) setBlobURL(objectURL);
        return;
      }
      if (textExtensions.includes(ext)) {
        if (doc.size > 5 * 1024 * 1024)
          throw new Error(
            "This text file is larger than the 5 MB preview limit. Download it to inspect the full content.",
          );
        const content = await response.text();
        if (!active) return;
        setText(content);
      }
    }
    if (
      textExtensions.includes(ext) ||
      imageExtensions.includes(ext) ||
      ext === "zip"
    )
      void load().catch((e) => {
        if (active && !controller.signal.aborted) setError(e.message);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [doc.id, ext]);
  if (error)
    return (
      <div className="empty-inline">
        <FileText size={25} />
        <p>{error}</p>
        <Button
          className="mt-4"
          variant="outline"
          render={<a href={src} download={doc.name} />}
        >
          Download file
        </Button>
      </div>
    );
  if (imageExtensions.includes(ext))
    return !blobURL ? (
      <Loading label="Opening image" />
    ) : (
      <div className="image-viewer">
        <TransformWrapper
          initialScale={1}
          minScale={0.25}
          maxScale={10}
          centerOnInit
        >
          <ImageZoomToolbar />
          <TransformComponent
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{ width: "100%", height: "100%" }}
          >
            <div className="relative size-full">
              <img
                onLoad={(event) =>
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                src={blobURL}
                alt={doc.name}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  margin: "auto",
                }}
              />
              {imageOverlay?.(imageSize.width, imageSize.height)}
            </div>
          </TransformComponent>
        </TransformWrapper>
      </div>
    );
  if (doc.mime.startsWith("video/") || doc.mime.startsWith("audio/"))
    return (
      <div className="media-viewer">
        <MediaController
          audio={doc.mime.startsWith("audio/")}
          style={{ width: "100%", maxWidth: 900 }}
        >
          {doc.mime.startsWith("audio/") ? (
            <audio slot="media" src={src} preload="metadata" />
          ) : (
            <video
              slot="media"
              src={src}
              preload="metadata"
              style={{ width: "100%" }}
              playsInline
            />
          )}
          <MediaControlBar>
            <MediaPlayButton />
            <MediaTimeRange />
            <MediaTimeDisplay showDuration />
            <MediaMuteButton />
            <MediaVolumeRange />
            {doc.mime.startsWith("video/") && <MediaFullscreenButton />}
          </MediaControlBar>
        </MediaController>
        <p>{doc.name}</p>
      </div>
    );
  if (ext === "zip")
    return (
      <ScrollArea scrollFade>
        <div className="archive-viewer">
          <h2>
            <FileArchive size={22} />
            Archive contents
          </h2>
          <p>
            {entries.length} entries · files are previewed locally in your
            browser.
          </p>
          <div className="archive-layout">
            <div>
              {entries.map((entry) => (
                <button
                  key={entry.name}
                  disabled={entry.text === undefined}
                  onClick={() => {
                    setArchiveText(entry.text ?? "");
                    setArchiveName(entry.name);
                  }}
                >
                  <FileText size={14} />
                  <span>{entry.name}</span>
                  <small>{(entry.size / 1024).toFixed(1)} KB</small>
                </button>
              ))}
            </div>
            {archiveName ? (
              <CodeViewer name={archiveName} text={archiveText} />
            ) : (
              <p>Select a text file to preview its contents.</p>
            )}
          </div>
        </div>
      </ScrollArea>
    );
  if (textExtensions.includes(ext)) {
    if (text === null) return <Loading label="Opening file" />;
    if (["md", "markdown"].includes(ext))
      return (
        <ScrollArea scrollFade>
          <div className="reading-page">
            <Markdown>{text}</Markdown>
          </div>
        </ScrollArea>
      );
    if (["json", "ipynb"].includes(ext)) {
      try {
        const value = JSON.parse(text);
        if (value !== null && typeof value === "object")
          return (
            <ScrollArea className="json-scroll-area" scrollFade>
              <div className="json-viewer">
                <JsonView
                  value={value}
                  collapsed={2}
                  displayDataTypes={false}
                  enableClipboard={false}
                />
              </div>
            </ScrollArea>
          );
      } catch {}
    }
    if (["csv", "tsv"].includes(ext)) {
      const rows = Papa.parse<string[]>(text, {
        delimiter: ext === "tsv" ? "\t" : "",
        skipEmptyLines: true,
      }).data;
      const first = rows[0] ?? [];
      return (
        <div className="csv-viewer">
          <div className="csv-toolbar">
            <span>
              {Math.max(0, rows.length - 1)} rows · {first.length} columns
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>Page {page + 1}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * 100 >= rows.length - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
          <ScrollArea className="csv-table" scrollFade>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {first.map((cell, i) => (
                    <th key={i}>{cell || `Column ${i + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1 + page * 100, 101 + page * 100).map((row, i) => (
                  <tr key={i}>
                    <td>{1 + page * 100 + i}</td>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      );
    }
    const code = <CodeViewer name={doc.name} text={text} />;
    if (["html", "htm"].includes(ext)) {
      const sanitized = DOMPurify.sanitize(text, {
        FORBID_TAGS: [
          "script",
          "iframe",
          "object",
          "embed",
          "form",
          "base",
          "link",
          "meta",
        ],
        FORBID_ATTR: ["src", "srcset", "action", "formaction"],
      });
      return (
        <Tabs defaultValue="preview" className="html-viewer">
          <TabsList>
            <TabsTab value="preview">Rendered</TabsTab>
            <TabsTab value="code">Source</TabsTab>
          </TabsList>
          <TabsPanel value="preview">
            <iframe
              title="Sandboxed HTML preview"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{font-family:system-ui;padding:28px;color:#39485b;line-height:1.7}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}</style>${sanitized}`}
            />
          </TabsPanel>
          <TabsPanel value="code">{code}</TabsPanel>
        </Tabs>
      );
    }
    return code;
  }
  return (
    <div className="empty-inline">
      <FileCode2 size={32} />
      <h3>{doc.name}</h3>
      <p>A preview isn’t available for this format.</p>
      <p className="mt-2">
        {(doc.size / 1024).toFixed(1)} KB · {ext.toUpperCase() || "Binary file"}
      </p>
      <Button
        className="mt-5"
        variant="outline"
        render={<a href={src} download={doc.name} />}
      >
        <Download size={14} />
        Download original
      </Button>
    </div>
  );
}
