import { createLimiter } from "./async";
import { createTraversal, type RouteNode } from "./beam-search";
import { createJev, retrievalLimits } from "./jev";
import {
  resourceAccess,
  HttpError,
  type Actor,
  type Resource,
  type Store,
} from "./db";
import {
  flatten,
  withSearchPassages,
  type IndexNode,
  type ParsedDocument,
} from "./indexing";
import type { RetrievalStep } from "../shared/retrieval";
import { searchMetadata } from "./search-metadata";

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
  const pendingAccess = new Map<string, Promise<boolean>>();
  const canRead = (id: string) => {
    const pending = pendingAccess.get(id);
    if (pending) return pending;
    const check = authorizationSlot(async () => {
      signal?.throwIfAborted();
      return resourceAccess(store, actor, id);
    }).finally(() => pendingAccess.delete(id));
    pendingAccess.set(id, check);
    return check;
  };
  const readable = async <T>(
    items: T[],
    resourceId: (item: T) => string | undefined,
  ) => {
    const ids = [
      ...new Set(
        items.flatMap((item) => {
          const id = resourceId(item);
          return id ? [id] : [];
        }),
      ),
    ];
    const access = new Map(
      await Promise.all(
        ids.map(async (id) => [id, await canRead(id)] as const),
      ),
    );
    return items.filter((item) => {
      const id = resourceId(item);
      return !id || access.get(id);
    });
  };
  const resources = await readable(
    await store.all<Resource & { outline_only?: boolean }>(
      documentIds.length && !options?.preserveFolders
        ? "SELECT * FROM resources WHERE org_id=? AND id=ANY(?::text[]) ORDER BY created DESC"
        : "SELECT id,org_id,owner_id,parent_id,kind,name,description,access,mime,size,status,created,true AS outline_only,CASE WHEN parsed IS NULL THEN NULL ELSE json_build_object('summary',left(search_outline,1200))::text END AS parsed FROM resources WHERE org_id=? ORDER BY created DESC",
      actor.orgId,
      ...(documentIds.length && !options?.preserveFolders ? [documentIds] : []),
    ),
    (resource) => resource.id,
  );
  const docs = resources.filter(
    (resource) =>
      resource.kind === "document" &&
      resource.status === "ready" &&
      resource.parsed &&
      (!documentIds.length || documentIds.includes(resource.id)),
  );

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
    const groupBudget = Math.floor(
      (retrievalLimits.routingCharacters - 4096) /
        Math.ceil(nodes.length / size),
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
          const length = Math.floor(
            groupBudget / Math.max(1, descriptions.length),
          );
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
      scope: doc.id,
      describe: async () =>
        (await canRead(doc.id))
          ? `${node.title}\nPages ${node.page}–${node.endPage}\n${node.summary}`.slice(
              0,
              1200,
            )
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
  function resourceNode(
    resource: Resource & { outline_only?: boolean },
  ): RouteNode<Value> | undefined {
    if (resource.kind === "document") {
      if (!eligible.has(resource.id)) return;
      const outline = JSON.parse(resource.parsed!) as Partial<ParsedDocument>;
      let children: RouteNode<Value>[] | undefined;
      const loadChildren = async () => {
        signal?.throwIfAborted();
        if (!(await canRead(resource.id))) return [];
        if (!children) {
          const current = resource.outline_only
            ? await store.one<Resource>(
                "SELECT * FROM resources WHERE id=? AND org_id=?",
                resource.id,
                actor.orgId,
              )
            : resource;
          if (
            !current?.parsed ||
            current.status !== "ready" ||
            !(await canRead(resource.id))
          )
            return [];
          const parsed = withSearchPassages(
            JSON.parse(current.parsed) as ParsedDocument,
          );
          children = bounded(
            [...parsed.nodes, searchMetadata(parsed, query)].map((node) =>
              section(current, node),
            ),
            `document:${resource.id}`,
          );
        }
        return children;
      };
      return {
        id: `document:${resource.id}`,
        scope: resource.id,
        describe: async () =>
          (await canRead(resource.id))
            ? `${resource.name}\n${
                outline.summary ??
                flatten(outline.nodes ?? [])
                  .map((node) => node.title)
                  .join("; ")
              }`.slice(0, 1200)
            : undefined,
        children: [],
        loadChildren,
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
      describe: async () => {
        if (!(await canRead(resource.id))) return;
        const outlines = (
          await Promise.all(children.map((child) => child.describe()))
        ).filter((outline): outline is string => outline !== undefined);
        const siblings = (byParent.get(resource.parent_id) ?? []).length;
        const budget = Math.min(
          16000,
          Math.floor(
            (retrievalLimits.routingCharacters - 8192) /
              Math.max(1, Math.min(retrievalLimits.menuSize, siblings)),
          ),
        );
        const prefix =
          `${resource.name}\n${resource.description.slice(0, 600)}\nContained sources:\n`.slice(
            0,
            budget,
          );
        const size = Math.max(
          0,
          Math.floor(
            (budget - prefix.length - outlines.length) /
              Math.max(1, outlines.length),
          ),
        );
        return (
          prefix + outlines.map((outline) => outline.slice(0, size)).join("\n")
        );
      },
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
  const candidates: Omit<RetrievedSource, "score">[] = [];
  const passageCounts = new Map<string, number>();
  let scored = 0;
  let coverageChecked = "";
  while ((!traversal.exhausted || candidates.length) && scored < maxPassages) {
    signal?.throwIfAborted();
    const routes = traversal.exhausted ? [] : await traversal.walk();
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
    const batch: typeof candidates = [];
    while (
      candidates.length &&
      batch.length <
        Math.min(retrievalLimits.evidenceConcurrency, maxPassages - scored)
    ) {
      const rounds = (source: (typeof candidates)[number]) =>
        Math.floor(
          (passageCounts.get(source.documentId) ?? 0) /
            retrievalLimits.sectionsPerDocument,
        );
      candidates.sort(
        (a, b) => rounds(a) - rounds(b) || b.routeScore - a.routeScore,
      );
      const source = candidates.shift()!;
      batch.push(source);
      passageCounts.set(
        source.documentId,
        (passageCounts.get(source.documentId) ?? 0) + 1,
      );
    }
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
            const score = await jev.score(
              query,
              `Source: ${source.name}\nSection: ${source.title}\nPages: ${source.page}–${source.endPage}\n\n${source.content}`,
            );
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
    const accessible = await readable(results, (source) => source.documentId);
    if (options?.recoverRoutes === false) {
      if (accessible.length >= retrievalLimits.minimumUsefulResults) break;
    } else if (
      accessible.some(
        (source) => source.score >= retrievalLimits.sufficientScore,
      )
    ) {
      break;
    } else if (accessible.length >= retrievalLimits.minimumUsefulResults) {
      const evidence = accessible
        .toSorted((a, b) => b.score - a.score || b.routeScore - a.routeScore)
        .slice(0, maxResults);
      const identity = evidence
        .map((source) => `${source.documentId}:${source.passageId}`)
        .join("|");
      if (identity !== coverageChecked) {
        coverageChecked = identity;
        const score = await evidenceSlot(async () => {
          signal?.throwIfAborted();
          const approved = await readable(
            evidence,
            (source) => source.documentId,
          );
          if (!approved.length) return 0;
          return jev.score(
            query,
            approved
              .map(
                (source) =>
                  `Source: ${source.name}\nSection: ${source.title}\nPages: ${source.page}–${source.endPage}\n${source.content}`,
              )
              .join("\n\n")
              .slice(0, retrievalLimits.contextCharacters),
          );
        });
        if (score >= retrievalLimits.sufficientScore) break;
      }
    }
  }
  const accessible = await readable(
    [
      ...results.map((source) => source.documentId),
      ...trace.flatMap((step) => (step.resourceId ? [step.resourceId] : [])),
    ],
    (id) => id,
  );
  const allowed = new Set(accessible);
  const ranked = results
    .filter((source) => allowed.has(source.documentId))
    .sort((a, b) => b.score - a.score || b.routeScore - a.routeScore);
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
    trace: trace.filter(
      (step) => !step.resourceId || allowed.has(step.resourceId),
    ),
    limited:
      traversal.limited ||
      !traversal.exhausted ||
      candidates.length > 0 ||
      scored >= maxPassages,
  };
}
