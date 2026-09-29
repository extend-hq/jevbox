"use client";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";
export const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border-(length:--hairline) border-neutral-600/5 dark:border-neutral-300/5 font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button&,a&]:cursor-pointer [button&,a&]:pointer-coarse:after:absolute [button&,a&]:pointer-coarse:after:size-full [button&,a&]:pointer-coarse:after:min-h-11 [button&,a&]:pointer-coarse:after:min-w-11",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-6 min-w-6 px-2 text-xs sm:h-5.5 sm:min-w-5.5",
        lg: "h-7 min-w-7 px-2.5 text-sm sm:h-6.5 sm:min-w-6.5",
        sm: "h-5 min-w-5 px-1.5 text-xs",
      },
      variant: {
        default:
          "bg-primary text-primary-foreground [button&,a&]:hover:bg-primary/90",
        destructive:
          "border-red-600/5 bg-destructive text-white dark:border-red-300/5 [button&,a&]:hover:bg-destructive/90",
        error:
          "border-red-600/5 bg-red-50 text-red-600 dark:border-red-300/5 dark:bg-red-300/10 dark:text-red-300",
        info: "border-blue-600/5 bg-blue-50 text-blue-600 dark:border-blue-300/5 dark:bg-blue-300/10 dark:text-blue-300",
        outline:
          "bg-background text-foreground dark:bg-input/32 [button&,a&]:hover:bg-accent/50 dark:[button&,a&]:hover:bg-input/48",
        secondary:
          "bg-neutral-100 text-neutral-600 dark:bg-neutral-300/10 dark:text-neutral-300 [button&,a&]:hover:bg-neutral-200/50 dark:[button&,a&]:hover:bg-neutral-300/15",
        success:
          "border-green-600/5 bg-green-50 text-green-700 dark:border-green-300/5 dark:bg-green-300/10 dark:text-green-300",
        warning:
          "border-amber-600/5 bg-amber-50 text-amber-700 dark:border-amber-300/5 dark:bg-amber-300/10 dark:text-amber-300",
      },
    },
  },
);
export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}
export function Badge({
  className,
  variant,
  size,
  render,
  ...props
}: BadgeProps): React.ReactElement {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}
