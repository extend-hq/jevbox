"use client";
import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { VariantProps } from "class-variance-authority";
import { badgeVariants } from "@/components/coss/badge";
import { cn } from "@/lib/utils";
export { badgeVariants };
export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
  asChild?: boolean;
}
export function Badge({
  className,
  variant,
  size,
  render,
  asChild = false,
  children,
  ...props
}: BadgeProps): React.ReactElement {
  const renderValue =
    render ??
    (asChild && React.isValidElement(children)
      ? (children as React.ReactElement<Record<string, unknown>>)
      : undefined);
  const defaultProps = {
    children: asChild && React.isValidElement(children) ? undefined : children,
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render: renderValue,
  });
}
