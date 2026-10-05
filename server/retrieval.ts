import { createLimiter } from "./async";
import { createTraversal, type RouteNode } from "./beam-search";
import { createJev, retrievalLimits } from "./jev";
import type { DecisionConnection } from "./decision-provider";
import {
  createClefImages,
  withClefVisualPassages,
  type ClefImage,
} from "./clef-images";
import {
  HttpError,
  type Actor,
  type Resource,
  type Store,
  type PermissionCache,
} from "./db";
import {
  flatten,
  withSearchPassages,
  type IndexNode,
  type ParsedDocument,
} from "./indexing";
import type { RetrievalStep } from "../shared/retrieval";
import { sectionBlockType } from "../shared/section-block-type";
import { searchMetadata } from "./search-metadata";
import { metadataCandidates } from "./search-candidates";
import { buildSectionPreviews } from "./routing-preview";
import { createResourceAccessReader } from "./resource-access";
import {
  searchFiltersSchema,
  matchesSearchFilters,
  type SearchFilters,
} from "../shared/search-filters";

export type RetrievedSource = {
  documentId: string;
  name: string;
  nodeId: string;
  passageId: string;
  title: string;
  sectionPath?: string[];
  page: number;
  endPage: number;
  content: string;
  score: number;
  routeScore: number;
  blockIds: string[];
  citationBlocks?: { id: string; page: number; type: string }[];
};
type Value = {
  step: RetrievalStep;
  sources: Omit<RetrievedSource, "score" | "routeScore">[];
};
const evidenceSlot = createLimiter(retrievalLimits.evidenceConcurrency);

