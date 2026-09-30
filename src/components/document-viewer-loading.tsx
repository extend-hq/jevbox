import { BoxLoader } from "./box-loader";
import { Button } from "./coss/button";
import { ChevronLeft, ChevronRight, Minus, Plus, PanelLeft } from "./icons";
import {
  DocumentViewerInspectorToggle,
  DocumentViewerThumbnailSidebar,
  DocumentViewerToolbar,
  useDocumentNavigation,
  useDocumentSidebarOpen,
  useElementWidth,
  useInlineThumbnailSidebar,
} from "./extend/document-viewer-sidebar";

export function DocumentViewerLoadingShell({
  extension,
  label = "Loading viewer",
  showToolbar = true,
}: {
  extension?: string;
  label?: string;
  showToolbar?: boolean;
}) {
  const navigation = useDocumentNavigation();
  const [open, setOpen] = useDocumentSidebarOpen(
    navigation?.initiallyOpen ?? false,
  );
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const paginated = ["pdf", "docx", "pptx"].includes(extension ?? "");
  const spreadsheet = extension === "xlsx";
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      aria-busy="true"
    >
      {showToolbar && (
        <DocumentViewerToolbar>
          <div className="flex min-h-12 shrink-0 items-center gap-2 border-b bg-background px-3 py-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle document navigation"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <PanelLeft size={16} />
            </Button>
            {paginated && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} />
                </Button>
                <span
                  className="h-7 w-16 rounded-md bg-muted"
                  aria-hidden="true"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled
                  aria-label="Next page"
                >
                  <ChevronRight size={16} />
                </Button>
              </>
            )}
            {(paginated || spreadsheet) && (
              <>
                <span className="mx-1 h-5 border-l" aria-hidden="true" />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled
                  aria-label="Zoom out"
                >
                  <Minus size={16} />
                </Button>
                <span
                  className="h-7 w-16 rounded-md bg-muted"
                  aria-hidden="true"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled
                  aria-label="Zoom in"
                >
                  <Plus size={16} />
                </Button>
              </>
            )}
            <div className="ml-auto">
              <DocumentViewerInspectorToggle />
            </div>
          </div>
        </DocumentViewerToolbar>
      )}
      <div
        ref={ref}
        className="relative flex min-h-0 flex-1 overflow-hidden bg-muted/30"
      >
        {showToolbar && (
          <DocumentViewerThumbnailSidebar
            inline={useInlineThumbnailSidebar(width)}
            open={open}
            onOpenChange={setOpen}
            indexOnly={!paginated}
          >
            <div className="p-4" aria-hidden="true">
              <div className="mx-auto h-28 w-20 rounded-md bg-muted" />
            </div>
          </DocumentViewerThumbnailSidebar>
        )}
        <div className="relative grid min-w-0 flex-1 place-items-center">
          <BoxLoader label={label} />
        </div>
      </div>
      {showToolbar && spreadsheet && (
        <div
          className="flex h-10 shrink-0 items-center gap-2 border-t bg-background px-3"
          aria-hidden="true"
        >
          <span className="h-6 w-20 rounded-md bg-muted" />
          <span className="h-6 w-20 rounded-md bg-muted" />
        </div>
      )}
    </div>
  );
}
