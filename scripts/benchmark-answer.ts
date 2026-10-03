import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProviders } from "../server/providers";
import { resourceAccess, type Actor, type Store } from "../server/db";
import { inspectDocument } from "../server/document-inspection";
import {
  createDocumentVisuals,
  type DocumentPageImage,
} from "../server/document-visuals";
import {
  createCitationLocator,
  citationPromptSource,
  citationSourceKey,
} from "../server/citation-sources";
import { createLimiter } from "../server/async";
import type { RetrievedSource } from "../server/retrieval";

export async function benchmarkImplementationHash() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [resolve(root, "scripts/benchmark-answer.ts")];
  for (const folder of ["server", "shared"])
    for (const path of await readdir(resolve(root, folder), {
      recursive: true,
    }))
      if (path.endsWith(".ts")) files.push(resolve(root, folder, path));
  const hash = createHash("sha256");
  for (const path of files.sort())
    hash.update(relative(root, path)).update(await readFile(path));
  return hash.digest("hex");
}

export function createBenchmarkAnswer(store: Store) {
  const providers = createProviders(store);
  const visuals = createDocumentVisuals(store);
  return {
    close: visuals.close,
    async answer(
      actor: Actor,
      question: string,
      documentIds: string[],
      selection: { provider: string; model: string },
      signal: AbortSignal,
    ) {
      const started = performance.now();
      const sources: RetrievedSource[] = [];
      const images: DocumentPageImage[] = [];
      const trace: unknown[] = [];
      const locate = createCitationLocator(store);
      const slot = createLimiter(2);
      const pending = new Map<string, Promise<ReturnType<typeof output>>>();
      let lookups = 0;
      let active = 0;
      let retrievalStarted = 0;
      let retrievalMs = 0;
      let firstTextMs: number | undefined;
      const check = async () => {
        signal.throwIfAborted();
        for (const id of new Set([
          ...documentIds,
          ...sources.map((source) => source.documentId),
        ]))
          if (!(await resourceAccess(store, actor, id)))
            throw new Error("Source access is unavailable");
      };
      const checkDocument = (id: string) => {
        if (
          !documentIds.includes(id) &&
          !sources.some((source) => source.documentId === id)
        )
          throw new Error(
            "Choose an attached or retrieved document to inspect",
          );
      };
      function output(
        found: {
          results: RetrievedSource[];
          message?: string;
          images?: DocumentPageImage[];
        },
        blocks: Awaited<ReturnType<typeof locate>>,
      ) {
        for (const source of found.results)
          if (
            !sources.some(
              (existing) =>
                citationSourceKey(existing) === citationSourceKey(source),
            )
          )
            sources.push(source);
        images.push(...(found.images ?? []));
        return {
          sources: found.results.map((source) =>
            citationPromptSource(
              source,
              sources.findIndex(
                (existing) =>
                  citationSourceKey(existing) === citationSourceKey(source),
              ) + 1,
              blocks.get(source.documentId),
            ),
          ),
          message: found.message,
          images: found.images?.map((image) => ({
            ...image,
            citation:
              sources.findIndex(
                (source) =>
                  source.documentId === image.documentId &&
                  source.passageId === `visual-page-${image.page}`,
              ) + 1,
          })),
        };
      }
      const lookup = (
        key: string,
        fn: () => Promise<{
          results: RetrievedSource[];
          trace?: unknown[];
          message?: string;
          images?: DocumentPageImage[];
        }>,
      ) => {
        const existing = pending.get(key);
        if (existing) return existing;
        if (++lookups > 5)
          return Promise.resolve({
            sources: [],
            message:
              "The search limit has been reached. Answer using the evidence already retrieved.",
          });
        const result = slot(async () => {
          if (active++ === 0) retrievalStarted = performance.now();
          try {
            await check();
            const found = await fn();
            const blocks = await locate(found.results);
            trace.push(
              {
                key,
                sources: found.results.map((source) => ({
                  documentId: source.documentId,
                  passageId: source.passageId,
                  page: source.page,
                  endPage: source.endPage,
                })),
              },
              ...(found.trace ?? []),
            );
            const result = output(found, blocks);
            await check();
            return result;
          } finally {
            if (--active === 0)
              retrievalMs += performance.now() - retrievalStarted;
          }
        }, signal).finally(() => pending.delete(key));
        pending.set(key, result);
        return result;
      };
      await check();
      const attachedDocuments = await Promise.all(
        documentIds.map(async (id) => {
          const resource = await store.one<{ name: string }>(
            "SELECT name FROM resources WHERE id=? AND org_id=?",
            id,
            actor.orgId,
          );
          if (!resource) throw new Error("Source document is unavailable");
          return { id, name: resource.name };
        }),
      );
      const answer = await providers.answer(
        actor.orgId,
        question,
        [],
        [],
        selection,
        {
          signal,
          attachedDocuments,
          beforeStep: check,
          onText: async () => {
            firstTextMs ??= Math.round(performance.now() - started);
          },
          searchDocuments: (query, _signal, filters) =>
            lookup(
              `search:${query.trim()}:${JSON.stringify(filters ?? {})}`,
              () =>
                providers.retrieve(actor, query, documentIds, signal, filters),
            ),
          inspectDocument: (input) => {
            checkDocument(input.documentId);
            return lookup(`inspect:${JSON.stringify(input)}`, async () => ({
              results: await inspectDocument(store, actor, input, signal),
            }));
          },
          viewDocumentPages: (input) => {
            checkDocument(input.documentId);
            return lookup(`visual:${JSON.stringify(input)}`, () =>
              visuals.view(actor, input, signal),
            );
          },
        },
      );
      await check();
      return {
        actualAnswer: answer,
        sources,
        images,
        trace,
        retrievalMs: Math.round(retrievalMs),
        firstTextMs,
        totalMs: Math.round(performance.now() - started),
        lookups: Math.min(lookups, 5),
      };
    },
  };
}
