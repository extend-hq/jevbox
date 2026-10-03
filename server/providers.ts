import { z } from "zod";
import {
  generateAnswer,
  availableChatModels,
  type AnswerExecution,
} from "./ai";
import type { ModelMessage } from "ai";
import { type Store, type Actor, type Resource, type PermissionCache, HttpError } from "./db";
import { PermanentJobError } from "./jobs";
import { buildIndex } from "./indexing";
import { retrieveDocuments } from "./retrieval";
import { jsonRequest } from "./provider-http";
import type { SearchFilters } from "../shared/search-filters";
import { documentAnswerPolicy } from "./answer-policy";
import {
  citationPromptSource,
  createCitationLocator,
} from "./citation-sources";
export type Settings = {
  organization?: {
    enabled: boolean;
    model?: { provider: string; model: string };
  };
  extendKey?: string;
  jevKey?: string;
  provider?: string;
  model?: string;
  credentials?: Record<
    string,
    {
      apiKey?: string;
      config?: Record<string, unknown>;
      model?: string;
      models?: string[];
      enabled?: boolean;
    }
  >;
};
export type Fetch = typeof fetch;
export async function getSettings(
  store: Store,
  orgId: string,
): Promise<Settings> {
  const row = await store.one<{
    settings: string;
  }>("SELECT settings FROM orgs WHERE id=?", orgId);
  if (!row || row.settings === "{}") return {};
  return JSON.parse(store.decrypt(row.settings));
}
export function createProviders(store: Store, fetcher: Fetch = fetch) {
  async function processDocument(
    document: Resource,
    execution?: {
      signal: AbortSignal;
      check: () => Promise<void>;
      checkpoint: (sql: string, ...values: any[]) => Promise<void>;
    },
  ) {
    const checkpoint =
      execution?.checkpoint ??
      (async (sql: string, ...values: any[]) => {
        await store.run(sql, ...values);
      });
    const request: Fetch = async (input, init) => {
      await execution?.check();
      return fetcher(input, {
        ...init,
        ...(execution
          ? {
              signal: AbortSignal.any([
                execution.signal,
                ...(init?.signal ? [init.signal] : []),
              ]),
            }
          : {}),
      });
    };
    const settings = await getSettings(store, document.org_id);
    const body = (await store.files.read("document", document.id))?.body;
    if (!body) throw new PermanentJobError("Document content is unavailable");
    if (
      document.mime.startsWith("text/") ||
      document.mime === "application/json"
    ) {
      let text: string | undefined;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      } catch {}
      if (text !== undefined)
        return buildIndex(
          text.split("\f").map((content, i) => ({
            content,
            metadata: { pageRange: { start: i + 1, end: i + 1 } },
          })),
          "text",
        );
    }
    if (!settings.extendKey) {
      await checkpoint(
        "UPDATE resources SET status='awaiting_key' WHERE id=?",
        document.id,
      );
      return null;
    }
    const headers = {
      Authorization: `Bearer ${settings.extendKey}`,
      "x-extend-api-version": "2026-02-09",
    };
    let runId = document.parse_run;
    if (!runId) {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(body)], { type: document.mime }),
        document.name,
      );
      const file = z.object({ id: z.string() }).parse(
        await jsonRequest(request, "https://api.extend.ai/files/upload", {
          method: "POST",
          headers,
          body: form,
        }),
      );
      await checkpoint(
        "UPDATE resources SET parse_requested=true WHERE id=?",
        document.id,
      );
      const run = z.object({ id: z.string() }).parse(
        await jsonRequest(request, "https://api.extend.ai/parse_runs", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            file: { id: file.id },
            config: { advancedOptions: { alwaysConvertToPdf: false } },
          }),
        }),
      );
      runId = run.id;
      await checkpoint(
        "UPDATE resources SET parse_run=?,status='processing' WHERE id=?",
        runId,
        document.id,
      );
    }
    const run = z
      .object({
        status: z.string(),
        output: z
          .object({
            chunks: z.array(z.unknown()),
            metadata: z.unknown().optional(),
          })
          .nullable()
          .optional(),
      })
      .parse(
        await jsonRequest(
          request,
          `https://api.extend.ai/parse_runs/${encodeURIComponent(runId)}`,
          { headers },
        ),
      );
    if (run.status === "FAILED") {
      await checkpoint(
        "UPDATE resources SET parse_run=NULL,parse_requested=false WHERE id=?",
        document.id,
      );
      throw new PermanentJobError(
        "Parsing failed. Check the document and retry.",
      );
    }
    if (run.status !== "PROCESSED") return null;
    return buildIndex(run.output?.chunks, "extend", run.output?.metadata);
  }
  async function retrieve(
    actor: Actor,
    query: string,
    documentIds: string[] = [],
    signal?: AbortSignal,
    filters?: SearchFilters,
    permissionCache?: PermissionCache,
  ) {
    const settings = await getSettings(store, actor.orgId);
    return retrieveDocuments(
      store,
      actor,
      query,
      settings.jevKey,
      fetcher,
      documentIds,
      signal,
      { filters, permissionCache },
    );
  }
  async function answer(
    orgId: string,
    question: string,
    history: {
      role: string;
      content: string;
    }[],
    sources: Awaited<ReturnType<typeof retrieve>>["results"],
    selection?: {
      provider: string;
      model: string;
    },
    execution?: AnswerExecution,
  ) {
    const configured = await getSettings(store, orgId);
    if (
      selection &&
      !availableChatModels(configured).some(
        (m) => m.provider === selection.provider && m.model === selection.model,
      )
    )
      throw new HttpError(
        409,
        "This model is no longer enabled for your organization.",
      );
    const settings = { ...configured, ...selection };
    const system = documentAnswerPolicy;
    const citationBlocks = await createCitationLocator(store)(sources);
    const prompt = JSON.stringify({
      question,
      ...(execution?.attachedDocuments?.length
        ? {
            attachedDocuments: execution.attachedDocuments,
          }
        : {}),
      sources: sources.map((s, i) =>
        citationPromptSource(s, i + 1, citationBlocks.get(s.documentId)),
      ),
    });
    const messages = [...history.slice(-10), { role: "user", content: prompt }];
    return generateAnswer(
      settings,
      system,
      messages as ModelMessage[],
      fetcher,
      execution,
    );
  }
  return { processDocument, retrieve, answer };
}
