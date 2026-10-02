import type { Resource } from "@/lib/api";
import { FolderFilled, Globe2, LockFilled, UsersFilled } from "./icons";
export const resourceAccessOptions = [
  { value: "restricted", label: "Private", icon: LockFilled },
  { value: "organization", label: "Organization access", icon: UsersFilled },
  { value: "inherit", label: "Folder access", icon: FolderFilled },
  { value: "link", label: "Link Sharing Enabled", icon: Globe2 },
] as const;

export function ResourceAccessBadge({
  access,
}: {
  access: Resource["access"];
}) {
  const { icon: Icon, label } =
    resourceAccessOptions.find((option) => option.value === access) ??
    resourceAccessOptions[0];
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
