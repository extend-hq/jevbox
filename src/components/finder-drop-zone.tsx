import { useEffect, useRef, useState, type ReactNode } from "react";
import { collectDroppedFiles } from "@/lib/dropped-files";
import { FINDER_DRAG_TYPE } from "@/lib/finder-drag";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from "./coss/alert-dialog";
import { Button } from "./coss/button";
export function FinderDropZone({
  children,
  onFiles,
  onMoveItems,
  currentPath,
  destinations,
}: {
  children: ReactNode;
  onFiles: (files: File[], parentId: string | null) => void;
  onMoveItems: (paths: string[], parentId: string | null) => void;
  currentPath: string;
  destinations: {
    path: string;
    id: string | null;
    name: string;
    writable: boolean;
  }[];
}) {
  const depth = useRef(0);
  const highlighted = useRef<HTMLElement | null>(null);
  const highlightedColumn = useRef<HTMLElement | null>(null);
  const draggedPaths = useRef<string[]>([]);
  const [active, setActive] = useState(false);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    files: File[];
    parentId: string | null;
    name: string;
  } | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState("");
  const clearHighlight = () => {
    highlighted.current?.removeAttribute("data-finder-drop-target");
    highlighted.current = null;
    highlightedColumn.current?.removeAttribute("data-finder-drop-column");
    highlightedColumn.current = null;
    setTargetName(null);
  };
  const reset = () => {
    depth.current = 0;
    setActive(false);
    clearHighlight();
    draggedPaths.current = [];
  };
  const accepts = (transfer: DataTransfer) =>
    Array.from(transfer.types).some(
      (type) => type === "Files" || type === FINDER_DRAG_TYPE,
    );
  const readPaths = (transfer: DataTransfer): string[] => {
    try {
      const value = JSON.parse(transfer.getData(FINDER_DRAG_TYPE));
      return Array.isArray(value) &&
        value.every((path) => typeof path === "string")
        ? value
        : [];
    } catch {
      return [];
    }
  };
  const targetFor = (event: React.DragEvent) => {
    for (const element of event.nativeEvent.composedPath()) {
      if (!(element instanceof HTMLElement)) continue;
      const path =
        element.dataset.entryPath ??
        (element.dataset.itemPath
          ? `${currentPath}${element.dataset.itemPath}`
          : undefined);
      const folder = path
        ? destinations.find(
            (folder) => folder.path === `${path.replace(/\/$/, "")}/`,
          )
        : undefined;
      const treeRoot = element.getRootNode();
      const parent =
        !folder && path && treeRoot instanceof ShadowRoot
          ? destinations.find(
              (folder) =>
                folder.path === path.slice(0, path.lastIndexOf("/") + 1),
            )
          : undefined;
      const parentRow =
        parent && treeRoot instanceof ShadowRoot
          ? ([
              ...treeRoot.querySelectorAll<HTMLElement>("[data-entry-path]"),
            ].find((row) => row.dataset.entryPath === parent.path) ?? null)
          : null;
      const area = element.dataset.dropFolderPath;
      const destination =
        folder ??
        parent ??
        (area !== undefined
          ? destinations.find((folder) => folder.path === area)
          : undefined);
      if (!destination) continue;
      const allowed =
        destination.writable &&
        !draggedPaths.current.some(
          (path) =>
            path === destination.path ||
            (path.endsWith("/") && destination.path.startsWith(path)),
        );
      return {
        destination,
        element: parent
          ? parentRow
          : element instanceof HTMLCanvasElement
            ? null
            : element,
        allowed,
        kind: folder || parent ? "row" : (element.dataset.dropKind ?? "area"),
      };
    }
    const destination = destinations.find(
      (folder) => folder.path === currentPath,
    );
    return destination
      ? {
          destination,
          element: null,
          allowed: destination.writable,
          kind: "area",
        }
      : null;
  };
  const highlight = (target: ReturnType<typeof targetFor>) => {
    const element = target?.allowed ? target.element : null;
    if (highlighted.current !== element) {
      highlighted.current?.removeAttribute("data-finder-drop-target");
      highlighted.current = element;
    }
    if (element) element.dataset.finderDropTarget = target!.kind;
    const column =
      element?.closest<HTMLElement>('[data-drop-kind="column"]') ?? null;
    if (highlightedColumn.current !== column) {
      highlightedColumn.current?.removeAttribute("data-finder-drop-column");
      highlightedColumn.current = column;
    }
    if (column) column.dataset.finderDropColumn = "";
    setTargetName(target?.allowed ? target.destination.name : null);
  };
  useEffect(() => {
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return (
    <>
      <div
        className="finder-drop-zone"
        data-dragging={active || undefined}
        onDragStart={(event) => {
          draggedPaths.current = readPaths(event.dataTransfer);
        }}
        onDragEnter={(event) => {
          if (!accepts(event.dataTransfer)) return;
          event.preventDefault();
          depth.current++;
          setActive(true);
          highlight(targetFor(event));
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) {
            setActive(false);
            clearHighlight();
          }
        }}
        onDragOver={(event) => {
          if (accepts(event.dataTransfer)) {
            event.preventDefault();
            setActive(true);
            const target = targetFor(event);
            highlight(target);
            event.dataTransfer.dropEffect = target?.allowed
              ? Array.from(event.dataTransfer.types).includes(FINDER_DRAG_TYPE)
                ? "move"
                : "copy"
              : "none";
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          const target = targetFor(event);
          const paths = readPaths(event.dataTransfer);
          reset();
          if (!target?.allowed) return;
          if (paths.length) {
            onMoveItems(paths, target.destination.id);
            return;
          }
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          if (collecting || pending) return;
          setError("");
          setCollecting(true);
          void collectDroppedFiles(event.dataTransfer)
            .then(({ files, hasDirectory }) => {
              if (!files.length) {
                setError("No files were found in the dropped folder.");
                return;
              }
              if (hasDirectory)
                setPending({
                  files,
                  parentId: target.destination.id,
                  name: target.destination.name,
                });
              else onFiles(files, target.destination.id);
            })
            .catch(() =>
              setError(
                "Couldn't read the dropped files. Try selecting them from your computer.",
              ),
            )
            .finally(() => setCollecting(false));
        }}
      >
        {children}
        <span className="sr-only" role="status">
          {collecting
            ? "Reading dropped files…"
            : active
              ? targetName
                ? `Drop into ${targetName}`
                : "This folder is not a valid drop destination"
              : ""}
        </span>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogPopup>
          <div className="flex flex-col gap-2 p-6">
            <AlertDialogTitle className="text-lg font-semibold">
              Upload {pending?.files.length.toLocaleString()}{" "}
              {pending?.files.length === 1 ? "file" : "files"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              All files in the dropped folders will be uploaded to{" "}
              {pending?.name}. Folder structure will be preserved.
            </AlertDialogDescription>
          </div>
          <div className="flex justify-end gap-2 rounded-b-2xl border-t bg-muted/50 px-6 py-4">
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                if (!pending) return;
                const { files, parentId } = pending;
                setPending(null);
                onFiles(files, parentId);
              }}
            >
              Upload {pending?.files.length.toLocaleString()}{" "}
              {pending?.files.length === 1 ? "file" : "files"}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
