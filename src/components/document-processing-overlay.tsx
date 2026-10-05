import { Spinner } from "./coss/spinner";

export function isDocumentProcessing(status?: string) {
  const normalized = status?.toLowerCase().replaceAll(" ", "_");
  return normalized === "processing" || normalized === "queued";
}

export function DocumentProcessingOverlay() {
  return (
    <div
      data-document-processing-overlay=""
      role="status"
      aria-label="Processing document"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        borderRadius: "inherit",
        pointerEvents: "none",
        backgroundColor: "rgb(0 0 0 / 45%)",
        backdropFilter: "blur(1.5px)",
        color: "white",
      }}
    >
      <Spinner
        aria-hidden="true"
        role="presentation"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          display: "block",
          width: 20,
          height: 20,
          minWidth: 0,
          minHeight: 0,
          maxWidth: "60%",
          maxHeight: "60%",
        }}
      />
    </div>
  );
}