export async function retrieveDocuments(
  store: Store,
  actor: Actor,
  query: string,
  connection: string | DecisionConnection | undefined,
  fetcher: typeof fetch,
  documentIds: string[] = [],
  signal?: AbortSignal,
  options?: {
    preserveFolders?: boolean;
    maxPassages?: number;
    maxResults?: number;
    recoverRoutes?: boolean;
    filters?: SearchFilters;
    permissionCache?: PermissionCache;
  },
) {
  if (!connection)
    throw new HttpError(
      409,
      "Connect TypeSafe or Cloudflare in organization settings to enable search.",
    );
  signal?.throwIfAborted();
  const canRead = createResourceAccessReader(
    store,
    actor,
    signal,
    options?.permissionCache,
  );
  const filters = searchFiltersSchema.parse(options?.filters ?? {});
  if (filters.folderId) {
    const folder = await store.one<Resource>(
      "SELECT * FROM resources WHERE id=? AND org_id=? AND kind='folder'",
      filters.folderId,
      actor.orgId,
    );
    if (!folder || !(await canRead(folder.id)))
      throw new HttpError(404, "Folder not found");
  }
  const maxPassages = Math.min(
    retrievalLimits.passages,
    options?.maxPassages ?? retrievalLimits.passages,
  );
  const maxResults = Math.min(
    retrievalLimits.results,
    options?.maxResults ?? retrievalLimits.results,
  );
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
      documentIds.length && !options?.preserveFolders && !filters.folderId
        ? "SELECT * FROM resources WHERE org_id=? AND id=ANY(?::text[]) ORDER BY created DESC"
        : "SELECT id,org_id,owner_id,parent_id,kind,name,description,access,mime,size,status,created,true AS outline_only,CASE WHEN parsed IS NULL THEN NULL ELSE json_build_object('summary',left(search_outline,1200),'searchProfile',left(search_profile,4096))::text END AS parsed FROM resources WHERE org_id=? ORDER BY created DESC",
      actor.orgId,
      ...(documentIds.length && !options?.preserveFolders && !filters.folderId
        ? [documentIds]
        : []),
    ),
    (resource) => resource.id,
  );
  const scoped = new Set(filters.folderId ? [filters.folderId] : []);
  if (filters.folderId) {
    const children = new Map<string, string[]>();
    for (const resource of resources) {
      if (!resource.parent_id) continue;
      const siblings = children.get(resource.parent_id) ?? [];
      siblings.push(resource.id);
      children.set(resource.parent_id, siblings);
    }
    const pending = [filters.folderId];
    for (let i = 0; i < pending.length; i++)
      for (const id of children.get(pending[i]) ?? [])
        if (!scoped.has(id)) {
          scoped.add(id);
          pending.push(id);
        }
  }
  const docs = resources.filter(
    (resource) =>
      resource.kind === "document" &&
      resource.status === "ready" &&
      resource.parsed &&
      matchesSearchFilters(resource, filters) &&
      (!filters.folderId || scoped.has(resource.id)) &&
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
    previews: ReadonlyMap<string, string>,
    parentNodeId?: string,
    ancestors: string[] = [],
  ): RouteNode<Value> {
    const sectionPath = [...ancestors, node.title];
    return {
      id: `section:${doc.id}:${node.id}`,
      scope: doc.id,
      describe: async () =>
        (await canRead(doc.id))
          ? (previews.get(node.id) ??
            `${node.title}\nPages ${node.page}–${node.endPage}\n${node.summary}`.slice(
              0,
              1200,
            ))
          : undefined,
      children: bounded(
        node.children.map((child) =>
          section(doc, child, previews, node.id, sectionPath),
        ),
        `section:${doc.id}:${node.id}`,
      ),
      value: {
        step: {
          stage: "section",
          label: node.title,
          resourceId: doc.id,
          nodeId: node.id,
          parentNodeId,
          blockType: sectionBlockType(node),
          page: node.page,
        },
        sources: (node.passages ?? []).map((passage) => ({
          documentId: doc.id,
          name: doc.name,
          nodeId: node.id,
          passageId: passage.id,
          title: node.title,
          sectionPath,
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
  const documentNodes = new Map<string, RouteNode<Value>>();
  const clef =
    typeof connection !== "string" && connection.provider === "cloudflare";
  const visualDocuments = new Map<
    string,
    { document: Resource; parsed: ParsedDocument }
  >();
  function resourceNode(
    resource: Resource & { outline_only?: boolean },
  ): RouteNode<Value> | undefined {
    if (resource.kind === "document") {
      if (!eligible.has(resource.id)) return;
      const cached = documentNodes.get(resource.id);
      if (cached) return cached;
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
          let parsed = withSearchPassages(
            JSON.parse(current.parsed) as ParsedDocument,
          );
          if (clef) {
            parsed = withClefVisualPassages(parsed);
            visualDocuments.set(current.id, { document: current, parsed });
          }
          const previews = buildSectionPreviews(parsed.nodes, query);
          children = bounded(
            [...parsed.nodes, searchMetadata(parsed, query)].map((node) =>
              section(current, node, previews),
            ),
            `document:${resource.id}`,
          );
        }
        return children;
      };
      const node: RouteNode<Value> = {
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
      documentNodes.set(resource.id, node);
      return node;
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
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  if (
    !documentIds.length &&
    !options?.preserveFolders &&
    options?.recoverRoutes !== false
  ) {
    const preferred = metadataCandidates(
      docs.map((document) => {
        const outline = JSON.parse(document.parsed!) as ParsedDocument;
        return {
          id: document.id,
          name: document.name,
          outline: outline.summary ?? "",
          profile: outline.searchProfile,
        };
      }),
      query,
    );
    if (preferred.length) {
      const candidates = preferred.map((candidate) => {
        const node = resourceNode(byId.get(candidate.id)!)!;
        return {
          ...node,
          describe: async () =>
            (await canRead(candidate.id)) ? candidate.hint : undefined,
        };
      });
      roots.unshift({
        id: "metadata-candidates",
        children: candidates,
        describe: async () => {
          const descriptions = (
            await Promise.all(
              candidates.map((candidate) => candidate.describe()),
            )
          ).filter((text): text is string => text !== undefined);
          return descriptions.length
            ? `Direct source candidates from matching document outlines. These partial outlines locate sources; their facts still require verification.\n${descriptions.map((text) => text.slice(0, Math.floor(6000 / descriptions.length))).join("\n")}`
            : undefined;
        },
      });
    }
  }
  const traversal = createTraversal(
    bounded(roots, "library"),
    createJev(connection, fetcher, signal),
    query,
    (node) => Boolean(node.value?.sources.length),
    options?.recoverRoutes ?? true,
  );
  const jev = createJev(connection, fetcher, signal);
  const results: RetrievedSource[] = [];
  const trace: RetrievalStep[] = [];
  const candidates: Omit<RetrievedSource, "score">[] = [];
  const passageCounts = new Map<string, number>();
  let scored = 0;
  let coverageChecked = "";
  const visuals = clef ? createClefImages(store, actor, signal) : undefined;
  try {
    while (
      (!traversal.exhausted || candidates.length) &&
      scored < maxPassages
    ) {
      signal?.throwIfAborted();
      const routes = traversal.exhausted ? [] : await traversal.walk();
      for (const route of routes) {
        if (!route.node.value) continue;
        const { step, sources } = route.node.value;
        if (
          step.stage === "document" &&
          route.path.some((node) => node.id === "metadata-candidates")
        ) {
          const ancestors: Resource[] = [];
          const seen = new Set<string>();
          let parent = step.parentId;
          while (parent && !seen.has(parent)) {
            seen.add(parent);
            const resource = byId.get(parent);
            if (!resource || !(await canRead(resource.id))) break;
            ancestors.unshift(resource);
            parent = resource.parent_id;
          }
          for (const ancestor of ancestors)
            if (
              !trace.some(
                (item) =>
                  item.stage === "category" && item.resourceId === ancestor.id,
              )
            )
              trace.push({
                stage: "category",
                label: ancestor.name,
                resourceId: ancestor.id,
                parentId: ancestor.parent_id,
              });
        }
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
          Math.min(retrievalLimits.evidenceBatchSize, maxPassages - scored)
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
      const filtered = await evidenceSlot(async () => {
        signal?.throwIfAborted();
        const approved = await readable(batch, (source) => source.documentId);
        if (!approved.length) return [];
        scored += approved.length;
        trace.push(
          ...approved.map((source) => ({
            stage: "passage" as const,
            label: source.title,
            resourceId: source.documentId,
            nodeId: source.nodeId,
            page: source.page,
            routeScore: source.routeScore,
          })),
        );
        const images: ClefImage[][] | undefined = visuals ? [] : undefined;
        if (visuals)
          for (const source of approved) {
            const value = visualDocuments.get(source.documentId);
            images!.push(
              value
                ? await visuals.passage(
                    value.document,
                    value.parsed,
                    source.blockIds,
                  )
                : [],
            );
          }
        const scorer = visuals
          ? createJev(
              connection,
              async (input, init) => {
                for (const id of new Set(
                  approved.map((source) => source.documentId),
                )) {
                  const value = visualDocuments.get(id);
                  if (value) await visuals.check(value.document);
                  else if (!(await canRead(id)))
                    throw new HttpError(404, "Document not found");
                }
                return fetcher(input, init);
              },
              signal,
            )
          : jev;
        const scores = await scorer.scorePassages(
          query,
          approved.map(
            (source) =>
              `Source: ${source.name}\nSection: ${source.title}\nPages: ${source.page}–${source.endPage}\n\n${source.content}`,
          ),
          images,
        );
        signal?.throwIfAborted();
        return readable(
          approved.flatMap((source, index) =>
            scores[index] >= retrievalLimits.minimumScore
              ? [{ ...source, score: scores[index] }]
              : [],
          ),
          (source) => source.documentId,
        );
      }, signal);
      results.push(...filtered);
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
          }, signal);
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
      if (
        characters + source.content.length >
        retrievalLimits.contextCharacters
      )
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
  } finally {
    await visuals?.close();
  }
}
