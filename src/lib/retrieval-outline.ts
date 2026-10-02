import type { RetrievalStep } from "../../shared/retrieval";

export type RetrievalTreeNode = {
  id: string;
  title: string;
  step: RetrievalStep;
  children: RetrievalTreeNode[];
};

export function retrievalNodeId(step: RetrievalStep, index: number) {
  const identified =
    step.stage === "section"
      ? step.nodeId
      : step.stage === "category" || step.stage === "document"
        ? step.resourceId
        : undefined;
  return JSON.stringify([
    step.stage,
    step.resourceId,
    step.nodeId,
    identified ? undefined : index,
  ]);
}

export function retrievalOutline(trace: RetrievalStep[]) {
  const nodes = new Map<string, RetrievalTreeNode>();
  trace.forEach((step, index) => {
    const id = retrievalNodeId(step, index);
    if (!nodes.has(id))
      nodes.set(id, { id, title: step.label, step, children: [] });
  });
  const categories = new Map<string, RetrievalTreeNode>();
  const documents = new Map<string, RetrievalTreeNode>();
  const sections = new Map<string, RetrievalTreeNode>();
  for (const node of nodes.values()) {
    const { step } = node;
    if (step.stage === "category") categories.set(step.resourceId ?? "", node);
    else if (step.stage === "document" && step.resourceId)
      documents.set(step.resourceId, node);
    else if (step.stage === "section" && step.nodeId)
      sections.set(JSON.stringify([step.resourceId, step.nodeId]), node);
  }
  const roots: RetrievalTreeNode[] = [];
  const parents = new Map<string, RetrievalTreeNode>();
  for (const node of nodes.values()) {
    const { step } = node;
    let parent: RetrievalTreeNode | undefined;
    if (step.stage === "category" && step.parentId)
      parent = categories.get(step.parentId);
    else if (step.stage === "document")
      parent = categories.get(step.parentId ?? "");
    else if (step.stage === "section")
      parent =
        (step.parentNodeId
          ? sections.get(JSON.stringify([step.resourceId, step.parentNodeId]))
          : undefined) ??
        (step.resourceId ? documents.get(step.resourceId) : undefined);
    let ancestor = parent;
    while (ancestor && ancestor !== node) ancestor = parents.get(ancestor.id);
    if (parent && ancestor !== node) {
      parent.children.push(node);
      parents.set(node.id, parent);
    } else roots.push(node);
  }
  return roots;
}
