import { queues, type BackgroundJob } from "./jobs";
import { Router, type Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncEvery } from "./async";
import {
  HttpError,
  requireResource,
  resourceAccess,
  type Actor,
  type Store,
} from "./db";
import { availableChatModels } from "./ai";
import { getSettings, type createProviders } from "./providers";
import type { ChatModel, ChatTurn } from "../shared/chat";

type Message = {
  role: string;
  content: string;
  attachments?: { id: string; name: string }[];
  selectedModel?: ChatModel;
  turnId?: string;
  sources?: unknown[];
  trace?: unknown[];
  retrievalDurationMs?: number;
};
type Chat = {
  id: string;
  org_id: string;
  user_id: string;
  title: string;
  messages: string;
  dependencies: string;
  updated: string;
};
type Turn = {
  id: string;
  chat_id: string;
  position: number;
  session_token: string;
  content: string;
  document_ids: string[];
  attachments: { id: string; name: string }[];
  selected_model: ChatModel | null;
  status: string;
  partial_text: string;
  dependencies: string[];
  error: string | null;
  error_status: number | null;
  attempt_id: string | null;
  stream: boolean;
  regenerate_base: string | null;
};
const uuid = z.string().uuid();
const modelSchema = z
  .object({ provider: z.string(), model: z.string().min(1).max(150) })
  .strict();
