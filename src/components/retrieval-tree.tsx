import { useMemo, useState } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { ScrollArea } from "./coss/scroll-area";
import type { RetrievalStep } from "../../shared/retrieval";
import { FileText, Folder, IndexTreeIcon, ShapeTriangle } from "./icons";
import { blockStyle } from "./block-type-badge";
import { ResourceThumbnail } from "./resource-thumbnail";
import { OutlineTree } from "./outline-tree";
import { retrievalNodeId, retrievalOutline } from "../lib/retrieval-outline";

function SectionIcon({ step }: { step: RetrievalStep }) {
  const type =
    step.blockType ?? (step.parentNodeId ? "section_heading" : "heading");
  const { icon: Icon, tone } = blockStyle(type);
  return <Icon size={13} data-tone={tone} />;
}

function formatLatency(durationMs: number | undefined) {
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  )
    return null;
  const milliseconds = Math.round(durationMs);
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = Math.round(milliseconds / 100) / 10;
  if (seconds < 60) return `${seconds} s`;
  const wholeSeconds = Math.round(seconds);
  return `${Math.floor(wholeSeconds / 60)}m ${wholeSeconds % 60}s`;
}

export function RetrievalTree({
  trace,
  retrievalDurationMs,
  activeDocumentId,
  activeNodeId,
  onSelect,
  onPreview,
  defaultOpen = false,
}: {
  trace: RetrievalStep[];
  retrievalDurationMs?: number;
  activeDocumentId?: string;
  activeNodeId?: string;
  onSelect?: (documentId: string, nodeId?: string) => void;
  onPreview?: (documentId: string, nodeId?: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const latency = formatLatency(retrievalDurationMs);
  const nodes = useMemo(() => retrievalOutline(trace), [trace]);
  const documents = trace.filter((step) => step.stage === "document");
  const selectedIndex = trace.findIndex(
    (step) =>
      activeDocumentId &&
      step.resourceId === activeDocumentId &&
      (activeNodeId
        ? step.stage === "section" && step.nodeId === activeNodeId
        : step.stage === "document"),
  );
  const selected =
    selectedIndex >= 0
      ? retrievalNodeId(trace[selectedIndex], selectedIndex)
      : undefined;
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="retrieval-trace"
    >
      <Collapsible.Trigger className="retrieval-trigger">
        <ShapeTriangle
          className="disclosure-triangle"
          data-open={open || undefined}
          size={10}
        />
        <IndexTreeIcon size={14} />
        View retrieval path
        <span>
          {documents.length} {documents.length === 1 ? "document" : "documents"}
          {latency !== null && (
            <>
              <span aria-hidden="true"> · </span>
              <span
                title="Retrieval time"
                aria-label={`Retrieval time: ${latency}`}
              >
                {latency}
              </span>
            </>
          )}
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="retrieval-tree-panel">
        <ScrollArea
          className="h-auto max-h-[min(16rem,38vh)]"
          orientation="vertical"
          scrollFade
        >
          <OutlineTree
            nodes={nodes}
            selected={selected}
            label="Retrieval path"
            className="retrieval-tree"
            rowClassName={() => "retrieval-node"}
            accessibleLabel={({ step }) =>
              step.page ? `${step.label}, page ${step.page}` : step.label
            }
            canSelect={({ step }) =>
              (step.stage === "document" || step.stage === "section") &&
              !!step.resourceId
            }
            onSelect={
              onSelect
                ? ({ step }) => {
                    if (step.resourceId) onSelect(step.resourceId, step.nodeId);
                  }
                : undefined
            }
            onPreview={({ step }) => {
              if (
                step.resourceId &&
                (step.stage === "document" || step.stage === "section")
              )
                onPreview?.(step.resourceId, step.nodeId);
            }}
            renderIcon={({ step }) => {
              if (step.stage === "category") return <Folder size={14} />;
              if (step.stage === "section") return <SectionIcon step={step} />;
              if (step.stage === "document" && step.resourceId)
                return (
                  <ResourceThumbnail
                    name={step.label}
                    mime=""
                    src={`/api/documents/${step.resourceId}/content`}
                    className="retrieval-file-thumbnail"
                    square
                    inline
                  />
                );
              return <FileText size={14} />;
            }}
            renderMeta={({ step }) =>
              step.page ? (
                <small aria-hidden="true">p. {step.page}</small>
              ) : null
            }
          />
        </ScrollArea>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
