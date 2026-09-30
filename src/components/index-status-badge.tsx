import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { CircleCheckFilled, TriangleWarningFilled } from "./icons";

function normalizeStatus(status: string) {
  return status.toLowerCase().replaceAll(" ", "_");
}

function statusLabel(status: string) {
  return status === "ready" ? "Indexed" : status.replaceAll("_", " ");
}

export function indexStatusDescription(status: string, error?: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "ready")
    return "Index: complete. This document is ready for search and citations.";
  if (normalized === "stored")
    return "Index: unavailable for this format. The original is available for viewing and download.";
  if (normalized === "failed" || normalized === "awaiting_key")
    return `Index: ${statusLabel(normalized)}. ${error || (normalized === "awaiting_key" ? "Connect Extend to index this document." : "Indexing failed. Open Index to retry.")}`;
  return `Index: ${statusLabel(normalized)}. Parsed output and the index will appear when processing finishes.`;
}

export function IndexStatusBadge({
  status,
  error,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  status: string;
  error?: string;
}) {
  const normalized = normalizeStatus(status);
  return (
    <span
      className={cn("status-chip", normalized, className)}
      data-slot="badge"
      data-index-status={normalized}
      aria-label={indexStatusDescription(normalized, error)}
      {...props}
    >
      {normalized === "ready" ? (
        <CircleCheckFilled className="size-3.5" />
      ) : normalized === "failed" || normalized === "awaiting_key" ? (
        <TriangleWarningFilled className="size-4 micro-alert-icon" />
      ) : null}
      {statusLabel(normalized)}
    </span>
  );
}
