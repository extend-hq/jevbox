import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { RefreshCw, TriangleWarningFilled } from "./icons";
import { IndexStatusBadge, indexStatusDescription } from "./index-status-badge";
import { Button } from "./ui/button";
import {
  Popover,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function needsIndexAttention(status?: string) {
  return (
    !!status &&
    !["ready", "queued", "processing"].includes(
      status.toLowerCase().replaceAll(" ", "_"),
    )
  );
}

export function IndexStatusControl({
  status,
  error,
  onRetry,
  badge = false,
  className,
}: {
  status: string;
  error?: string;
  onRetry?: () => Promise<unknown>;
  badge?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keepOpen = () => {
    clearTimeout(leaveTimer.current);
    setOpen(true);
  };
  const leave = () => {
    leaveTimer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useEffect(() => {
    setOpen(false);
    setRetryError(undefined);
  }, [status]);
  const description = indexStatusDescription(status, error);
  if (!needsIndexAttention(status)) {
    return badge ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <IndexStatusBadge status={status} error={error} tabIndex={0} />
          }
        />
        <TooltipPopup className="max-w-72">{description}</TooltipPopup>
      </Tooltip>
    ) : null;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          onRetry
            ? "Not indexed. Retry indexing"
            : "Not indexed. View indexing status"
        }
        data-index-attention={status}
        className={cn(
          "index-status-trigger outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          padding: 0,
          borderRadius: 5,
          cursor: "pointer",
          background: badge ? "transparent" : "var(--color-background)",
          color: "var(--color-amber-600, #d97706)",
          width: badge ? undefined : 20,
          height: badge ? undefined : 20,
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") keepOpen();
        }}
        onPointerLeave={leave}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          keepOpen();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") event.stopPropagation();
        }}
      >
        {badge ? (
          <IndexStatusBadge status={status} error={error} />
        ) : (
          <TriangleWarningFilled style={{ width: 16, height: 16 }} />
        )}
      </PopoverTrigger>
      <PopoverPopup
        tooltipStyle
        side="top"
        initialFocus={false}
        className="max-w-72"
        onPointerEnter={keepOpen}
        onPointerLeave={leave}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") event.stopPropagation();
        }}
      >
        <div className="flex flex-col items-start gap-2 py-1">
          <PopoverTitle className="sr-only">Indexing status</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
          {retryError && (
            <p role="alert" className="text-destructive">
              {retryError}
            </p>
          )}
          {onRetry && (
            <Button
              size="xs"
              variant="outline"
              loading={busy}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setRetryError(undefined);
                try {
                  await onRetry();
                  setOpen(false);
                } catch (failure) {
                  setRetryError(
                    failure instanceof Error
                      ? failure.message
                      : "Could not restart indexing. Try again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw className="size-3.5" />
              Retry indexing
            </Button>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
