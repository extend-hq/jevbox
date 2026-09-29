import { Loader2Icon } from "@/components/icons";
import type React from "react";
import { cn } from "@/lib/utils";
export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement {
  return (
    <Loader2Icon
      aria-label="Loading"
      className={cn(className)}
      role="status"
      {...props}
    />
  );
}
