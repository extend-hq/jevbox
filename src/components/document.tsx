import { DocumentIndexTree } from "./document-index-tree";
import { IndexStatusControl } from "./index-status-control";
import { PreviewCard } from "@base-ui/react/preview-card";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from "./coss/alert-dialog";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import {
  ParsedBlocks,
  ParsedBlockOverlay,
  documentBlocks,
  sectionBlocks,
} from "./parsed-blocks";
import {
  blockHighlightArea,
  type ParsedBlock,
} from "../../shared/parsed-blocks";
import {
  useDocumentSidebarPreference,
  useDocumentSidebarWidthPreference,
} from "@/lib/preferences";
import { ResourceThumbnail } from "./resource-thumbnail";
import { ResourceAccessBadge } from "./resource-access-badge";
import { RouteLink } from "./route-link";
import { ScrollArea } from "@/components/coss/scroll-area";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  DownloadOutline,
  ChevronDown,
  FileText,
  IndexTreeIcon,
  Link2,
  LockKeyhole,
  FolderFilled,
  Share2,
  Trash2,
  TriangleAlert,
} from "@/components/icons";
import { Button } from "@/components/coss/button";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/coss/tabs";
import { api, flatten, type IndexNode, type Resource } from "@/lib/api";
import { Loading, Markdown, plainTextPreview, useAction } from "./common";
import {
  DocumentNavigationContext,
  DocumentViewerIndexLayout,
  DocumentViewerInspectorToggle,
} from "./extend/document-viewer-sidebar";
import { JsonCodeViewer } from "./json-code-viewer";
import {
  DocumentDetailsSkeleton,
  DocumentIndexSkeleton,
  DocumentViewerLoadingShell,
} from "./document-viewer-loading";
import type { PDFViewerHandle } from "@/components/extend/pdf-viewer";
const OtherViewer = lazy(() =>
  import("./other-viewer").then((m) => ({ default: m.OtherViewer })),
);
const PDFViewer = lazy(() =>
  import("@/components/extend/pdf-viewer").then((m) => ({
    default: m.PDFViewer,
  })),
);
const DocxViewer = lazy(() =>
  import("@/components/extend/docx-viewer").then((m) => ({
    default: m.DocxViewerPreview,
  })),
);
const XlsxViewer = lazy(() =>
  import("@/components/extend/xlsx-viewer").then((m) => ({
    default: m.XlsxViewerPreview,
  })),
);
const PptxViewer = lazy(() =>
  import("@/components/extend/pptx-viewer").then((m) => ({
    default: m.PptxViewerPreview,
  })),
);
const filingNotes: Record<string, string> = {
  no_naming_model:
    "Connect a chat provider or select an available folder naming model in organization settings. The document stayed in its current location.",
  ambiguous:
    "No more specific folder was a clear fit. The document stayed in the closest suitable parent.",
  proposal_rejected:
    "JEV did not approve the proposed folder. The document stayed in its current location.",
  depth_limit:
    "The folder hierarchy was too deep to finish selecting a placement. The document stayed in the parent reached.",
  disabled: "Automatic filing was off when this document was processed.",
};
function SourcePreviewLayout({
  view,
  onViewChange,
  count,
  preview,
  blocks,
}: {
  view: string;
  onViewChange: (view: string) => void;
  count?: number;
  preview: ReactNode;
  blocks: ReactNode;
}) {
  return (
    <section className="source-document" aria-label="Source details">
      <Tabs
        value={view}
        onValueChange={(value) => onViewChange(String(value))}
        className="source-document-tabs"
      >
        <div className="source-document-tabbar">
          <TabsList size="sm" aria-label="Source preview view">
            <TabsTab value="preview">Preview</TabsTab>
            <TabsTab value="blocks">
              Source blocks <span className="count">{count ?? "…"}</span>
            </TabsTab>
          </TabsList>
        </div>
        <TabsPanel
          value="preview"
          className="min-h-0 overflow-hidden"
          keepMounted
        >
          {preview}
        </TabsPanel>
        <TabsPanel value="blocks" className="min-h-0 overflow-hidden">
          {blocks}
        </TabsPanel>
      </Tabs>
    </section>
  );
}
export function DocumentView({
  documentId,
  initialResource,
  userId,
  initialNode,
  initialTab,
  sharedToken,
  focusBlockIds,
  focusPage,
  focusRequest,
  embedded = false,
  onNavigate,
  onBack,
  onShare,
  onChange,
}: {
  documentId: string;
  initialResource?: Resource;
  userId?: string;
  initialNode?: string;
  initialTab: string;
  sharedToken?: string;
  focusBlockIds?: string[];
  focusPage?: number;
  focusRequest?: number;
  embedded?: boolean;
  onNavigate: (node: string | undefined, tab: string) => void;
  onBack: () => void;
  onShare: (r: Resource) => void;
  onChange: () => void;
}) {
  const [doc, setDoc] = useState<Resource | null>(() =>
    initialResource?.id === documentId ? initialResource : null,
  );
  const [loadedDocumentId, setLoadedDocumentId] = useState<string>();
  const detailsLoading = loadedDocumentId !== documentId && !doc?.parsed;
  const filingNote = filingNotes[doc?.filing?.reason ?? ""];
  const selected = initialNode ?? "";
  const tab = ["index", "links"].includes(initialTab) ? initialTab : "parsed";
  const [activeBlockId, setActiveBlockId] = useState<string>();
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [parsedView, setParsedView] = useState("blocks");
  const [sourceView, setSourceView] = useState("preview");
  const [sectionView, setSectionView] = useState("content");
  const [childrenOpen, setChildrenOpen] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const inspectorRef = usePanelRef();
  const inspectorResizing = useRef(false);
  useEffect(() => {
    const finish = () => {
      inspectorResizing.current = false;
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, []);
  const [navigationOpen, setNavigationOpen] = useDocumentSidebarPreference(
    userId,
    "left",
  );
  const [inspectorOpen, setInspectorOpen] = useDocumentSidebarPreference(
    userId,
    "right",
  );
  const [inspectorWidth, setInspectorWidth] = useDocumentSidebarWidthPreference(
    userId,
    "right",
  );
  const [inspectorAnimating, setInspectorAnimating] = useState(false);
  const inspectorAnimationTimer =
    useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(inspectorAnimationTimer.current), []);
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 800px)").matches,
  );
  useEffect(() => {
    if (!rootElement) return;
    const update = () => {
      const width = rootElement.getBoundingClientRect().width;
      if (width > 0) setCompact(width < 800);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rootElement);
    return () => observer.disconnect();
  }, [rootElement]);
  useEffect(() => {
    if (!doc || embedded) return;
    if (inspectorOpen) {
      inspectorRef.current?.expand();
      if (!compact && inspectorWidth !== undefined)
        inspectorRef.current?.resize(inspectorWidth);
    } else inspectorRef.current?.collapse();
  }, [doc?.id, embedded, inspectorOpen, inspectorRef, inspectorWidth, compact]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewerDark, setViewerDark] = useState(false);
  const action = useAction();
  const pdf = useRef<PDFViewerHandle>(null);
  useEffect(() => {
    let stopped = false;
    setDoc(initialResource?.id === documentId ? initialResource : null);
    setActiveBlockId(undefined);
    action.setError("");
    const refresh = async () => {
      try {
        const value = await api<Resource>(
          sharedToken
            ? `/shared/${sharedToken}/resources/${documentId}`
            : `/resources/${documentId}`,
        );
        if (!stopped) {
          setDoc(value);
          setLoadedDocumentId(documentId);
        }
      } catch (e) {
        if (!stopped) {
          setDoc(null);
          action.setError((e as Error).message);
        }
      }
    };
    void refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [documentId, sharedToken]);
  useEffect(() => {
    if (!doc?.parsed || (!initialNode && !embedded)) return;
    const target = flatten(doc.parsed.nodes).find((n) => n.id === initialNode);
    const allBlocks = documentBlocks(doc.parsed);
    const candidates = focusBlockIds?.length
      ? allBlocks.filter((block) => focusBlockIds.includes(block.id))
      : initialNode
        ? sectionBlocks(target, allBlocks)
        : focusPage
          ? allBlocks.filter((block) => block.page === focusPage)
          : allBlocks;
    const block =
      candidates.find((block) => blockHighlightArea(block)) ?? candidates[0];
    setActiveBlockId(block?.id);
    const area =
      block &&
      blockHighlightArea(block, pdf.current?.getPageRotation(block.page));
    if (area && block) pdf.current?.scrollToPageArea(block.page, area);
    else if (focusPage) pdf.current?.scrollToPage(focusPage);
    else if (target) pdf.current?.scrollToPage(target.page);
    else if (!initialNode) pdf.current?.scrollToPage(1);
    if (embedded) setSourceView("preview");
  }, [
    initialNode,
    doc?.id,
    doc?.status,
    !!doc?.parsed,
    focusBlockIds?.join(","),
    focusPage,
    focusRequest,
    embedded,
  ]);
  if (!doc && embedded)
    return (
      <SourcePreviewLayout
        view={sourceView}
        onViewChange={setSourceView}
        preview={
          action.error ? (
            <p className="error" role="alert">
              {action.error}
            </p>
          ) : (
            <DocumentViewerLoadingShell
              label="Opening source"
              showToolbar={false}
            />
          )
        }
        blocks={
          <DocumentViewerLoadingShell
            label="Opening source"
            showToolbar={false}
          />
        }
      />
    );
  if (!doc)
    return (
      <div ref={setRootElement} className="document-page">
        <header className="document-header">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label={
                sharedToken ? "Back to shared folder" : "Back to library"
              }
            >
              <ArrowLeft size={18} />
            </Button>
            <div className="size-10 rounded-md bg-muted" aria-hidden="true" />
            <div className="space-y-2" aria-hidden="true">
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
          </div>
          <Button variant="outline" disabled>
            <DownloadOutline size={14} />
            Download
          </Button>
        </header>
        <div ref={setToolbarHost} className="document-viewer-toolbar" />
        <Group
          key="loading-document"
          orientation={compact ? "vertical" : "horizontal"}
          className="document-workspace"
        >
          <Panel
            defaultSize={
              inspectorOpen
                ? compact
                  ? "55%"
                  : inspectorWidth === undefined
                    ? "66%"
                    : undefined
                : "100%"
            }
            minSize={compact ? "25%" : "30%"}
          >
            <DocumentNavigationContext.Provider
              value={{
                userId,
                index: <DocumentIndexSkeleton />,
                initiallyOpen: true,
                navigationOpen,
                onNavigationOpenChange: setNavigationOpen,
                toolbarHost,
                inspectorOpen,
                onToggleInspector: () => setInspectorOpen(!inspectorOpen),
              }}
            >
              {action.error ? (
                <div className="p-6 error" role="alert">
                  {action.error}
                </div>
              ) : (
                <DocumentViewerLoadingShell label="Opening document" />
              )}
            </DocumentNavigationContext.Provider>
          </Panel>
          {inspectorOpen && (
            <>
              <Separator
                className="document-inspector-divider"
                aria-label="Resize document sidebar"
              />
              <Panel
                defaultSize={compact ? "45%" : (inspectorWidth ?? "34%")}
                minSize={compact ? "25%" : "280px"}
              >
                <aside
                  className="document-inspector"
                  aria-label="Document details"
                >
                  <Tabs value={tab} className="document-tabs">
                    <div className="inspector-tabbar">
                      <TabsList
                        variant="underline"
                        aria-label="Document details"
                      >
                        <TabsTab value="parsed" disabled>
                          <FileText size={14} />
                          Parsed output
                        </TabsTab>
                        <TabsTab value="index" disabled>
                          <IndexTreeIcon size={14} />
                          Section
                        </TabsTab>
                        <TabsTab value="links" disabled>
                          <Link2 size={14} />
                          Links
                        </TabsTab>
                      </TabsList>
                    </div>
                    <div className="relative min-h-0 flex-1 overflow-hidden p-4">
                      <DocumentDetailsSkeleton />
                    </div>
                  </Tabs>
                </aside>
              </Panel>
            </>
          )}
        </Group>
      </div>
    );
  const nodes = doc.parsed ? flatten(doc.parsed.nodes) : [];
  const node = nodes.find((n) => n.id === selected) ?? nodes[0];
  const sectionContent = node?.content.replace(
    /^#{1,6}[ \t]+([^\n]+)\n?/,
    (heading, title: string) =>
      title.trim() === node.title.trim() ? "" : heading,
  );
  const links = nodes.flatMap((n) => n.links.map((l) => ({ ...l, node: n })));
  const src = sharedToken
    ? `/api/shared/${sharedToken}/resources/${doc.id}/content`
    : `/api/documents/${doc.id}/content`;
  const ext = doc.name.split(".").pop()?.toLowerCase();
  const indexIssue = doc.status === "failed" || doc.status === "awaiting_key";
  const indexing = doc.status === "queued" || doc.status === "processing";
  const blocks = documentBlocks(doc.parsed);
  const selectedBlocks = focusBlockIds?.length
    ? blocks.filter((block) => focusBlockIds.includes(block.id))
    : selected
      ? sectionBlocks(node, blocks)
      : [];
  const selectedBlockIds = selectedBlocks.map((block) => block.id);
  const selectBlock = (block: ParsedBlock) => {
    if (activeBlockId === block.id) return;
    setActiveBlockId(block.id);
    const area = blockHighlightArea(
      block,
      pdf.current?.getPageRotation(block.page),
    );
    if (area) pdf.current?.scrollToPageArea(block.page, area);
    else pdf.current?.scrollToPage(block.page);
  };
  const select = (n: IndexNode) => {
    const firstBlock = sectionBlocks(n, blocks)[0];
    setActiveBlockId(firstBlock?.id);
    setSelectionVersion((version) => version + 1);
    setChildrenOpen(false);
    onNavigate(n.id, tab);
    const area =
      firstBlock &&
      blockHighlightArea(
        firstBlock,
        pdf.current?.getPageRotation(firstBlock.page),
      );
    if (area && firstBlock)
      pdf.current?.scrollToPageArea(firstBlock.page, area);
    else pdf.current?.scrollToPage(n.page);
  };
  const retryIndex = async () => {
    await api(`/documents/${doc.id}/retry`, { method: "POST" });
    setDoc({ ...doc, status: "queued", error: undefined });
    onChange();
  };
  const reindex = () => void action.run(retryIndex);
  const indexingNotice = indexIssue ? (
    <div className={`index-warning ${doc.status}`} role="alert">
      <TriangleAlert className="size-4.5 shrink-0 micro-alert-icon" />
      <div>
        <strong>Waiting for the document index</strong>
        <p>
          {doc.status === "awaiting_key"
            ? "Connect Extend to index this document."
            : doc.error || "Indexing failed. Try again."}
        </p>
        {doc.canWrite &&
          (doc.status === "awaiting_key" ? (
            <RouteLink href="/settings/connections">Open connections</RouteLink>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={action.busy}
              onClick={reindex}
            >
              Retry indexing
            </Button>
          ))}
      </div>
    </div>
  ) : (
    <Loading label="Waiting for the document index" />
  );
  const indexContent = detailsLoading ? (
    <DocumentIndexSkeleton />
  ) : nodes.length ? (
    <nav className="viewer-index" aria-label="Document index">
      <DocumentIndexTree
        nodes={doc.parsed?.nodes ?? []}
        selected={selected}
        onSelect={select}
      />
    </nav>
  ) : (
    <div className="p-4">
      {doc.status === "stored" ? (
        <p className="muted text-sm">No index is available for this format.</p>
      ) : indexing || indexIssue ? (
        indexingNotice
      ) : (
        <p className="muted text-sm">
          No sections were found in this document.
        </p>
      )}
    </div>
  );
  const navigation = {
    userId,
    index: indexContent,
    initiallyOpen: !embedded,
    navigationOpen,
    onNavigationOpenChange: setNavigationOpen,
    toolbarHost,
    inspectorOpen,
    onToggleInspector: () => {
      setInspectorAnimating(true);
      clearTimeout(inspectorAnimationTimer.current);
      setInspectorOpen(!inspectorOpen);
      inspectorAnimationTimer.current = setTimeout(
        () => setInspectorAnimating(false),
        240,
      );
    },
    target:
      selected && node
        ? {
            key: `${doc.id}:${node.id}:${selectionVersion}`,
            page: node.page,
            title: node.title,
            content: node.content,
          }
        : undefined,
  };
  if (embedded) {
    const sourceBlocks =
      selected || focusBlockIds?.length ? selectedBlocks : blocks;
    const sourceIds = sourceBlocks.map((block) => block.id);
    const focusPdf = () => {
      const block =
        sourceBlocks.find((block) => blockHighlightArea(block)) ??
        sourceBlocks[0];
      const area =
        block &&
        blockHighlightArea(block, pdf.current?.getPageRotation(block.page));
      if (area && block) pdf.current?.scrollToPageArea(block.page, area);
      else if (focusPage) pdf.current?.scrollToPage(focusPage);
      else if (node) pdf.current?.scrollToPage(node.page);
    };
    return (
      <SourcePreviewLayout
        view={sourceView}
        onViewChange={setSourceView}
        count={sourceBlocks.length}
        preview={
          <DocumentNavigationContext.Provider
            value={{
              ...navigation,
              index: null,
              toolbarHost: null,
              onToggleInspector: undefined,
              initiallyOpen: false,
              navigationOpen: undefined,
              onNavigationOpenChange: undefined,
            }}
          >
            <Suspense
              fallback={
                <DocumentViewerLoadingShell
                  extension={ext}
                  label="Loading source"
                  showToolbar={false}
                />
              }
            >
              {ext === "pdf" ? (
                <PDFViewer
                  ref={pdf}
                  src={src}
                  fileName={doc.name}
                  showToolbar={false}
                  showUpload={false}
                  defaultZoom="fit-width"
                  className="h-full"
                  onDocumentLoadSuccess={focusPdf}
                  renderPageOverlay={({
                    pageNumber,
                    pageWidth,
                    pageHeight,
                    sourceRotation,
                  }) => (
                    <ParsedBlockOverlay
                      blocks={sourceBlocks}
                      page={pageNumber}
                      selectedIds={sourceIds}
                      activeId={activeBlockId}
                      width={pageWidth}
                      height={pageHeight}
                      sourceRotation={sourceRotation}
                    />
                  )}
                />
              ) : ext === "docx" ? (
                <DocxViewer
                  src={src}
                  fileName={doc.name}
                  isDark={viewerDark}
                  onIsDarkChange={setViewerDark}
                  showToolbar={false}
                  showUpload={false}
                  defaultZoom="fit-width"
                  className="h-full"
                />
              ) : ext === "pptx" ? (
                <PptxViewer
                  src={src}
                  fileName={doc.name}
                  initialSlide={node?.page}
                  showToolbar={false}
                  showUpload={false}
                  defaultZoom="fit-width"
                  className="h-full"
                />
              ) : ext === "xlsx" ? (
                <XlsxViewer
                  src={src}
                  fileName={doc.name}
                  isDark={viewerDark}
                  onIsDarkChange={setViewerDark}
                  showToolbar={false}
                  showUpload={false}
                  className="h-full"
                />
              ) : (
                <OtherViewer
                  doc={doc}
                  src={src}
                  imageOverlay={(width, height) => (
                    <ParsedBlockOverlay
                      blocks={sourceBlocks}
                      page={1}
                      selectedIds={sourceIds}
                      width={width}
                      height={height}
                    />
                  )}
                />
              )}
            </Suspense>
          </DocumentNavigationContext.Provider>
        }
        blocks={
          <ScrollArea scrollFade>
            <div className="p-4">
              {sourceBlocks.length ? (
                <ParsedBlocks
                  blocks={sourceBlocks}
                  selectedIds={sourceIds}
                  activeId={activeBlockId}
                  onSelect={(block) => {
                    setSourceView("preview");
                    requestAnimationFrame(() => selectBlock(block));
                  }}
                />
              ) : (
                <Markdown allowHtml>
                  {sectionContent ?? "No parsed source content is available."}
                </Markdown>
              )}
            </div>
          </ScrollArea>
        }
      />
    );
  }
  return (
    <div
      ref={setRootElement}
      className={`document-page ${embedded ? "document-embedded" : ""}`}
    >
      <header className="document-header">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              sharedToken ? "Back to shared folder" : "Back to library"
            }
            onClick={onBack}
          >
            <ArrowLeft size={18} />
          </Button>
          <ResourceThumbnail
            name={doc.name}
            mime={doc.mime}
            src={src}
            previewOnly
          />
          <div className="min-w-0">
            <h1>{doc.name}</h1>
            <p>
              {doc.pages
                ? `${doc.pages} ${doc.pages === 1 ? "page" : "pages"} · `
                : ""}
              {(doc.size / 1024).toFixed(1)} KB
              <ResourceAccessBadge access={doc.access} />
              <IndexStatusControl
                badge
                status={doc.status}
                error={doc.error}
                onRetry={doc.canWrite ? retryIndex : undefined}
              />
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {!embedded && doc.canShare && (
            <Button variant="outline" onClick={() => onShare(doc)}>
              <Share2 size={14} />
              Share
            </Button>
          )}
          <Button
            variant="outline"
            render={<a href={src} download={doc.name} />}
          >
            <DownloadOutline size={14} />
            Download
          </Button>
          {!embedded && doc.canShare && (
            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="destructive-outline"
                    size="icon"
                    aria-label="Delete document"
                  />
                }
              >
                <Trash2 className="size-4" />
              </AlertDialogTrigger>
              <AlertDialogPopup>
                <div className="flex flex-col gap-2 p-6">
                  <AlertDialogTitle className="text-lg font-semibold">
                    Delete document?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-sm text-muted-foreground">
                    This permanently deletes the document and its index. This
                    action cannot be undone.
                  </AlertDialogDescription>
                  {action.error && (
                    <p className="error" role="alert">
                      {action.error}
                    </p>
                  )}
                </div>
                <div className="flex justify-end gap-2 border-t bg-muted/50 px-6 py-4 rounded-b-2xl">
                  <AlertDialogClose
                    render={<Button variant="outline" disabled={action.busy} />}
                  >
                    Cancel
                  </AlertDialogClose>
                  <Button
                    variant="destructive"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await api(`/resources/${doc.id}`, { method: "DELETE" });
                        setConfirmDelete(false);
                        onChange();
                        onBack();
                      })
                    }
                  >
                    {action.busy ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              </AlertDialogPopup>
            </AlertDialog>
          )}
        </div>
      </header>
      <div ref={setToolbarHost} className="document-viewer-toolbar" />
      <Group
        key="document-workspace"
        orientation={compact ? "vertical" : "horizontal"}
        className="document-workspace"
        data-inspector-animating={inspectorAnimating ? "true" : undefined}
        onLayoutChanged={(_layout, meta) => {
          if (!compact && meta.isUserInteraction) {
            const size = inspectorRef.current?.getSize();
            if (size && size.inPixels >= 280) setInspectorWidth(size.inPixels);
          }
        }}
      >
        <Panel
          id="document-viewer"
          defaultSize={
            inspectorOpen
              ? compact
                ? "55%"
                : inspectorWidth === undefined
                  ? "66%"
                  : undefined
              : "100%"
          }
          minSize={compact ? "25%" : "30%"}
        >
          <div className="original-panel h-full" aria-label="Document viewer">
            <DocumentNavigationContext.Provider value={navigation}>
              <Suspense
                fallback={<DocumentViewerLoadingShell extension={ext} />}
              >
                {ext === "pdf" ? (
                  <PDFViewer
                    ref={pdf}
                    defaultZoom="fit-width"
                    src={src}
                    fileName={doc.name}
                    toolbarActions={<DocumentViewerInspectorToggle />}
                    showDownload={false}
                    showUpload={false}
                    onDocumentLoadSuccess={() => {
                      const block = selectedBlocks[0];
                      const area =
                        block &&
                        blockHighlightArea(
                          block,
                          pdf.current?.getPageRotation(block.page),
                        );
                      if (area && block)
                        pdf.current?.scrollToPageArea(block.page, area);
                      else if (selected && node)
                        pdf.current?.scrollToPage(node.page);
                    }}
                    className="h-full"
                    renderPageOverlay={({
                      pageNumber,
                      pageWidth,
                      pageHeight,
                      sourceRotation,
                    }) =>
                      tab === "parsed" || tab === "index" ? (
                        <ParsedBlockOverlay
                          blocks={blocks}
                          page={pageNumber}
                          activeId={activeBlockId}
                          selectedIds={selectedBlockIds}
                          width={pageWidth}
                          height={pageHeight}
                          sourceRotation={sourceRotation}
                        />
                      ) : null
                    }
                  />
                ) : ext === "docx" ? (
                  <DocxViewer
                    src={src}
                    defaultZoom={100}
                    toolbarActions={<DocumentViewerInspectorToggle />}
                    fileName={doc.name}
                    isDark={viewerDark}
                    onIsDarkChange={setViewerDark}
                    showUpload={false}
                    className="h-full"
                  />
                ) : ext === "xlsx" ? (
                  <DocumentViewerIndexLayout inlineToolbar>
                    <XlsxViewer
                      src={src}
                      fileName={doc.name}
                      isDark={viewerDark}
                      onIsDarkChange={setViewerDark}
                      showUpload={false}
                      toolbarActions={<DocumentViewerInspectorToggle />}
                      className="h-full"
                    />
                  </DocumentViewerIndexLayout>
                ) : ext === "pptx" ? (
                  <PptxViewer
                    src={src}
                    fileName={doc.name}
                    showUpload={false}
                    className="h-full"
                  />
                ) : (
                  <DocumentViewerIndexLayout>
                    <OtherViewer
                      doc={doc}
                      src={src}
                      imageOverlay={
                        tab === "parsed" || tab === "index"
                          ? (width, height) => (
                              <ParsedBlockOverlay
                                blocks={blocks}
                                page={1}
                                activeId={activeBlockId}
                                selectedIds={selectedBlockIds}
                                width={width}
                                height={height}
                              />
                            )
                          : undefined
                      }
                    />
                  </DocumentViewerIndexLayout>
                )}
              </Suspense>
            </DocumentNavigationContext.Provider>
          </div>
        </Panel>
        <Separator
          className={`document-inspector-divider ${inspectorOpen ? "" : "hidden"}`}
          aria-label="Resize document sidebar"
          onPointerDown={() => {
            inspectorResizing.current = true;
          }}
        />
        <Panel
          id="document-inspector"
          panelRef={inspectorRef}
          collapsible
          collapsedSize={0}
          onResize={(size, _id, previousSize) => {
            if (
              inspectorResizing.current &&
              previousSize &&
              size.inPixels > 0 !== inspectorOpen
            )
              setInspectorOpen(size.inPixels > 0);
          }}
          defaultSize={
            inspectorOpen ? (compact ? "45%" : (inspectorWidth ?? "34%")) : 0
          }
          minSize={compact ? "25%" : "280px"}
          groupResizeBehavior="preserve-pixel-size"
        >
          <aside
            className="document-inspector"
            aria-label="Document details"
            inert={!inspectorOpen}
          >
            <Tabs
              value={tab}
              onValueChange={(v) => onNavigate(initialNode, String(v))}
              className="document-tabs"
            >
              <div className="inspector-tabbar">
                <TabsList variant="underline" aria-label="Document details">
                  <TabsTab value="parsed">
                    <FileText size={14} /> Parsed output
                  </TabsTab>
                  <TabsTab value="index">
                    <IndexTreeIcon size={14} />
                    Section{" "}
                    {indexIssue && (
                      <TriangleAlert
                        className="size-4 micro-alert-icon"
                        aria-label="Index needs attention"
                      />
                    )}
                  </TabsTab>
                  <TabsTab value="links">
                    <Link2 size={14} />
                    Links{" "}
                    <span className="count">
                      {detailsLoading ? "…" : links.length}
                    </span>
                  </TabsTab>
                </TabsList>
              </div>
              <TabsPanel
                value="index"
                className="document-scroll-panel section-output-panel"
              >
                <div className="parsed-view-toolbar">
                  <Tabs
                    value={sectionView}
                    onValueChange={(value) => setSectionView(String(value))}
                  >
                    <TabsList size="sm" aria-label="Section view">
                      <TabsTab value="content">Content</TabsTab>
                      <TabsTab value="blocks">Blocks</TabsTab>
                      <TabsTab value="json">JSON</TabsTab>
                      <TabsTab value="links">Links</TabsTab>
                    </TabsList>
                  </Tabs>
                </div>
                {sectionView === "json" && node ? (
                  <JsonCodeViewer value={node} />
                ) : (
                  <ScrollArea scrollFade>
                    <article className="index-detail">
                      {doc.filing &&
                        ([
                          "pending",
                          "working",
                          "awaiting_key",
                          "failed",
                        ].includes(doc.filing.state) ||
                          filingNote) && (
                          <div className="index-warning" role="status">
                            <FolderFilled className="size-4.5 shrink-0" />
                            <div>
                              <strong>
                                {doc.filing.state === "failed"
                                  ? "Automatic filing stopped"
                                  : doc.filing.state === "awaiting_key"
                                    ? "Automatic filing needs a connection"
                                    : filingNote
                                      ? "Document kept in its current folder"
                                      : "Finding a folder for this document"}
                              </strong>
                              <p>
                                {doc.filing.error ??
                                  filingNote ??
                                  (doc.filing.state === "awaiting_key"
                                    ? "Connect TypeSafe in organization settings. The document is already indexed."
                                    : "The document is indexed and available while its folder is selected.")}
                              </p>
                              {doc.canShare &&
                                (doc.filing.state === "failed" ||
                                  (filingNote &&
                                    doc.filing.state !== "disabled")) && (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    disabled={action.busy}
                                    onClick={() =>
                                      void action.run(async () => {
                                        await api(
                                          `/documents/${doc.id}/filing/retry`,
                                          { method: "POST" },
                                        );
                                        setDoc({
                                          ...doc,
                                          filing: {
                                            state: "pending",
                                            error: null,
                                          },
                                        });
                                        onChange();
                                      })
                                    }
                                  >
                                    Retry filing
                                  </Button>
                                )}
                              {doc.canShare &&
                                (doc.filing.state === "awaiting_key" ||
                                  doc.filing.reason === "no_naming_model") && (
                                  <RouteLink href="/settings/connections">
                                    Open connections
                                  </RouteLink>
                                )}
                            </div>
                          </div>
                        )}
                      {node && indexIssue && indexingNotice}
                      {detailsLoading ? (
                        <DocumentDetailsSkeleton />
                      ) : node ? (
                        <>
                          <div className="node-breadcrumb">
                            <IndexTreeIcon size={14} /> Document <span>/</span>{" "}
                            Section <span>/</span> Page {node.page}
                          </div>
                          <div className="node-heading">
                            <div>
                              <span className="eyebrow">
                                Section{" "}
                                {String(nodes.indexOf(node) + 1).padStart(
                                  2,
                                  "0",
                                )}
                              </span>
                              <h2>{node.title}</h2>
                            </div>
                            <span className="page-pill">
                              p. {node.page}
                              {node.endPage !== node.page
                                ? `–${node.endPage}`
                                : ""}
                            </span>
                          </div>
                          <p className="node-summary">
                            {plainTextPreview(node.summary, node.title)}
                          </p>
                          <div className="node-connections">
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-pressed={sectionView === "blocks"}
                              onClick={() => setSectionView("blocks")}
                            >
                              <FileText size={14} />
                              {node.blocks.length} blocks
                            </Button>
                            <PreviewCard.Root
                              open={childrenOpen}
                              onOpenChange={setChildrenOpen}
                            >
                              <PreviewCard.Trigger
                                render={<Button variant="ghost" size="xs" />}
                                onClick={() => setChildrenOpen((open) => !open)}
                                aria-expanded={childrenOpen}
                              >
                                <IndexTreeIcon size={14} />
                                {node.children.length} child sections
                              </PreviewCard.Trigger>
                              <PreviewCard.Portal>
                                <PreviewCard.Positioner
                                  sideOffset={8}
                                  className="z-50"
                                >
                                  <PreviewCard.Popup className="section-children-preview">
                                    <h3>Child sections</h3>
                                    {node.children.length ? (
                                      node.children.map((child) => (
                                        <button
                                          type="button"
                                          key={child.id}
                                          onClick={() => select(child)}
                                        >
                                          <IndexTreeIcon size={14} />
                                          <span>
                                            <strong>{child.title}</strong>
                                            <small>
                                              {plainTextPreview(
                                                child.summary,
                                                child.title,
                                              )}
                                            </small>
                                          </span>
                                          <span className="page-pill">
                                            p. {child.page}
                                          </span>
                                        </button>
                                      ))
                                    ) : (
                                      <p className="muted">
                                        This section has no child sections.
                                      </p>
                                    )}
                                  </PreviewCard.Popup>
                                </PreviewCard.Positioner>
                              </PreviewCard.Portal>
                            </PreviewCard.Root>
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-pressed={sectionView === "links"}
                              onClick={() => setSectionView("links")}
                            >
                              <Link2 size={14} />
                              {node.links.length} links
                            </Button>
                          </div>
                          {sectionView === "blocks" ? (
                            <ParsedBlocks
                              blocks={
                                node.blocks.length
                                  ? node.blocks
                                  : sectionBlocks(node, blocks)
                              }
                              activeId={activeBlockId}
                              selectedIds={selectedBlockIds}
                              onSelect={selectBlock}
                            />
                          ) : sectionView === "links" ? (
                            node.links.length ? (
                              node.links.map((link, index) => (
                                <div className="link-row" key={index}>
                                  <Link2 size={16} />
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {link.label}
                                    <ArrowUpRight size={13} />
                                  </a>
                                </div>
                              ))
                            ) : (
                              <div className="empty-inline">
                                No links in this section.
                              </div>
                            )
                          ) : (
                            <Markdown allowHtml>
                              {sectionContent ?? ""}
                            </Markdown>
                          )}
                        </>
                      ) : doc.status === "stored" ? (
                        <div className="empty-inline">
                          This format is stored for viewing and download.
                          Content indexing is unavailable.
                        </div>
                      ) : indexing || indexIssue ? (
                        <div className="index-waiting">{indexingNotice}</div>
                      ) : (
                        <div className="empty-inline">
                          No sections were found in this document.
                        </div>
                      )}
                    </article>
                  </ScrollArea>
                )}
              </TabsPanel>
              <TabsPanel
                value="parsed"
                className="document-scroll-panel parsed-output-panel"
              >
                <div className="parsed-panel inspector-parsed">
                  <div className="parsed-view-toolbar">
                    <Tabs
                      value={parsedView}
                      onValueChange={(value) => setParsedView(String(value))}
                    >
                      <TabsList size="sm" aria-label="Parsed output view">
                        <TabsTab value="blocks">Blocks</TabsTab>
                        <TabsTab value="json">JSON</TabsTab>
                      </TabsList>
                    </Tabs>
                  </div>
                  {parsedView === "json" && doc.parsed ? (
                    <JsonCodeViewer value={doc.parsed} />
                  ) : (
                    <ScrollArea className="parsed-block-scroll" scrollFade>
                      {detailsLoading ? (
                        <DocumentDetailsSkeleton />
                      ) : blocks.length ? (
                        <>
                          {!blocks.some((block) => blockHighlightArea(block)) &&
                            doc.parsed?.source === "extend" &&
                            (ext === "pdf" ||
                              doc.mime.startsWith("image/")) && (
                              <p className="muted text-xs">
                                This index has no saved coordinates. Reindex the
                                document to enable bounding box highlights.
                                {doc.canWrite && (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    className="mt-2"
                                    disabled={
                                      action.busy ||
                                      ["queued", "processing"].includes(
                                        doc.status,
                                      )
                                    }
                                    onClick={reindex}
                                  >
                                    Reindex document
                                  </Button>
                                )}
                              </p>
                            )}
                          <ParsedBlocks
                            blocks={blocks}
                            activeId={activeBlockId}
                            selectedIds={selectedBlockIds}
                            scrollToId={selectedBlocks[0]?.id}
                            onSelect={selectBlock}
                          />
                        </>
                      ) : indexIssue ? (
                        indexingNotice
                      ) : (
                        <div className="empty-inline">
                          {doc.status === "stored"
                            ? "Parsed output is unavailable for this format."
                            : indexing
                              ? "Parsed content will appear here when indexing is complete."
                              : "No parsed content is available."}
                        </div>
                      )}
                    </ScrollArea>
                  )}
                </div>
              </TabsPanel>
              <TabsPanel value="links" className="document-scroll-panel">
                <ScrollArea scrollFade>
                  <div className="links-panel">
                    <h2>Links from this document</h2>
                    <p className="muted">
                      References extracted from the source, with the section
                      they belong to.
                    </p>
                    {detailsLoading ? (
                      <DocumentDetailsSkeleton />
                    ) : links.length ? (
                      links.map((l, i) => (
                        <div className="link-row" key={i}>
                          <Link2 size={19} />
                          <div>
                            <a
                              href={l.url}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              {l.label}
                              <ArrowUpRight size={13} />
                            </a>
                            <p>{l.url}</p>
                            <button
                              onClick={() => {
                                select(l.node);
                              }}
                            >
                              {l.node.title} · p. {l.node.page}
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="empty-inline">
                        No external links were found in the parsed content.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsPanel>
            </Tabs>
          </aside>
        </Panel>
      </Group>
      {action.error && !confirmDelete && (
        <div className="error" role="alert">
          {action.error}
        </div>
      )}
    </div>
  );
}
