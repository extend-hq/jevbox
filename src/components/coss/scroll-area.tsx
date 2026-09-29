"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import React, { useMemo } from "react";
import { cn } from "@/lib/utils";

export function ScrollArea({
  className,
  children,
  scrollFade = true,
  scrollbarGutter = false,
  fill = false,
  clampContentMinWidth = true,
  overscrollContain = true,
  orientation = "both",
  scrollbarOverflowOnly = true,
  viewportClassName,
  viewportProps,
  viewportRef,
  contentProps,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollFade?: boolean;
  scrollbarGutter?: boolean;
  fill?: boolean;
  clampContentMinWidth?: boolean;
  overscrollContain?: boolean;
  orientation?: "vertical" | "horizontal" | "both";
  scrollbarOverflowOnly?: boolean;
  viewportClassName?: string;
  viewportProps?: ScrollAreaPrimitive.Viewport.Props;
  viewportRef?: React.Ref<HTMLDivElement>;
  contentProps?: ScrollAreaPrimitive.Content.Props;
}): React.ReactElement {
  const {
    className: viewportClasses,
    ref: forwardedViewportRef,
    ...viewport
  } = viewportProps ?? {};
  const mergedViewportRef = useMemo(
    () => (node: HTMLDivElement | null) => {
      const refs = [forwardedViewportRef, viewportRef];
      const cleanups = refs.map((ref) => {
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      });
      return () =>
        refs.forEach((ref, index) => {
          const cleanup = cleanups[index];
          if (typeof cleanup === "function") cleanup();
          else if (typeof ref === "function") ref(null);
          else if (ref) ref.current = null;
        });
    },
    [forwardedViewportRef, viewportRef],
  );
  const {
    className: contentClassName,
    style: contentStyle,
    ...content
  } = contentProps ?? {};
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      data-scroll-fade={scrollFade || undefined}
      className={cn(
        "size-full min-h-0 min-w-0",
        scrollbarOverflowOnly &&
          "[&>[data-slot=scroll-area-scrollbar][data-hidden]]:hidden",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...viewport}
        ref={mergedViewportRef}
        className={cn(
          "h-full w-full max-h-[inherit] min-w-0 rounded-[inherit] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          overscrollContain &&
            "data-has-overflow-y:overscroll-y-contain data-has-overflow-x:overscroll-x-contain",
          scrollFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] [--fade-size:1.5rem]",
          scrollbarGutter &&
            "data-has-overflow-y:pe-2.5 data-has-overflow-x:pb-2.5",
          viewportClasses,
          viewportClassName,
        )}
        data-slot="scroll-area-viewport"
      >
        <ScrollAreaPrimitive.Content
          {...content}
          className={cn(fill && "size-full", contentClassName)}
          data-slot="scroll-area-content"
          style={{
            ...(clampContentMinWidth ? { minWidth: 0 } : {}),
            ...contentStyle,
          }}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
      {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
      {orientation === "both" && (
        <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
      )}
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props): React.ReactElement {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        "m-1 flex opacity-0 transition-opacity delay-300 data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5 data-[orientation=horizontal]:flex-col data-hovering:opacity-100 data-scrolling:opacity-100 data-hovering:delay-0 data-scrolling:delay-0 data-hovering:duration-100 data-scrolling:duration-100",
        className,
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        className="relative flex-1 rounded-full bg-foreground/20"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollAreaPrimitive };
