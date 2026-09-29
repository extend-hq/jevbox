import { AlertDialog as Primitive } from "@base-ui/react/alert-dialog";
import { cn } from "@/lib/utils";
export const AlertDialog = Primitive.Root;
export const AlertDialogTrigger = Primitive.Trigger;
export const AlertDialogClose = Primitive.Close;
export const AlertDialogTitle = Primitive.Title;
export const AlertDialogDescription = Primitive.Description;
export function AlertDialogPopup({
  className,
  ...props
}: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Backdrop className="fixed inset-0 z-50 bg-black/32 backdrop-blur-sm transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <Primitive.Viewport className="fixed inset-0 z-50 grid grid-rows-[1fr_auto_3fr] justify-items-center p-4">
        <Primitive.Popup
          className={cn(
            "row-start-2 w-full max-w-md rounded-2xl border bg-popover text-popover-foreground shadow-lg outline-none",
            className,
          )}
          {...props}
        />
      </Primitive.Viewport>
    </Primitive.Portal>
  );
}