const inputSchema = z.object({
  id: uuid.optional(),
  content: z.string().trim().min(1).max(4000),
  documentIds: z.array(uuid).max(8).default([]),
  selectedModel: modelSchema.optional(),
});
const activeStatuses = ["retrieving", "generating", "cancelling"];
const pendingStatuses = [...activeStatuses, "queued", "failed", "cancelled"];
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createChatRuntime(
  store: Store,
  providers: ReturnType<typeof createProviders>,
  authenticate: (req: Request) => Promise<Actor>,
  authenticateToken: (token: string) => Promise<Actor>,
) {
  const router = Router();
  const running = new Map<
    string,
    { controller: AbortController; work: Promise<void> }
  >();
  let closed = false;
  const streams = new Set<() => void>();
  async function chatFor(a: Actor, chatId: string, includeHistory = true) {
    const chat = await store.one<Chat>(
      `SELECT ${includeHistory ? "*" : "id,org_id,user_id,title,dependencies,updated"} FROM chats WHERE id=? AND org_id=? AND user_id=?`,
      chatId,
      a.orgId,
      a.userId,
    );
    if (!chat || !(await store.permission(a, "chat", chat.id, "read")))
      throw new HttpError(404, "Conversation not found");
    return chat;
  }
  async function readable(a: Actor, deps: string[]) {
    return asyncEvery(
      deps,
      async (id) => !!(await resourceAccess(store, a, id)),
    );
  }
  async function assertReadable(a: Actor, deps: string[]) {
    if (!(await readable(a, deps)))
      throw new HttpError(
        403,
        "Source access changed. Start a new conversation.",
      );
  }
  async function snapshot(
    a: Actor,
    chatId: string,
    window: {
      before?: number;
      start?: number;
      end?: number;
      outline?: boolean;
    } = {},
  ) {
    const chat = await chatFor(a, chatId, false);
    const turns = await store.all<Turn>(
      "SELECT * FROM chat_turns WHERE chat_id=? AND status=ANY(?::text[]) ORDER BY position",
      chatId,
      pendingStatuses,
    );
    const rows = await store.all<{
      title: string;
      updated: string;
      roles: string | null;
      dependencies: string;
      message_count: number;
      position: number | null;
      payload: Message | null;
    }>(
      `SELECT c.title,c.updated,c.dependencies,COALESCE(latest.position+1,0) AS message_count,m.*
       FROM chats c
       LEFT JOIN LATERAL (
         SELECT position FROM chat_messages WHERE chat_id=c.id ORDER BY position DESC LIMIT 1
       ) latest ON true
       LEFT JOIN LATERAL (
         ${
           window.outline
             ? "SELECT NULL::integer AS position,NULL::jsonb AS payload,COALESCE(string_agg(role,'' ORDER BY position),'') AS roles FROM chat_messages WHERE chat_id=c.id"
             : `SELECT position,payload,NULL::text AS roles FROM chat_messages WHERE chat_id=c.id ${window.start !== undefined ? "AND position>=? AND position<?" : window.before !== undefined ? "AND position<?" : ""} ORDER BY position DESC LIMIT ${window.start !== undefined ? 160 : 51}`
         }
       ) m ON true
       WHERE c.id=? AND c.org_id=? AND c.user_id=?
       ORDER BY m.position DESC`,
      ...(window.start !== undefined
        ? [window.start, window.end]
        : window.before !== undefined
          ? [window.before]
          : []),
      chatId,
      a.orgId,
      a.userId,
    );
    const saved = rows[0];
    if (!saved) throw new HttpError(404, "Conversation not found");
    const deps = [
      ...new Set([
        ...JSON.parse(saved.dependencies),
        ...turns.flatMap((t) => [...t.dependencies, ...t.document_ids]),
      ]),
    ];
    if (!(await readable(a, deps)))
      return {
        id: chat.id,
        title: "Sources no longer available",
        messages: [] as Message[],
        turns: [] as ChatTurn[],
        blocked: true,
        nextCursor: null,
        messageCount: 0,
        revision: saved.updated,
        ...(window.outline ? { roles: "" } : {}),
      };
    const messages = rows.filter(
      (row): row is typeof row & { position: number; payload: Message } =>
        row.position !== null && row.payload !== null,
    );
    const page = messages
      .slice(0, window.start !== undefined ? 160 : 50)
      .reverse();
    return {
      id: chat.id,
      title: saved.title,
      messages: page.map(({ position, payload }) => ({ ...payload, position })),
      nextCursor:
        window.start !== undefined
          ? page[0]?.position || null
          : messages.length > 50
            ? page[0].position
            : null,
      messageCount: saved.message_count,
      revision: saved.updated,
      ...(window.outline ? { roles: saved.roles ?? "" } : {}),
      blocked: false,
      turns: turns.map((t): ChatTurn => ({
        id: t.id,
        content: t.content,
        status: t.status as ChatTurn["status"],
        partialText: t.partial_text,
        attachments: t.attachments,
        selectedModel: t.selected_model,
        error: t.error,
        regenerating: !!t.regenerate_base,
      })),
    };
  }
  async function validateInput(a: Actor, raw: unknown) {
    const input = inputSchema.parse(raw);
    const settings = await getSettings(store, a.orgId);
    const selectedModel =
      input.selectedModel ??
      (settings.provider && settings.model
        ? availableChatModels(settings).find(
            (model) =>
              model.provider === settings.provider &&
              model.model === settings.model,
          )
        : undefined) ??
      availableChatModels(settings)[0];
    if (
      !selectedModel ||
      !availableChatModels(settings).some(
        (m) =>
          m.provider === selectedModel.provider &&
          m.model === selectedModel.model,
      )
    )
      throw new HttpError(
        400,
        "This model is not enabled for your organization.",
      );
    const documentIds = [...new Set(input.documentIds)];
    const attachments = await Promise.all(
      documentIds.map(async (id) => {
        const resource = await requireResource(store, a, id);
        if (resource.kind !== "document" || resource.status !== "ready")
          throw new HttpError(
            409,
            "Wait for attached documents to finish indexing before sending.",
          );
        return { id: resource.id, name: resource.name };
      }),
    );
    return {
      ...input,
      documentIds,
      selectedModel: {
        provider: selectedModel.provider,
        model: selectedModel.model,
      },
      attachments,
    };
  }
  async function enqueue(
    a: Actor,
    chatId: string,
    raw: unknown,
    stream: boolean,
    regenerateBase?: string,
  ) {
    return store.transaction(async () => {
      const chat = await chatFor(a, chatId);
      await assertReadable(a, JSON.parse(chat.dependencies));
      const input = await validateInput(a, raw);
      const turnId = input.id ?? randomUUID();
      const existing = await store.one<Turn>(
        "SELECT * FROM chat_turns WHERE id=?",
        turnId,
      );
      if (existing) {
        if (
          existing.chat_id !== chatId ||
          existing.content !== input.content ||
          JSON.stringify(existing.document_ids) !==
            JSON.stringify(input.documentIds) ||
          existing.selected_model?.provider !== input.selectedModel.provider ||
          existing.selected_model?.model !== input.selectedModel.model
        )
          throw new HttpError(
            409,
            "This message identifier was already used. Reload the conversation.",
          );
        return turnId;
      }
      const pending = await store.all<Turn>(
        "SELECT * FROM chat_turns WHERE chat_id=? AND status=ANY(?::text[])",
        chatId,
        pendingStatuses,
      );
      if (pending.length >= 11)
        throw new HttpError(
          409,
          "The queue is full. Wait for an answer or remove a queued message.",
        );
      if (
        regenerateBase &&
        (pending.length || hash(chat.messages) !== regenerateBase)
      )
        throw new HttpError(
          409,
          "Wait for the current queue to finish before regenerating.",
        );
      await store.run(
        "INSERT INTO chat_turns(id,chat_id,session_token,content,document_ids,attachments,selected_model,stream,regenerate_base) VALUES(?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?,?)",
        turnId,
        chatId,
        a.token,
        input.content,
        JSON.stringify(input.documentIds),
        JSON.stringify(input.attachments),
        JSON.stringify(input.selectedModel),
        stream,
        regenerateBase ?? null,
      );
      await wake(chatId);
      return turnId;
    });
  }
  async function execute(
    turn: Turn,
    controller: AbortController,
    job: BackgroundJob,
  ) {
    let deps = [...turn.document_ids];
    const check = async () => {
      controller.signal.throwIfAborted();
      const attempt = await store.one<Turn>(
        "SELECT * FROM chat_turns WHERE id=? AND attempt_id=?",
        turn.id,
        turn.attempt_id,
      );
      if (!attempt || !["retrieving", "generating"].includes(attempt.status)) {
        controller.abort();
        controller.signal.throwIfAborted();
      }
      const a = await authenticateToken(turn.session_token);
      const chat = await chatFor(a, turn.chat_id);
      await assertReadable(a, [...JSON.parse(chat.dependencies), ...deps]);
      return { a, chat };
    };
    let checkingAccess = false;
    const accessCheck = setInterval(() => {
      if (checkingAccess) return;
      checkingAccess = true;
      void (async () => {
        await check();
      })()
        .catch((error) => controller.abort(error))
        .finally(() => {
          checkingAccess = false;
        });
    }, 1000);
    accessCheck.unref();
    try {
      const { a, chat } = await check();
      await validateInput(a, {
        content: turn.content,
        documentIds: turn.document_ids,
        selectedModel: turn.selected_model,
      });
      if (turn.regenerate_base && hash(chat.messages) !== turn.regenerate_base)
        throw new HttpError(
          409,
          "The conversation changed. Regenerate the latest answer instead.",
        );
      const retrieval: Awaited<ReturnType<typeof providers.retrieve>> = {
        mode: "jev",
        limited: false,
        results: [],
        trace: [],
      };
      const sourceKey = (source: (typeof retrieval.results)[number]) =>
        `${source.documentId}:${source.nodeId}:${source.content}`;
      let searches = 0;
      let retrievalDurationMs: number | undefined;
      let searchChain: Promise<unknown> = Promise.resolve();
      const runSearch = async (query: string, signal?: AbortSignal) => {
        const started = performance.now();
        const { a: currentActor } = await check();
        await store.run(
          "UPDATE chat_turns SET status='retrieving' WHERE id=? AND attempt_id=? AND status='generating'",
          turn.id,
          turn.attempt_id,
        );
        const found = await providers.retrieve(
          currentActor,
          query,
          turn.document_ids,
          signal ?? controller.signal,
        );
        for (const source of found.results)
          if (
            !retrieval.results.some(
              (existing) => sourceKey(existing) === sourceKey(source),
            )
          )
            retrieval.results.push(source);
        for (const step of found.trace)
          if (
            !retrieval.trace.some(
              (existing) => JSON.stringify(existing) === JSON.stringify(step),
            )
          )
            retrieval.trace.push(step);
        deps = [
          ...new Set([
            ...JSON.parse(chat.dependencies),
            ...turn.document_ids,
            ...retrieval.results.map((source) => source.documentId),
            ...retrieval.trace.flatMap((step) =>
              step.resourceId ? [step.resourceId] : [],
            ),
          ]),
        ];
        await check();
        await store.run(
          "UPDATE chat_turns SET status='generating',dependencies=?::jsonb WHERE id=? AND attempt_id=? AND status='retrieving'",
          JSON.stringify(deps),
          turn.id,
          turn.attempt_id,
        );
        retrievalDurationMs =
          (retrievalDurationMs ?? 0) + performance.now() - started;
        return {
          sources: found.results.map((source) => ({
            citation:
              retrieval.results.findIndex(
                (existing) => sourceKey(existing) === sourceKey(source),
              ) + 1,
            title: source.name,
            section: source.title,
            page: source.page,
            text: source.content,
          })),
        };
      };
      const searchDocuments = (query: string, signal?: AbortSignal) => {
        if (++searches > 5)
          return Promise.resolve({
            sources: [],
            message:
              "The search limit has been reached. Answer using the evidence already retrieved.",
          });
        const result = searchChain.then(() => runSearch(query, signal));
        searchChain = result;
        return result;
      };
      await store.run(
        "UPDATE chat_turns SET status='generating',dependencies=?::jsonb WHERE id=? AND attempt_id=? AND status='retrieving'",
        JSON.stringify(deps),
        turn.id,
        turn.attempt_id,
      );
      const history: Message[] = JSON.parse(chat.messages);
      const context = turn.regenerate_base ? history.slice(0, -2) : history;
      let lastWrite = 0;
      const onText = async (text: string) => {
        controller.signal.throwIfAborted();
        if (Date.now() - lastWrite < 100) return;
        lastWrite = Date.now();
        await check();
        await store.run(
          "UPDATE chat_turns SET partial_text=? WHERE id=? AND attempt_id=? AND status='generating'",
          text,
          turn.id,
          turn.attempt_id,
        );
      };
      const answer = await providers.answer(
        a.orgId,
        turn.content,
        context.map(({ role, content }) => ({ role, content })),
        retrieval.results,
        turn.selected_model ?? undefined,
        {
          signal: controller.signal,
          searchDocuments,
          beforeStep: async () => {
            await check();
          },
          ...(turn.stream ? { onText } : {}),
        },
      );
      await store.jobs.complete(job, async () => {
        const { chat: current } = await check();
        if (current.messages !== chat.messages)
          throw new HttpError(409, "The conversation changed. Please retry.");
        const messages = [
          ...context,
          {
            role: "user",
            content: turn.content,
            attachments: turn.attachments,
            turnId: turn.id,
          },
          {
            role: "assistant",
            content: answer,
            selectedModel: turn.selected_model,
            turnId: turn.id,
            sources: retrieval.results.map(({ content, score, ...s }) => s),
            trace: retrieval.trace,
            retrievalDurationMs:
              retrievalDurationMs === undefined
                ? undefined
                : Math.round(retrievalDurationMs),
          },
        ];
        await store.run(
          "UPDATE chats SET title=?,messages=?,dependencies=?,updated=? WHERE id=?",
          history.length ? chat.title : turn.content.slice(0, 80),
          JSON.stringify(messages),
          JSON.stringify(deps),
          new Date().toISOString(),
          chat.id,
        );
        await store.run(
          "UPDATE chat_turns SET status='completed',partial_text=?,attempt_id=NULL WHERE id=? AND attempt_id=?",
          answer,
          turn.id,
          turn.attempt_id,
        );
        const next = await store.one<Turn>(
          "SELECT * FROM chat_turns WHERE chat_id=? AND status=ANY(?::text[]) ORDER BY position LIMIT 1",
          chat.id,
          pendingStatuses,
        );
        if (next?.status === "queued") await wake(chat.id);
      });
    } catch (error) {
      const reason =
        controller.signal.reason instanceof HttpError
          ? controller.signal.reason
          : error;
      await store.run(
        "UPDATE chat_turns SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'failed' END,error=?,error_status=?,attempt_id=NULL WHERE id=? AND attempt_id=? AND status IN ('retrieving','generating','cancelling')",
        reason instanceof HttpError
          ? reason.message
          : controller.signal.aborted
            ? "The answer was interrupted. Retry when you are ready."
            : "The answer could not be completed. Please retry.",
        reason instanceof HttpError ? reason.status : 502,
        turn.id,
        turn.attempt_id,
      );
    } finally {
      clearInterval(accessCheck);
    }
  }
  async function wake(chatId: string) {
    await store.jobs.send(queues.chat, { chatId }, chatId);
  }
  async function process(job: BackgroundJob) {
    if (closed) throw new Error("Chat worker is stopping");
    const turn = await store.jobs.guard(job, async () => {
      const candidate = await store.one<Turn>(
        "SELECT * FROM chat_turns WHERE chat_id=? AND status=ANY(?::text[]) ORDER BY position LIMIT 1",
        job.data.chatId,
        pendingStatuses,
      );
      if (!candidate) return;
      if (activeStatuses.includes(candidate.status)) {
        await store.run(
          "UPDATE chat_turns SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'failed' END,error='The answer was interrupted. Retry when you are ready.',error_status=503,attempt_id=NULL WHERE id=?",
          candidate.id,
        );
        return;
      }
      if (candidate.status !== "queued") return;
      const attempt = randomUUID();
      await store.run(
        "UPDATE chat_turns SET status='retrieving',attempt_id=?,job_id=?,error=NULL,error_status=NULL,partial_text='' WHERE id=?",
        attempt,
        job.id,
        candidate.id,
      );
      return { ...candidate, status: "retrieving", attempt_id: attempt };
    });
    if (!turn) return;
    const controller = new AbortController();
    const abort = () => controller.abort(job.signal.reason);
    job.signal.addEventListener("abort", abort, { once: true });
    const work = execute(turn, controller, job).finally(() => {
      running.delete(turn.id);
      job.signal.removeEventListener("abort", abort);
    });
    running.set(turn.id, { controller, work });
    await work;
  }

  router.get("/", async (req, res) => {
    const a = await authenticate(req);
    const chats = await store.all<Chat>(
      "SELECT id,title,updated,dependencies FROM chats WHERE org_id=? AND user_id=? ORDER BY updated DESC",
      a.orgId,
      a.userId,
    );
    res.json(
      await Promise.all(
        chats.map(async (chat) => {
          const blocked = !(await readable(a, JSON.parse(chat.dependencies)));
          return {
            id: chat.id,
            title: blocked ? "Sources no longer available" : chat.title,
            updated: chat.updated,
            blocked,
          };
        }),
      ),
    );
  });
  router.post("/", async (req, res) => {
    const result = await store.transaction(async () => {
      const a = await authenticate(req);
      const id = randomUUID();
      await store.run(
        "INSERT INTO chats(id,org_id,user_id,title,updated) VALUES(?,?,?,'New conversation',?)",
        id,
        a.orgId,
        a.userId,
        new Date().toISOString(),
      );
      return { id };
    });
    res.status(201).json(result);
  });
  router.get("/:id", async (req, res) =>
    res.json(
      await snapshot(await authenticate(req), uuid.parse(req.params.id), {
        before:
          req.query.before === undefined
            ? undefined
            : z.coerce
                .number()
                .int()
                .min(0)
                .max(2147483647)
                .parse(req.query.before),
      }),
    ),
  );
  router.get("/:id/outline", async (req, res) => {
    const data = await snapshot(
      await authenticate(req),
      uuid.parse(req.params.id),
      { outline: true },
    );
    res.json({
      id: data.id,
      roles: data.roles,
      messageCount: data.messageCount,
      revision: data.revision,
      blocked: data.blocked,
    });
  });
  router.get("/:id/history", async (req, res) => {
    const range = z
      .object({
        start: z.coerce.number().int().min(0).max(2147483647),
        end: z.coerce.number().int().min(1).max(2147483647),
      })
      .refine(({ start, end }) => end > start && end - start <= 160)
      .parse(req.query);
    res.json(
      await snapshot(await authenticate(req), uuid.parse(req.params.id), range),
    );
  });
  router.delete("/:id", async (req, res) => {
    await store.transaction(async () => {
      const chat = await chatFor(
        await authenticate(req),
        uuid.parse(req.params.id),
      );
      const turns = await store.all<Turn>(
        "SELECT * FROM chat_turns WHERE chat_id=?",
        chat.id,
      );
      for (const turn of turns) running.get(turn.id)?.controller.abort();
      await store.run("DELETE FROM chats WHERE id=?", chat.id);
    });
    res.json({ ok: true });
  });
  router.get("/:id/events", async (req, res) => {
    const chatId = uuid.parse(req.params.id);
    const initial = await snapshot(await authenticate(req), chatId);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, private",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    let last = JSON.stringify(initial);
    res.write(`event: snapshot\ndata: ${last}\n\n`);
    let lastWrite = Date.now();
    let ended = false;
    let timer: ReturnType<typeof setTimeout>;
    const close = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      streams.delete(close);
      res.end();
    };
    streams.add(close);
    res.on("close", close);
    const pump = async () => {
      if (ended) return;
      try {
        const data = JSON.stringify(
          await snapshot(await authenticate(req), chatId),
        );
        if (!ended && data !== last) {
          if (res.writableNeedDrain) {
            close();
            return;
          }
          last = data;
          res.write(`event: snapshot\ndata: ${data}\n\n`);
          lastWrite = Date.now();
        } else if (!ended && Date.now() - lastWrite >= 15_000) {
          if (res.writableNeedDrain) {
            close();
            return;
          }
          res.write(": heartbeat\n\n");
          lastWrite = Date.now();
        }
      } catch (error) {
        if (!ended)
          res.write(
            `event: unavailable\ndata: ${JSON.stringify({ error: error instanceof HttpError ? error.message : "Connection interrupted", status: error instanceof HttpError ? error.status : 503 })}\n\n`,
          );
        close();
      }
      if (!ended) timer = setTimeout(() => void pump(), 350);
    };
    timer = setTimeout(() => void pump(), 350);
  });
  router.post("/:id/turns", async (req, res) => {
    const turnId = await enqueue(
      await authenticate(req),
      uuid.parse(req.params.id),
      req.body,
      true,
    );
    res.status(202).json({ id: turnId });
  });
  router.post("/:id/regenerate", async (req, res) => {
    const a = await authenticate(req);
    const chat = await chatFor(a, uuid.parse(req.params.id));
    const history: Message[] = JSON.parse(chat.messages);
    const last = history.at(-1),
      question = history.at(-2);
    if (!last || last.role !== "assistant" || question?.role !== "user")
      throw new HttpError(409, "There is no answer to regenerate yet.");
    const turnId = await enqueue(
      a,
      chat.id,
      {
        id: req.body.id,
        content: question.content,
        documentIds: question.attachments?.map((a) => a.id) ?? [],
        selectedModel: req.body.selectedModel,
      },
      true,
      hash(chat.messages),
    );
    res.status(202).json({ id: turnId });
  });
  router.post("/:id/branch", async (req, res) => {
    const result = await store.transaction(async () => {
      const a = await authenticate(req);
      const chat = await chatFor(a, uuid.parse(req.params.id));
      await assertReadable(a, JSON.parse(chat.dependencies));
      const index = z.number().int().min(0).parse(req.body.messageIndex);
      const history: Message[] = JSON.parse(chat.messages);
      if (index >= history.length)
        throw new HttpError(400, "Choose a saved message to branch from.");
      const messages = history.slice(0, index + 1);
      const deps = [
        ...new Set(
          messages.flatMap((m) => [
            ...(m.attachments ?? []).map((a) => a.id),
            ...(m.sources ?? []).flatMap((s) =>
              typeof s === "object" &&
              s &&
              "documentId" in s &&
              typeof s.documentId === "string"
                ? [s.documentId]
                : [],
            ),
            ...(m.trace ?? []).flatMap((s) =>
              typeof s === "object" &&
              s &&
              "resourceId" in s &&
              typeof s.resourceId === "string"
                ? [s.resourceId]
                : [],
            ),
          ]),
        ),
      ];
      const id = randomUUID();
      await store.run(
        "INSERT INTO chats(id,org_id,user_id,title,messages,dependencies,updated) VALUES(?,?,?,?,?,?,?)",
        id,
        a.orgId,
        a.userId,
        `${chat.title.slice(0, 70)} · branch`,
        JSON.stringify(messages),
        JSON.stringify(deps),
        new Date().toISOString(),
      );
      return { id };
    });
    res.status(201).json(result);
  });
  router.post("/:id/turns/reorder", async (req, res) => {
    const input = z.object({ id: uuid, overId: uuid }).strict().parse(req.body);
    await store.transaction(async () => {
      const chat = await chatFor(
        await authenticate(req),
        uuid.parse(req.params.id),
      );
      const rows = await store.all<Turn>(
        "SELECT * FROM chat_turns WHERE chat_id=? AND status=ANY(?::text[]) ORDER BY position",
        chat.id,
        pendingStatuses,
      );
      const from = rows.findIndex((turn) => turn.id === input.id);
      const to = rows.findIndex((turn) => turn.id === input.overId);
      if (
        from < 0 ||
        to < 0 ||
        rows
          .slice(Math.min(from, to), Math.max(from, to) + 1)
          .some((turn) => turn.status !== "queued")
      )
        throw new HttpError(
          409,
          "The queue changed. Only waiting messages can be reordered.",
        );
      const positions = rows.map((turn) => turn.position);
      const [moved] = rows.splice(from, 1);
      rows.splice(to, 0, moved);
      for (let index = Math.min(from, to); index <= Math.max(from, to); index++)
        await store.run(
          "UPDATE chat_turns SET position=? WHERE id=?",
          positions[index],
          rows[index].id,
        );
      await wake(chat.id);
    });
    res.json({ ok: true });
  });
  router.patch("/:id/turns/:turnId", async (req, res) => {
    await store.transaction(async () => {
      const a = await authenticate(req);
      const chat = await chatFor(a, uuid.parse(req.params.id));
      const turn = await store.one<Turn>(
        "SELECT * FROM chat_turns WHERE id=? AND chat_id=?",
        uuid.parse(req.params.turnId),
        chat.id,
      );
      if (!turn || !["queued", "failed", "cancelled"].includes(turn.status))
        throw new HttpError(
          409,
          "This message has already started. Reload to see its status.",
        );
      const input = z
        .object({
          content: z.string().trim().min(1).max(4000).optional(),
          action: z.enum(["retry", "up", "down"]).optional(),
        })
        .strict()
        .parse(req.body);
      if (input.content !== undefined) {
        if (turn.regenerate_base)
          throw new HttpError(
            409,
            "Remove this regeneration and send a new question to edit it.",
          );
        await store.run(
          "UPDATE chat_turns SET content=? WHERE id=?",
          input.content,
          turn.id,
        );
      }
      if (input.action === "retry") {
        await assertReadable(a, JSON.parse(chat.dependencies));
        await validateInput(a, {
          content: input.content ?? turn.content,
          documentIds: turn.document_ids,
          selectedModel: turn.selected_model,
        });
        await store.run(
          "UPDATE chat_turns SET status='queued',session_token=?,error=NULL,error_status=NULL,partial_text='' WHERE id=?",
          a.token,
          turn.id,
        );
      } else if (input.action) {
        if (turn.status !== "queued")
          throw new HttpError(409, "Retry or remove this message first.");
        const rows = await store.all<Turn>(
          "SELECT * FROM chat_turns WHERE chat_id=? AND status=ANY(?::text[]) ORDER BY position",
          chat.id,
          pendingStatuses,
        );
        const index = rows.findIndex((t) => t.id === turn.id);
        const neighbor = rows[index + (input.action === "up" ? -1 : 1)];
        if (!neighbor || neighbor.status !== "queued")
          throw new HttpError(409, "That message cannot move further.");
        await store.run(
          "UPDATE chat_turns SET position=? WHERE id=?",
          neighbor.position,
          turn.id,
        );
        await store.run(
          "UPDATE chat_turns SET position=? WHERE id=?",
          turn.position,
          neighbor.id,
        );
      }
      await wake(chat.id);
    });
    res.json({ ok: true });
  });
  router.delete("/:id/turns/:turnId", async (req, res) => {
    const turnId = uuid.parse(req.params.turnId);
    await store.transaction(async () => {
      const chat = await chatFor(
        await authenticate(req),
        uuid.parse(req.params.id),
      );
      await store.run(
        "UPDATE chat_turns SET status=CASE WHEN status IN ('retrieving','generating','cancelling') THEN 'cancelling' ELSE 'dismissed' END WHERE id=? AND chat_id=? AND status<> 'completed'",
        turnId,
        chat.id,
      );
      await wake(chat.id);
    });
    running.get(turnId)?.controller.abort();
    res.json({ ok: true });
  });
  router.post("/:id/messages", async (req, res) => {
    const chatId = uuid.parse(req.params.id);
    const turnId = await enqueue(
      await authenticate(req),
      chatId,
      req.body,
      false,
    );

    const deadline = Date.now() + 5 * 60_000;
    while (!res.destroyed && Date.now() < deadline) {
      const turn = await store.one<Turn>(
        "SELECT * FROM chat_turns WHERE id=?",
        turnId,
      );
      if (!turn) throw new HttpError(404, "Conversation not found");
      if (turn.status === "completed") {
        const data = await snapshot(await authenticate(req), chatId);
        if (data.blocked)
          throw new HttpError(
            403,
            "Source access changed. Start a new conversation.",
          );
        return res.json({ messages: data.messages });
      }
      if (["failed", "cancelled", "dismissed"].includes(turn.status)) {
        await store.run(
          "UPDATE chat_turns SET status='dismissed' WHERE id=?",
          turn.id,
        );
        throw new HttpError(
          turn.error_status ?? 409,
          turn.error ?? "The answer was stopped.",
        );
      }
      await delay(250);
    }
    if (!res.destroyed) res.status(202).json({ id: turnId });
  });
  return {
    router,
    process,
    snapshot,
    closeStreams() {
      for (const close of streams) close();
    },
    async close() {
      closed = true;
      for (const close of streams) close();
      const active = [...running.values()];
      for (const { controller } of active) controller.abort();
      await Promise.all(active.map(({ work }) => work));
    },
  };
}
