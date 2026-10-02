import type { Resource } from "@/lib/api";
import { FolderFilled, Globe2, LockFilled, UsersFilled } from "./icons";

export function ResourceAccessBadge({ access }: { access: Resource["access"] }) {
  const Icon =
    access === "link"
      ? Globe2
      : access === "organization"
        ? UsersFilled
        : access === "inherit"
          ? FolderFilled
          : LockFilled;
  const label =
    access === "link"
      ? "Link Sharing Enabled"
      : access === "organization"
        ? "Organization access"
        : access === "inherit"
          ? "Folder access"
          : "Private";
  return (
    <span
      className="status-chip document-access-badge"
      data-resource-access={access}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}
