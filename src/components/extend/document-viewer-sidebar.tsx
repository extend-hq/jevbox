"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useDocumentSidebarWidthPreference } from "@/lib/preferences";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/coss/tabs";
import { Button } from "@/components/coss/button";
import { ScrollArea } from "@/components/coss/scroll-area";
import {
  PanelLeft,
  PanelRight,
  X,
  IndexTreeIcon,
  Grid2x2,
} from "@/components/icons";
export const DocumentNavigationContext = React.createContext<{
  index: React.ReactNode;
  userId?: string;
  initiallyOpen?: boolean;
  navigationOpen?: boolean;
  onNavigationOpenChange?: (open: boolean) => void;
  toolbarHost?: HTMLElement | null;
  indexToggle?: React.ReactNode;
  setToolbarControls?: (controls: React.ReactNode) => void;
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
  target?: { key: string; page: number; title: string; content: string };
} | null>(null);
export function useDocumentNavigation() {
  return React.useContext(DocumentNavigationContext);
}
export function useDocumentSidebarOpen(initiallyOpen = false) {
  const navigation = useDocumentNavigation();
  const [localOpen, setLocalOpen] = React.useState(initiallyOpen);
  const open = navigation?.navigationOpen ?? localOpen;
  const setOpen: React.Dispatch<React.SetStateAction<boolean>> = (value) => {
    const next = typeof value === "function" ? value(open) : value;
    if (navigation?.onNavigationOpenChange)
      navigation.onNavigationOpenChange(next);
    else setLocalOpen(next);
  };
  return [open, setOpen] as const;
}
export function DocumentViewerInspectorToggle() {
  const navigation = useDocumentNavigation();
  if (!navigation?.onToggleInspector) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={
        navigation.inspectorOpen ? "Hide right sidebar" : "Show right sidebar"
      }
      aria-expanded={navigation.inspectorOpen}
      onClick={navigation.onToggleInspector}
    >
      <PanelRight className="size-4" />
    </Button>
  );
}
export function DocumentViewerToolbar({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigation = useDocumentNavigation();
  return navigation?.toolbarHost ? (
    createPortal(children, navigation.toolbarHost)
  ) : (
    <>{children}</>
  );
}
const INLINE_THUMBNAIL_SIDEBAR_MIN_WIDTH = 520;
export function useElementWidth<TElement extends HTMLElement>() {
  const ref = React.useRef<TElement | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const updateWidth = () => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth === 0) return;
      setWidth(nextWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
export function useInlineThumbnailSidebar(width: number) {
  return width >= INLINE_THUMBNAIL_SIDEBAR_MIN_WIDTH;
}
export function DocumentViewerThumbnailSidebar({
  children,
  className,
  closedInlineClassName = "-ml-40",
  inline,
  open,
  onOpenChange,
  indexOnly = false,
  widthClassName = "w-40",
}: {
  children: React.ReactNode;
  className?: string;
  closedInlineClassName?: string;
  inline: boolean;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  indexOnly?: boolean;
  widthClassName?: string;
}) {
  const navigation = useDocumentNavigation();
  const [savedWidth, setWidth] = useDocumentSidebarWidthPreference(
    navigation?.userId,
    "left",
  );
  const sidebarRef = React.useRef<HTMLElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState(600);
  React.useLayoutEffect(() => {
    const container = sidebarRef.current?.parentElement;
    if (!container) return;
    const update = () => {
      if (container.clientWidth > 0) setAvailableWidth(container.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(
    180,
    Math.min(savedWidth ?? 240, 420, availableWidth - 64),
  );
  const drag = React.useRef<{ x: number; width: number } | null>(null);
  const resize = (value: number, element: HTMLElement) => {
    const available = element.parentElement?.parentElement?.clientWidth || 600;
    setWidth(Math.max(180, Math.min(value, 420, available - 64)));
  };
  const [hasToggled, setHasToggled] = React.useState(false);
  const previousOpen = React.useRef(open);
  const shouldAnimateSidebar = hasToggled;
  React.useEffect(() => {
    if (previousOpen.current !== open) setHasToggled(true);
    previousOpen.current = open;
  }, [open]);
  return (
    <aside
      ref={sidebarRef}
      aria-label={navigation ? "Document navigation" : "Thumbnails"}
      inert={!open}
      style={
        navigation
          ? {
              width,
              marginLeft: inline && !open ? -width : 0,
            }
          : undefined
      }
      data-document-thumbnail-sidebar=""
      data-sidebar-mode={inline ? "inline" : "overlay"}
      data-sidebar-open={open ? "true" : "false"}
      className={cn(
        "absolute inset-y-0 left-0 z-30 shrink-0 overflow-hidden border-r bg-sidebar shadow-lg",
        navigation ? "w-60" : widthClassName,
        shouldAnimateSidebar
          ? "transition-[translate,margin-left,border-color] duration-200 ease-out"
          : "transition-none",
        inline && "relative z-auto translate-x-0 shadow-none",
        open
          ? "ml-0 translate-x-0"
          : inline
            ? cn(
                "pointer-events-auto border-r-0",
                navigation ? "-ml-60" : closedInlineClassName,
              )
            : "pointer-events-none -translate-x-full border-r-0",
        className,
      )}
    >
      {navigation ? (
        <Tabs defaultValue="index" className="h-full min-h-0 gap-0">
          <div className="flex items-center border-b px-2">
            <TabsList
              variant="underline"
              className="flex-1"
              aria-label="Document navigation"
            >
              <TabsTab value="index">
                <IndexTreeIcon size={14} />
                Index
              </TabsTab>
              {!indexOnly && (
                <TabsTab value="thumbnails">
                  <Grid2x2 size={14} /> Thumbnails
                </TabsTab>
              )}
            </TabsList>
            {onOpenChange && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close document navigation"
                onClick={() => onOpenChange(false)}
              >
                <X size={14} />
              </Button>
            )}
          </div>
          <TabsPanel
            value="index"
            className="min-h-0 overflow-hidden"
            onClick={(event) => {
              if (
                !inline &&
                (event.target as HTMLElement).closest(".index-node")
              )
                onOpenChange?.(false);
            }}
          >
            <ScrollArea className="h-full" scrollFade>
              {navigation.index}
            </ScrollArea>
          </TabsPanel>
          {!indexOnly && (
            <TabsPanel value="thumbnails" className="min-h-0 overflow-hidden">
              {children}
            </TabsPanel>
          )}
        </Tabs>
      ) : (
        children
      )}
      {navigation && open && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize document navigation"
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={420}
          aria-valuenow={width}
          className="viewer-navigation-resizer"
          onPointerDown={(event) => {
            event.preventDefault();
            drag.current = { x: event.clientX, width };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current)
              resize(
                drag.current.width + event.clientX - drag.current.x,
                event.currentTarget,
              );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowLeft"
                ? width - 16
                : event.key === "ArrowRight"
                  ? width + 16
                  : event.key === "Home"
                    ? 180
                    : event.key === "End"
                      ? 420
                      : null;
            if (next !== null) {
              event.preventDefault();
              resize(next, event.currentTarget);
            }
          }}
        />
      )}
    </aside>
  );
}
export function DocumentViewerIndexLayout({
  children,
  inlineToolbar = false,
}: {
  children: React.ReactNode;
  inlineToolbar?: boolean;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const navigation = useDocumentNavigation();
  const [open, setOpen] = useDocumentSidebarOpen(
    navigation?.initiallyOpen ?? true,
  );
  const [toolbarControls, setToolbarControls] =
    React.useState<React.ReactNode>(null);
  const indexToggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle document navigation"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <PanelLeft size={16} />
    </Button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!inlineToolbar && (
        <DocumentViewerToolbar>
          <div className="flex min-h-12 shrink-0 items-center gap-2 border-b bg-background px-3 py-2">
            {indexToggle}
            {toolbarControls}
            <div className="ml-auto">
              <DocumentViewerInspectorToggle />
            </div>
          </div>
        </DocumentViewerToolbar>
      )}
      <div ref={ref} className="relative flex min-h-0 flex-1 overflow-hidden">
        <DocumentViewerThumbnailSidebar
          inline={useInlineThumbnailSidebar(width)}
          open={open}
          onOpenChange={setOpen}
          indexOnly
        >
          {null}
        </DocumentViewerThumbnailSidebar>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <DocumentNavigationContext.Provider
            value={
              navigation
                ? {
                    ...navigation,
                    setToolbarControls,
                    indexToggle: inlineToolbar ? indexToggle : undefined,
                  }
                : null
            }
          >
            {children}
          </DocumentNavigationContext.Provider>
        </div>
      </div>
    </div>
  );
}
export function DocumentViewerSidebarSkeleton({
  className,
  inline,
}: {
  className?: string;
  inline: boolean;
}) {
  if (!inline) return null;
  return (
    <div className={cn("w-40 shrink-0 border-r bg-sidebar p-4", className)}>
      <div className="mx-auto h-28 w-20 overflow-hidden rounded-md bg-background shadow-xs">
        <div className="h-full animate-pulse bg-muted" />
      </div>
      <div className="mx-auto mt-3 h-3 w-10 rounded-full bg-muted" />
    </div>
  );
}
