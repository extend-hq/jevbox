import { ChevronRight } from "@/components/icons";
import { ContextMenu as Primitive } from "@base-ui/react/context-menu";
import { cn } from "@/lib/utils";
export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export function ContextMenuPopup(props: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner className="z-50" sideOffset={4}>
        <Primitive.Popup
          className="min-w-40 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
export function ContextMenuItem({ className, ...props }: Primitive.Item.Props) {
  return (
    <Primitive.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export const ContextMenuSub = Primitive.SubmenuRoot;
export const ContextMenuSeparator = Primitive.Separator;
export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: Primitive.SubmenuTrigger.Props) {
  return (
    <Primitive.SubmenuTrigger
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-popup-open:bg-accent data-disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </Primitive.SubmenuTrigger>
  );
}
export function ContextMenuSubPopup(props: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        className="z-50"
        side="right"
        align="start"
        sideOffset={4}
      >
        <Primitive.Popup
          className="max-h-[min(24rem,var(--available-height))] min-w-48 max-w-80 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
