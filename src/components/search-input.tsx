import type { ComponentProps } from "react";
import { Input } from "./coss/input";
import { Search } from "./icons";
import { cn } from "@/lib/utils";

export function SearchInput({
  className,
  ...props
}: ComponentProps<typeof Input>) {
  return (
    <div className="relative min-w-0">
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        aria-label={props["aria-label"] ?? props.placeholder}
        {...props}
        type="search"
        className={cn("pl-9", className)}
      />
    </div>
  );
}
