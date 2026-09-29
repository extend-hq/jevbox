import { useState } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { ScrollArea } from "./coss/scroll-area";
import type { RetrievalStep } from "../../shared/retrieval";
import { FileText, Folder, IndexTreeIcon, ShapeTriangle } from "./icons";
export function RetrievalTree({
  trace,
  activeDocumentId,
  activeNodeId,
  onSelect,
  onPreview,
  defaultOpen = false,
}: {
  trace: RetrievalStep[];
  activeDocumentId?: string;
  activeNodeId?: string;
  onSelect?: (documentId: string, nodeId?: string) => void;
  onPreview?: (documentId: string, nodeId?: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const categories = trace.filter((step) => step.stage === "category");
  const documents = trace.filter((step) => step.stage === "document");
  const sections = trace.filter((step) => step.stage === "section");
  function renderSections(
    documentId: string,
    parentNodeId?: string,
  ): React.ReactNode {
    return sections
      .filter(
        (step) =>
          step.resourceId === documentId &&
          (parentNodeId
            ? step.parentNodeId === parentNodeId
            : !step.parentNodeId ||
              !sections.some(
                (parent) =>
                  parent.resourceId === documentId &&
                  parent.nodeId === step.parentNodeId,
              )),
      )
      .map((step, i) => (
        <li key={step.nodeId ?? i}>
          <button
            className="retrieval-node"
            data-active={
              (activeDocumentId === documentId &&
                activeNodeId === step.nodeId) ||
              undefined
            }
            onClick={() => onSelect?.(documentId, step.nodeId)}
            onMouseMove={() => onPreview?.(documentId, step.nodeId)}
            onFocus={() => onPreview?.(documentId, step.nodeId)}
            disabled={!onSelect}
          >
            <IndexTreeIcon size={13} />
            <span>{step.label}</span>
            {step.page && <small>p. {step.page}</small>}
          </button>
          {sections.some(
            (child) =>
              child.resourceId === documentId &&
              child.parentNodeId === step.nodeId,
          ) && <ul>{renderSections(documentId, step.nodeId)}</ul>}
        </li>
      ));
  }
  function renderDocument(step: RetrievalStep, i: number) {
    return (
      <li key={step.resourceId ?? i}>
        <button
          className="retrieval-node"
          data-active={
            (activeDocumentId === step.resourceId && !activeNodeId) || undefined
          }
          onClick={() => step.resourceId && onSelect?.(step.resourceId)}
          onMouseMove={() => step.resourceId && onPreview?.(step.resourceId)}
          onFocus={() => step.resourceId && onPreview?.(step.resourceId)}
          disabled={!onSelect || !step.resourceId}
        >
          <FileText size={14} />
          <span>{step.label}</span>
        </button>
        {step.resourceId &&
          sections.some(
            (section) => section.resourceId === step.resourceId,
          ) && <ul>{renderSections(step.resourceId)}</ul>}
      </li>
    );
  }
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
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="retrieval-tree-panel">
        <ScrollArea
          className="h-auto max-h-[min(16rem,38vh)]"
          orientation="vertical"
          scrollFade
        >
          <ul className="retrieval-tree" aria-label="Retrieval path">
            {categories.map((category, i) => (
              <li key={category.resourceId ?? i}>
                <div className="retrieval-node">
                  <Folder size={14} />
                  <span>{category.label}</span>
                </div>
                <ul>
                  {documents
                    .filter((doc) =>
                      category.resourceId
                        ? doc.parentId === category.resourceId
                        : !doc.parentId,
                    )
                    .map(renderDocument)}
                </ul>
              </li>
            ))}
            {documents
              .filter(
                (doc) =>
                  !categories.some((category) =>
                    category.resourceId
                      ? category.resourceId === doc.parentId
                      : !doc.parentId,
                  ),
              )
              .map(renderDocument)}
            {!documents.length &&
              trace
                .filter((step) => step.stage !== "category")
                .map((step, i) => (
                  <li key={i}>
                    <div className="retrieval-node">
                      <FileText size={14} />
                      <span>{step.label}</span>
                      <small>{step.stage}</small>
                    </div>
                  </li>
                ))}
          </ul>
        </ScrollArea>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
