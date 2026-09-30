import { asyncFilter, createLimiter } from "./async";
import { createTraversal, type RouteNode } from "./beam-search";
import { createJev, retrievalLimits } from "./jev";
import {
  resourceAccess,
  visibleResources,
  HttpError,
  type Actor,
  type Resource,
  type Store,
} from "./db";
import { flatten, type IndexNode, type ParsedDocument } from "./indexing";
import type { RetrievalStep } from "../shared/retrieval";

export type RetrievedSource = {
  documentId: string;
  name: string;
  nodeId: string;
  passageId: string;
  title: string;
  page: number;
  endPage: number;
  content: string;
  score: number;
  routeScore: number;
  blockIds: string[];
};
type Value = {
  step: RetrievalStep;
  sources: Omit<RetrievedSource, "score" | "routeScore">[];
};
const evidenceSlot = createLimiter(retrievalLimits.evidenceConcurrency);
const authorizationSlot = createLimiter(
  retrievalLimits.authorizationConcurrency,
);

export async function retrieveDocuments(
  store: Store,
  actor: Actor,
  query: string,
  key: string | undefined,
  fetcher: typeof fetch,
  documentIds: string[] = [],
  signal?: AbortSignal,
  options?: {
    preserveFolders?: boolean;
    maxPassages?: number;
    maxResults?: number;
    recoverRoutes?: boolean;
  },
) {
  if (!key)
    throw new HttpError(
      409,
      "Connect TypeSafe in organization settings to enable search.",
    );
  signal?.throwIfAborted();
  const maxPassages = Math.min(
    retrievalLimits.passages,
    options?.maxPassages ?? retrievalLimits.passages,
  );
  const maxResults = Math.min(
    retrievalLimits.results,
    options?.maxResults ?? retrievalLimits.results,
  );
  const resources = await visibleResources(store, actor);
  const docs = resources.filter(
    (resource) =>
      resource.kind === "document" &&
      resource.status === "ready" &&
      resource.parsed &&
      (!documentIds.length || documentIds.includes(resource.id)),
  );
  const canRead = (id: string) =>
    authorizationSlot(async () => {
      signal?.throwIfAborted();
      return resourceAccess(store, actor, id);
    });

  function bounded(
    nodes: RouteNode<Value>[],
    parent: string,
  ): RouteNode<Value>[] {
    if (nodes.length <= retrievalLimits.menuSize) return nodes;
    const categories = nodes.filter(
      (node) => node.value?.step.stage === "category",
    );
    if (categories.length && categories.length < retrievalLimits.menuSize) {
      const other = nodes.filter(
        (node) => node.value?.step.stage !== "category",
      );
      if (other.length) {
        const grouped = bounded(other, `${parent}:sources`);
        if (categories.length + grouped.length <= retrievalLimits.menuSize)
          return [...categories, ...grouped];
      }
    }
    const groups: RouteNode<Value>[] = [];
    const size = Math.max(
      retrievalLimits.menuSize,
      Math.ceil(nodes.length / retrievalLimits.menuSize),
    );
    for (let start = 0; start < nodes.length; start += size) {
      const children = bounded(
        nodes.slice(start, start + size),
        `${parent}:group:${start}`,
      );
      groups.push({
        id: `${parent}:group:${start}`,
        children,
        describe: async () => {
          const descriptions = (
            await Promise.all(children.map((child) => child.describe()))
          ).filter(
            (description): description is string => description !== undefined,
          );
          const length = Math.floor(1200 / Math.max(1, descriptions.length));
          return descriptions.length
            ? `Source group: ${descriptions.map((description) => description.slice(0, length)).join("\n")}`
            : undefined;
        },
      });
    }
    return groups;
  }
  function section(
    doc: Resource,
    node: IndexNode,
    parentNodeId?: string,
  ): RouteNode<Value> {
    return {
      id: `section:${doc.id}:${node.id}`,
      describe: async () =>
        (await canRead(doc.id))
          ? `${node.title}\n${node.summary}`.slice(0, 1200)
          : undefined,
      children: bounded(
        node.children.map((child) => section(doc, child, node.id)),
        `section:${doc.id}:${node.id}`,
      ),
      value: {
        step: {
          stage: "section",
          label: node.title,
          resourceId: doc.id,
          nodeId: node.id,
          parentNodeId,
          page: node.page,
        },
        sources: (node.passages ?? []).map((passage) => ({
          documentId: doc.id,
          name: doc.name,
          nodeId: node.id,
          passageId: passage.id,
          title: node.title,
          page: passage.page,
          endPage: passage.endPage,
          content: passage.content,
          blockIds: passage.blockIds,
        })),
      },
    };
  }
  const byParent = new Map<string | null, Resource[]>();
  for (const resource of resources) {
    const children = byParent.get(resource.parent_id) ?? [];
    children.push(resource);
    byParent.set(resource.parent_id, children);
  }
  const eligible = new Set(docs.map((doc) => doc.id));
  function resourceNode(resource: Resource): RouteNode<Value> | undefined {
    if (resource.kind === "document") {
      if (!eligible.has(resource.id)) return;
      const parsed: ParsedDocument = JSON.parse(resource.parsed!);
      return {
        id: `document:${resource.id}`,
        describe: async () =>
          (await canRead(resource.id))
            ? `${
                parsed.summary ??
                flatten(parsed.nodes)
                  .map((node) => node.title)
                  .join("; ")
              }\n${resource.name}`.slice(0, 1200)
            : undefined,
        children: bounded(
          parsed.nodes.map((node) => section(resource, node)),
          `document:${resource.id}`,
        ),
        value: {
          step: {
            stage: "document",
            label: resource.name,
            resourceId: resource.id,
            parentId: resource.parent_id,
          },
          sources: [],
        },
      };
    }
    const children = (byParent.get(resource.id) ?? []).flatMap((child) => {
      const node = resourceNode(child);
      return node ? [node] : [];
    });
    if (!children.length) return;
    return {
      id: `category:${resource.id}`,
      describe: async () =>
        (await canRead(resource.id))
          ? `${resource.name}\n${resource.description}`.slice(0, 600)
          : undefined,
      children: bounded(children, `category:${resource.id}`),
      value: {
        step: {
          stage: "category",
          label: resource.name,
          resourceId: resource.id,
          parentId: resource.parent_id,
        },
        sources: [],
      },
    };
  }
  const roots = (
    documentIds.length && !options?.preserveFolders
      ? docs
      : (byParent.get(null) ?? [])
  ).flatMap((resource) => {
    const node = resourceNode(resource);
    return node ? [node] : [];
  });
  const traversal = createTraversal(
    bounded(roots, "library"),
    createJev(key, fetcher, signal),
    query,
    (node) => Boolean(node.value?.sources.length),
    options?.recoverRoutes ?? true,
  );
  const jev = createJev(key, fetcher, signal);
  const results: RetrievedSource[] = [];
  const trace: RetrievalStep[] = [];
  let scored = 0;
  while (!traversal.exhausted && scored < maxPassages) {
    signal?.throwIfAborted();
    const routes = await traversal.walk();
    const candidates: Omit<RetrievedSource, "score">[] = [];
    for (const route of routes) {
      if (!route.node.value) continue;
      const { step, sources } = route.node.value;
      trace.push({
        ...step,
        probability: route.probability,
        routeScore: route.score,
      });
      for (const source of sources)
        candidates.push({ ...source, routeScore: route.score });
    }
    candidates.sort((a, b) => b.routeScore - a.routeScore);
    const batch = candidates.slice(0, maxPassages - scored);
    for (
      let i = 0;
      i < batch.length;
      i += retrievalLimits.evidenceConcurrency
    ) {
      signal?.throwIfAborted();
      const filtered = await Promise.all(
        batch.slice(i, i + retrievalLimits.evidenceConcurrency).map((source) =>
          evidenceSlot(async () => {
            signal?.throwIfAborted();
            if (!(await canRead(source.documentId))) return null;
            scored++;
            trace.push({
              stage: "passage",
              label: source.title,
              resourceId: source.documentId,
              nodeId: source.nodeId,
              page: source.page,
              routeScore: source.routeScore,
            });
            const score = await jev.score(query, source.content);
            return score >= retrievalLimits.minimumScore &&
              (await canRead(source.documentId))
              ? { ...source, score }
              : null;
          }),
        ),
      );
      results.push(
        ...filtered.filter(
          (source): source is RetrievedSource => source !== null,
        ),
      );
    }
    const accessible = await asyncFilter(results, (source) =>
      canRead(source.documentId),
    );
    if (accessible.length >= retrievalLimits.minimumUsefulResults) break;
  }
  const ranked = (
    await asyncFilter(results, (source) => canRead(source.documentId))
  ).sort((a, b) => b.score - a.score || b.routeScore - a.routeScore);
  const context: RetrievedSource[] = [];
  let characters = 0;
  for (const source of ranked) {
    if (context.length >= maxResults) break;
    if (characters + source.content.length > retrievalLimits.contextCharacters)
      continue;
    if (
      context.some(
        (existing) =>
          existing.documentId === source.documentId &&
          existing.nodeId === source.nodeId &&
          existing.content.includes(source.content),
      )
    )
      continue;
    context.push(source);
    characters += source.content.length;
  }
  return {
    mode: "jev" as const,
    results: context,
    trace: await asyncFilter(
      trace,
      async (step) => !step.resourceId || canRead(step.resourceId),
    ),
    limited: traversal.limited || !traversal.exhausted || scored >= maxPassages,
  };
}
