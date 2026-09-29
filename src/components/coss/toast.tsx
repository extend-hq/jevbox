import { Toast } from "@base-ui/react/toast";
import { useEffect, type ReactNode } from "react";
import {
  CircleCheckFilled,
  LoaderCircle,
  TriangleWarningFilled,
  X,
} from "@/components/icons";
import { Button } from "./button";
export const toastManager = Toast.createToastManager();
function ToastList() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport
        data-slot="toast-viewport"
        className="fixed right-4 bottom-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] outline-none [--toast-inset:1rem]"
      >
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            swipeDirection={["down", "right"]}
            data-slot="toast-root"
            data-type={toast.type}
            className="coss-toast-root select-none rounded-lg border bg-popover text-popover-foreground shadow-lg/5 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
          >
            <Toast.Content className="pointer-events-auto flex items-center gap-2 overflow-hidden px-3.5 py-3 text-sm transition-opacity duration-250 data-behind:not-data-expanded:pointer-events-none data-behind:opacity-0 data-expanded:opacity-100">
              {toast.type === "loading" ? (
                <LoaderCircle className="size-4 shrink-0 text-muted-foreground" />
              ) : toast.type === "error" ? (
                <TriangleWarningFilled className="size-4 shrink-0 text-destructive" />
              ) : (
                <CircleCheckFilled className="size-4 shrink-0 text-success" />
              )}
              <div className="min-w-0 flex-1">
                <Toast.Title className="text-sm font-medium" />
                <Toast.Description className="text-xs text-muted-foreground" />
              </div>
              <Toast.Close
                aria-label="Dismiss notification"
                render={<Button variant="ghost" size="icon-xs" />}
              >
                <X />
              </Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
export function ToastProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const success = (event: Event) => {
      toastManager.add({
        title: (event as CustomEvent<string>).detail,
        type: "success",
      });
    };
    window.addEventListener("app-success", success);
    return () => window.removeEventListener("app-success", success);
  }, []);
  return (
    <Toast.Provider toastManager={toastManager} timeout={4000} limit={3}>
      {children}
      <ToastList />
    </Toast.Provider>
  );
}
