import { ToggleGroup as CossToggleGroup } from "@/components/coss/toggle-group";
import type { ComponentProps } from "react";
export { ToggleGroupItem } from "@/components/coss/toggle-group";
export function ToggleGroup({
  spacing,
  style,
  ...props
}: ComponentProps<typeof CossToggleGroup> & {
  spacing?: number;
}) {
  return (
    <CossToggleGroup
      {...props}
      style={{
        ...style,
        ...(spacing !== undefined ? { gap: spacing * 4 } : {}),
      }}
    />
  );
}
