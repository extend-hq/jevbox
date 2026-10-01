import { useEffect, useRef, useState, type ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { useTheme } from "./theme";
import { collectDroppedFiles } from "@/lib/dropped-files";
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
}: {
  children: ReactNode;
  onFiles: (files: File[]) => void;
}) {
  const { dark } = useTheme();
  const depth = useRef(0);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState<File[] | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState("");
  const reset = () => {
    depth.current = 0;
    setActive(false);
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
      <BorderBeam
        active={active}
        colorVariant="ocean"
        staticColors
        theme={dark ? "dark" : "light"}
        duration={2.4}
        brightness={2.4}
        strength={1}
        size="md"
        borderRadius={8}
        className="finder-drop-zone"
        data-dragging={active || undefined}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          depth.current++;
          setActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setActive(false);
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          reset();
          if (collecting || pending) return;
          setError("");
          setCollecting(true);
          void collectDroppedFiles(event.dataTransfer)
            .then(({ files, hasDirectory }) => {
              if (!files.length) {
                setError("No files were found in the dropped folder.");
                return;
              }
              if (hasDirectory) setPending(files);
              else onFiles(files);
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
              ? "Drop files to upload to this folder"
              : ""}
        </span>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </BorderBeam>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogPopup>
          <div className="flex flex-col gap-2 p-6">
            <AlertDialogTitle className="text-lg font-semibold">
              Upload {pending?.length.toLocaleString()}{" "}
              {pending?.length === 1 ? "file" : "files"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              All files in the dropped folders will be uploaded. Folder
              structure will be preserved.
            </AlertDialogDescription>
          </div>
          <div className="flex justify-end gap-2 rounded-b-2xl border-t bg-muted/50 px-6 py-4">
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                if (!pending) return;
                const files = pending;
                setPending(null);
                onFiles(files);
              }}
            >
              Upload {pending?.length.toLocaleString()}{" "}
              {pending?.length === 1 ? "file" : "files"}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
