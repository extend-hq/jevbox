import { Loader2 } from "@/components/icons";
import type React from "react";
import { cn } from "@/lib/utils";
export function Spinner({
  className,
  ...props
}: React.ComponentProps<"svg">): React.ReactElement {
  return (
    <Loader2
      aria-label="Loading"
      className={cn(className)}
      role="status"
      {...props}
    />
  );
}
