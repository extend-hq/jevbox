import { useEffect, useRef, useState, type ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { useTheme } from "./theme";
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
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      <span className="sr-only" role="status">
        {active ? "Drop files to upload to this folder" : ""}
      </span>
    </BorderBeam>
  );
}
