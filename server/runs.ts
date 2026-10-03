import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { configuredLimit } from "./rate-limits";
import { z } from "zod";
import {
  HttpError,
  requireResource,
  requireResources,
  resourceAccessBatch,
  type Store,
} from "./db";
import {
  searchInput,
  type Principal,
  type createExternalAccess,
} from "./external-access";
import type { createChatRuntime } from "./chat";
import { queues, type BackgroundJob } from "./jobs";

export const runSearchInput = searchInput.extend({
  requestId: z.string().uuid().optional(),
  waitSeconds: z.number().int().min(0).max(10).default(2),
});
export const answerInput = z
  .object({
    organizationId: z.string().uuid(),
    question: z.string().trim().min(1).max(4000),
    documentIds: z.array(z.string().uuid()).max(8).default([]),
    selectedModel: z
      .object({ provider: z.string(), model: z.string().min(1).max(150) })
      .strict()
      .optional(),
    requestId: z.string().uuid().optional(),
  })
  .strict();
export const runInput = z
  .object({ organizationId: z.string().uuid(), runId: z.string().uuid() })
  .strict();
export const listRunsInput = z
  .object({
    organizationId: z.string().uuid(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
type Run = {
  id: string;
  org_id: string;
  user_id: string;
  kind: "search" | "answer";
  input: Record<string, unknown>;
  credential: string | null;
  status: string;
  result: { results: { documentId: string; [key: string]: unknown }[] } | null;
  error: string | null;
  job_id: string | null;
  attempt_id: string | null;
  created: Date;
  expires: Date;
};
function runStatus(status: string) {
  if (["retrieving", "generating", "cancelling"].includes(status))
    return "running";
  if (status === "dismissed") return "cancelled";
  return status;
}

export function createRuns(
  store: Store,
  access: ReturnType<typeof createExternalAccess>,
  chats: ReturnType<typeof createChatRuntime>,
  origin: string,
) {
  const running = new Map<string, AbortController>();
  const activeLimit = configuredLimit("RUN_USER_CONCURRENCY", 3);
  async function find(principal: Principal, orgId: string, runId: string) {
    await access.actor(principal, orgId);
    const run = await store.one<Run>(
      "SELECT * FROM external_runs WHERE id=? AND org_id=? AND user_id=? AND expires>now()",
      runId,
      orgId,
      principal.userId,
    );
    if (!run) throw new HttpError(404, "Run not found");
    access.requireScope(principal, "search:read");
    if (run.kind === "answer") access.requireScope(principal, "documents:read");
    return run;
  }
  async function admit(
    principal: Principal,
    orgId: string,
    runId: string,
    kind: Run["kind"],
    input: Record<string, unknown>,
  ) {
    const existing = await store.one<Run>(
      "SELECT * FROM external_runs WHERE id=?",
      runId,
    );
    if (existing) {
      if (
        existing.org_id !== orgId ||
        existing.user_id !== principal.userId ||
        existing.kind !== kind ||
        !isDeepStrictEqual(existing.input, input)
      )
        throw new HttpError(
          409,
          "This request identifier was already used for another run",
        );
      if (new Date(existing.expires).getTime() <= Date.now())
        throw new HttpError(
          410,
          "This run has expired. Use a new request identifier.",
        );
      return false;
    }
    if (
      kind === "answer" &&
      (await store.one("SELECT id FROM chats WHERE id=?", runId))
    )
      throw new HttpError(
        410,
        "This run identifier is unavailable. Use a new request identifier.",
      );
    const pending = await store.one<{ count: number }>(
      "SELECT count(*)::integer AS count FROM external_runs r LEFT JOIN chat_turns t ON t.id=r.id WHERE r.org_id=? AND r.user_id=? AND ((r.kind='search' AND r.status IN ('queued','running')) OR (r.kind='answer' AND t.status IN ('queued','retrieving','generating','cancelling')))",
      orgId,
      principal.userId,
    );
    if ((pending?.count ?? 0) >= activeLimit)
      throw new HttpError(
        429,
        "Too many active runs. Wait for a result or cancel a run.",
      );
    await access.limitSearch(principal, orgId);
    return true;
  }
  async function startSearch(
    principal: Principal,
    raw: unknown,
    credential: string,
  ) {
    access.requireScope(principal, "search:read");
    const {
      requestId,
      waitSeconds: _wait,
      ...parsed
    } = runSearchInput.parse(raw);
    const input = {
      ...parsed,
      documentIds: [...new Set(parsed.documentIds)].sort(),
    };
    const actor = await access.actor(principal, input.organizationId);
    for (const resource of await requireResources(
      store,
      actor,
      input.documentIds,
    )) {
      if (resource.kind !== "document")
        throw new HttpError(404, "Document not found");
    }
    if (
      input.folderId &&
      (await requireResource(store, actor, input.folderId)).kind !== "folder"
    )
      throw new HttpError(404, "Folder not found");
    const runId = requestId ?? randomUUID();
    await store.transaction(async () => {
      if (
        !(await admit(principal, input.organizationId, runId, "search", input))
      )
        return;
      await store.run(
        "INSERT INTO external_runs(id,org_id,user_id,kind,input,credential) VALUES(?,?,?,'search',?::jsonb,?)",
        runId,
        input.organizationId,
        principal.userId,
        JSON.stringify(input),
        store.encrypt(credential),
      );
      const jobId = await store.jobs.send(queues.search, { runId }, runId);
      await store.run(
        "UPDATE external_runs SET job_id=? WHERE id=?",
        jobId,
        runId,
      );
    });
    return get(principal, { organizationId: input.organizationId, runId });
  }
  async function startAnswer(
    principal: Principal,
    raw: unknown,
    credential: string,
  ) {
    access.requireScope(principal, "search:read");
    access.requireScope(principal, "documents:read");
    const { requestId, ...parsed } = answerInput.parse(raw);
    const input = {
      ...parsed,
      documentIds: [...new Set(parsed.documentIds)].sort(),
    };
    const a = await access.actor(principal, input.organizationId);
    const runId = requestId ?? randomUUID();
    await store.transaction(async () => {
      if (
        !(await admit(principal, input.organizationId, runId, "answer", input))
      )
        return;
      await chats.startAnswer(
        a,
        {
          content: input.question,
          documentIds: input.documentIds,
          selectedModel: input.selectedModel,
        },
        runId,
        credential,
      );
      await store.run(
        "INSERT INTO external_runs(id,org_id,user_id,kind,input,chat_id,credential) VALUES(?,?,?,'answer',?::jsonb,?,NULL)",
        runId,
        input.organizationId,
        principal.userId,
        JSON.stringify(input),
        runId,
      );
    });
    return get(principal, { organizationId: input.organizationId, runId });
  }
  async function get(principal: Principal, raw: unknown) {
    const input = runInput.parse(raw);
    const run = await find(principal, input.organizationId, input.runId);
    const state =
      run.kind === "answer"
        ? await chats.answerRun(
            await access.actor(principal, run.org_id),
            run.id,
          )
        : {
            status: run.status,
            ...(run.error ? { error: run.error } : {}),
            ...(run.result ? { result: run.result } : {}),
          };
    if (run.kind === "search" && run.result) {
      const actor = await access.actor(principal, run.org_id);
      const allowed = await resourceAccessBatch(
        store,
        actor,
        run.result.results.map((source) => source.documentId),
      );
      const results = run.result.results.filter((source) =>
        allowed.has(source.documentId),
      );
      state.result = { results };
    }
    return {
      runId: run.id,
      kind: run.kind,
      createdAt: new Date(run.created).toISOString(),
      expiresAt: new Date(run.expires).toISOString(),
      ...state,
      status: runStatus(state.status),
      ...(["queued", "running"].includes(runStatus(state.status))
        ? { retryAfterMs: 1000 }
        : {}),
      ...(run.kind === "answer" ? { phase: state.status } : {}),
      ...(run.kind === "answer"
        ? { chatId: run.id, url: `${origin}/chats/${run.id}` }
        : {}),
    };
  }
  async function list(principal: Principal, raw: unknown) {
    const input = listRunsInput.parse(raw);
    access.requireScope(principal, "search:read");
    await access.actor(principal, input.organizationId);
    const rows = await store.all<{
      id: string;
      kind: Run["kind"];
      status: string;
      created: Date;
    }>(
      "SELECT r.id,r.kind,CASE WHEN r.kind='answer' THEN t.status ELSE r.status END AS status,r.created FROM external_runs r LEFT JOIN chat_turns t ON t.id=r.id WHERE r.org_id=? AND r.user_id=? AND r.expires>now() ORDER BY r.created DESC LIMIT ?",
      input.organizationId,
      principal.userId,
      input.limit,
    );
    return {
      runs: rows
        .filter(
          (row) =>
            row.kind !== "answer" ||
            principal.scopes.includes("documents:read"),
        )
        .map((row) => ({
          runId: row.id,
          kind: row.kind,
          status: runStatus(row.status),
          createdAt: new Date(row.created).toISOString(),
          ...(row.kind === "answer"
            ? { chatId: row.id, url: `${origin}/chats/${row.id}` }
            : {}),
        })),
    };
  }
  async function cancel(principal: Principal, raw: unknown) {
    const input = runInput.parse(raw);
    await store.transaction(async () => {
      const run = await find(principal, input.organizationId, input.runId);
      if (run.kind === "answer")
        await chats.cancelAnswer(
          await access.actor(principal, run.org_id),
          run.id,
        );
      else {
        await store.run(
          "UPDATE external_runs SET status='cancelled',credential=NULL,attempt_id=NULL,updated=now() WHERE id=? AND status IN ('queued','running')",
          run.id,
        );
        if (run.job_id && ["queued", "running"].includes(run.status))
          await store.jobs.cancel(queues.search, run.job_id);
      }
    });
    running.get(input.runId)?.abort();
    return get(principal, input);
  }
  async function process(job: BackgroundJob) {
    const attemptId = randomUUID();
    const run = await store.jobs.guard(job, async () => {
      const current = await store.one<Run>(
        "SELECT * FROM external_runs WHERE id=? AND job_id=?",
        job.data.runId,
        job.id,
      );
      if (!current || !["queued", "running"].includes(current.status)) return;
      await store.run(
        "UPDATE external_runs SET status='running',attempt_id=?,updated=now() WHERE id=?",
        attemptId,
        current.id,
      );
      return current;
    });
    if (!run) return;
    const controller = new AbortController();
    const abort = () => controller.abort(job.signal.reason);
    job.signal.addEventListener("abort", abort, { once: true });
    if (job.signal.aborted) abort();
    running.set(run.id, controller);
    let credential: string;
    async function check() {
      controller.signal.throwIfAborted();
      const current = await store.one(
        "SELECT id FROM external_runs WHERE id=? AND attempt_id=? AND status='running' AND expires>now()",
        run!.id,
        attemptId,
      );
      if (!current) throw new HttpError(409, "Run stopped");
      const principal = await access.delegatedPrincipal(credential);
      access.requireScope(principal, "search:read");
      await access.actor(principal, run!.org_id);
      return principal;
    }
    let checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void check()
        .catch((error) => controller.abort(error))
        .finally(() => {
          checking = false;
        });
    }, 1000);
    timer.unref();
    try {
      credential = store.decrypt(run.credential!);
      const result = await access.search(
        await check(),
        run.input,
        check,
        controller.signal,
        true,
      );
      await store.jobs.complete(job, async () => {
        await check();
        await store.run(
          "UPDATE external_runs SET status='completed',result=?::jsonb,credential=NULL,attempt_id=NULL,updated=now() WHERE id=? AND attempt_id=?",
          JSON.stringify(result),
          run.id,
          attemptId,
        );
      });
    } catch (error) {
      const reason = controller.signal.reason ?? error;
      await store.jobs.guard(job, () =>
        store.run(
          "UPDATE external_runs SET status='failed',error=?,credential=NULL,attempt_id=NULL,updated=now() WHERE id=? AND attempt_id=? AND status='running'",
          reason instanceof HttpError
            ? reason.message
            : "The search was interrupted. Start a new run to retry.",
          run.id,
          attemptId,
        ),
      );
    } finally {
      clearInterval(timer);
      job.signal.removeEventListener("abort", abort);
      if (running.get(run.id) === controller) running.delete(run.id);
    }
  }
  async function wait(
    principal: Principal,
    raw: unknown,
    seconds: number,
    signal: AbortSignal,
  ) {
    const deadline = Date.now() + seconds * 1000;
    let current = await get(principal, raw);
    while (
      ["queued", "running"].includes(current.status) &&
      Date.now() < deadline &&
      !signal.aborted
    ) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(200, deadline - Date.now()));
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
      current = await get(principal, raw);
    }
    return current;
  }
  return { startSearch, startAnswer, get, list, cancel, process, wait };
}
