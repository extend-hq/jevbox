import { useEffect, useState, type CSSProperties } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { ScrollArea } from "./coss/scroll-area";
import { Spinner } from "./coss/spinner";
import { Check, ShapeTriangle } from "./icons";
import type { ChatTurn } from "../../shared/chat";

const delays = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  return ((index % 3) + Math.abs(row - 1)) * 90;
});

export function LoadingState({ label = "Working…" }: { label?: string }) {
  const [started] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(timer);
  }, [started]);
  const seconds = elapsed / 1000;
  return (
    <span className="work-loading-state" role="status" aria-label={label}>
      <span className="work-loader-grid" aria-hidden="true">
        {delays.map((delay, index) => (
          <span
            key={index}
            style={{ "--pixel-delay": `${delay}ms` } as CSSProperties}
          />
        ))}
      </span>
      <span className="shimmer" aria-hidden="true">
        {label}
      </span>
      <span className="work-elapsed" aria-hidden="true">
        {seconds < 60
          ? `${seconds.toFixed(1)}s`
          : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`}
      </span>
    </span>
  );
}

const stageLabel = (status: ChatTurn["status"]) =>
  status === "cancelling"
    ? "Stopping…"
    : status === "retrieving"
      ? "Finding sources…"
      : "Writing answer…";

export function ChatThinking({ status }: { status: ChatTurn["status"] }) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState([status]);
  useEffect(() => {
    setSteps((current) =>
      current.at(-1) === status ? current : [...current, status],
    );
  }, [status]);
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="chat-thinking"
    >
      <Collapsible.Trigger
        className="chat-thinking-trigger"
        aria-label="View response steps"
      >
        <LoadingState label={stageLabel(status)} />
        <ShapeTriangle
          size={10}
          className="disclosure-triangle"
          data-open={open || undefined}
        />
      </Collapsible.Trigger>
      <Collapsible.Panel className="retrieval-tree-panel">
        <ScrollArea
          className="h-auto max-h-32"
          orientation="vertical"
          scrollFade
        >
          <ol className="chat-thinking-steps" aria-label="Response steps">
            {steps.map((step, index) => (
              <li
                key={index}
                aria-current={index === steps.length - 1 ? "step" : undefined}
              >
                {index < steps.length - 1 ? (
                  <Check size={12} />
                ) : (
                  <Spinner className="chat-step-spinner" aria-hidden="true" />
                )}
                {stageLabel(step)}
              </li>
            ))}
          </ol>
        </ScrollArea>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
