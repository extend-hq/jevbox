import { runJobs, waitForJobs } from "./jobs";
import { authMailbox } from "./auth-mailbox";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { testDatabase } from "./database";
import {
  searchToolResponse,
  choiceResponse,
  responseEvent,
  responseUsage,
} from "./model-tools";

const origin = "http://localhost:4310";
const mailbox = authMailbox(origin);
let runtime: Awaited<ReturnType<typeof createApp>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let server: ReturnType<typeof runtime.app.listen>;
let directory: string,
  base: string,
  cookie: string,
  other: string,
  documentId: string;
let hold = true;
const calls: { body: any; release: () => void; aborted: boolean }[] = [];
const fetcher: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  if (String(_url).includes("typesafe"))
    return body.questions.usefulness
      ? Response.json({ answers: { usefulness: { type: "score", score: 3 } } })
      : choiceResponse(body);
  assert.equal(String(_url), "https://api.openai.com/v1/responses");
  assert.equal(body.store, false);
  const toolResponse = searchToolResponse(body);
  if (toolResponse) return toolResponse;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const call = { body, release, aborted: false };
  calls.push(call);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false;
      const abort = () => {
        call.aborted = true;
        if (!ended) {
          ended = true;
          controller.error(new Error("Aborted"));
        }
        release();
      };
      init?.signal?.addEventListener("abort", abort, { once: true });
      const emit = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(responseEvent(event)));
      };
      void (async () => {
        emit({
          type: "response.created",
          response: { id: "response", created_at: 1, model: body.model },
        });
        emit({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "message", type: "message" },
        });
        emit({
          type: "response.output_text.delta",
          item_id: "message",
          output_index: 0,
          delta: "The document says ",
        });
        if (hold) await gate;
        if (ended) return;
        emit({
          type: "response.output_text.delta",
          item_id: "message",
          output_index: 0,
          delta: "the process is documented [1].",
        });
        emit({
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "message", type: "message" },
        });
        emit({
          type: "response.completed",
          response: { usage: responseUsage },
        });
        ended = true;
        controller.close();
      })().finally(() => init?.signal?.removeEventListener("abort", abort));
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
};
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  auth = cookie,
) {
  const response = await fetch(base + "/api" + path, {
    method,
    headers: {
      Cookie: auth,
      Origin: origin,
      "X-Jevbox-Request": "1",
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for the chat state");
}
const state = async (id: string) => (await req(`/chats/${id}`)).data;
const newChat = async () => (await req("/chats", "POST")).data.id as string;
const enqueue = (
  chat: string,
  content: string,
  id = randomUUID(),
  model = "model-one",
) =>
  req(`/chats/${chat}/turns`, "POST", {
    id,
    content,
    documentIds: [documentId],
    selectedModel: { provider: "openai", model },
  });
before(async () => {
  database = await testDatabase();
  directory = mkdtempSync(join(tmpdir(), "jevbox-chat-"));
  runtime = await createApp({
    workers: ["auth-email", "chat-answer"],
    directory,
    databaseUrl: database.url,
    origin,
    fetcher,
    rateLimits: false,
    sendAuthEmail: mailbox.sendAuthEmail,
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  cookie = (
    await req(
      "/auth/register",
      "POST",
      {
        name: "Reviewer",
        email: "chat@local.test",
        password: "a-secure-password-123!",
        organization: "Workspace",
      },
      "",
    )
  ).cookie;
  other = (
    await req(
      "/auth/register",
      "POST",
      {
        name: "Another",
        email: "other-chat@local.test",
        password: "a-secure-password-123!",
        organization: "Separate",
      },
      "",
    )
  ).cookie;
  cookie = await mailbox.signIn(base, "chat@local.test");
  other = await mailbox.signIn(base, "other-chat@local.test");
  await req("/settings", "PUT", {
    provider: "openai",
    model: "model-one",
    models: ["model-two"],
    providerKey: "test-key",
    jevKey: "test-key",
    organization: { enabled: false },
  });
  const form = new FormData();
  form.append(
    "file",
    new Blob(["# Process\nThe process is documented and reviewed."]),
    "notes.md",
  );
  documentId = (await req("/documents", "POST", form)).data.id;
  await runJobs(runtime);
});
after(async () => {
  for (const call of calls) call.release();
  await runtime.closeChats();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.cleanup(runtime.store);
  rmSync(directory, { recursive: true, force: true });
});
test("streaming exposes partial text, durable queue edits preserve order, and duplicate admission is idempotent", async () => {
  hold = true;
  const chat = await newChat();
  const id = randomUUID();
  assert.equal((await enqueue(chat, "First process question", id)).status, 202);
  await waitFor(
    () => state(chat),
    (s) => s.turns[0]?.partialText.length > 0,
  );
  assert.equal((await enqueue(chat, "First process question", id)).status, 202);
  assert.equal(calls.length, 1);
  const second = (await enqueue(chat, "Second process question")).data.id;
  const third = (await enqueue(chat, "Third process question")).data.id;
  assert.equal(
    (
      await req(`/chats/${chat}/turns/${third}`, "PATCH", {
        content: "Edited process question",
        action: "up",
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await state(chat)).turns.map((t: any) => t.id),
    [id, third, second],
  );
  assert.equal(
    (
      await req(`/chats/${chat}/turns/reorder`, "POST", {
        id: second,
        overId: third,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await state(chat)).turns.map((t: any) => t.id),
    [id, second, third],
  );
  assert.equal(
    (
      await req(`/chats/${chat}/turns/reorder`, "POST", {
        id: third,
        overId: id,
      })
    ).status,
    409,
  );
  assert.deepEqual(
    (await state(chat)).turns.map((t: any) => t.id),
    [id, second, third],
  );
  assert.equal(
    (
      await req(`/chats/${chat}/turns/reorder`, "POST", {
        id: third,
        overId: second,
      })
    ).status,
    200,
  );
  const streamAbort = new AbortController();
  const stream = await fetch(base + `/api/chats/${chat}/events`, {
    headers: { Cookie: cookie },
    signal: streamAbort.signal,
  });
  assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = stream.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /The document says/);
  streamAbort.abort();
  hold = false;
  calls[0].release();
  const completed = await waitFor(
    () => state(chat),
    (s) => s.messages.length === 6,
  );
  assert.deepEqual(
    completed.messages
      .filter((m: any) => m.role === "user")
      .map((m: any) => m.content),
    [
      "First process question",
      "Edited process question",
      "Second process question",
    ],
  );
  assert.equal(completed.turns.length, 0);
});
test("Stop aborts generation and pauses successors until the stopped turn is removed", async () => {
  hold = true;
  const start = calls.length;
  const chat = await newChat();
  const first = (await enqueue(chat, "Process question")).data.id;
  await waitFor(
    () => state(chat),
    (s) => s.turns[0]?.partialText.length > 0,
  );
  await enqueue(chat, "Follow-up process question");
  assert.equal(
    (await req(`/chats/${chat}/turns/${first}`, "DELETE")).status,
    200,
  );
  const stopped = await waitFor(
    () => state(chat),
    (s) => s.turns[0]?.status === "cancelled",
  );
  assert.equal(calls[start].aborted, true);
  assert.equal(stopped.messages.length, 0);
  assert.equal(stopped.turns[1].status, "queued");
  hold = false;
  await req(`/chats/${chat}/turns/${first}`, "DELETE");
  await waitFor(
    () => state(chat),
    (s) => s.messages.length === 2,
  );
});
test("regeneration replaces only the last answer and branches copy only the selected prefix", async () => {
  hold = false;
  const chat = await newChat();
  await enqueue(chat, "Process question");
  await waitFor(
    () => state(chat),
    (s) => s.messages.length === 2,
  );
  const branch = await req(`/chats/${chat}/branch`, "POST", {
    messageIndex: 1,
  });
  assert.equal(branch.status, 201);
  assert.equal((await state(branch.data.id)).messages.length, 2);
  const regenerated = await req(`/chats/${chat}/regenerate`, "POST", {
    id: randomUUID(),
    selectedModel: { provider: "openai", model: "model-two" },
  });
  assert.equal(regenerated.status, 202);
  const done = await waitFor(
    () => state(chat),
    (s) => s.messages[1]?.selectedModel?.model === "model-two",
  );
  assert.equal(done.messages.length, 2);
  assert.equal(
    (await state(branch.data.id)).messages[1].selectedModel.model,
    "model-one",
  );
  assert.equal(
    (await req(`/chats/${chat}/branch`, "POST", { messageIndex: 1 }, other))
      .status,
    404,
  );
  assert.equal(
    (
      await req(
        `/chats/${chat}/turns/${regenerated.data.id}`,
        "DELETE",
        undefined,
        other,
      )
    ).status,
    404,
  );
});
test("queued messages survive runtime replacement and an interrupted answer requires explicit retry", async () => {
  hold = true;
  const chat = await newChat();
  const first = (await enqueue(chat, "Process question")).data.id;
  await waitFor(
    () => state(chat),
    (s) => s.turns[0]?.partialText.length > 0,
  );
  const second = (await enqueue(chat, "Next process question")).data.id;
  await runtime.closeChats();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await runtime.store.close();
  runtime = await createApp({
    workers: ["auth-email", "chat-answer"],
    directory,
    databaseUrl: database.url,
    origin,
    fetcher,
    rateLimits: false,
    sendAuthEmail: mailbox.sendAuthEmail,
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  await waitForJobs(runtime, ["chat-answer"]);
  const saved = await state(chat);
  assert.deepEqual(
    saved.turns.map((t: any) => [t.id, t.status]),
    [
      [first, "failed"],
      [second, "queued"],
    ],
  );
  hold = false;
  await req(`/chats/${chat}/turns/${first}`, "PATCH", { action: "retry" });
  await waitFor(
    () => state(chat),
    (s) => s.messages.length === 4,
  );
});
test("revoked membership hides live snapshots and prevents the queued successor from running", async () => {
  hold = true;
  const chat = await newChat();
  await enqueue(chat, "Process question");
  await waitFor(
    () => state(chat),
    (s) => s.turns[0]?.partialText.length > 0,
  );
  await enqueue(chat, "Next process question");
  const count = calls.length;
  const me = (await req("/me")).data;
  await runtime.store.run(
    "DELETE FROM members WHERE org_id=? AND user_id=?",
    me.organization.id,
    me.user.id,
  );
  assert.equal((await req(`/chats/${chat}`)).status, 401);
  await waitFor(
    async () =>
      runtime.store.all<{ status: string }>(
        "SELECT status FROM chat_turns WHERE chat_id=? ORDER BY position",
        chat,
      ),
    (rows) => rows[0]?.status === "failed",
  );
  assert.equal(calls.length, count);
  const saved = await runtime.store.one<{ messages: string }>(
    "SELECT messages FROM chats WHERE id=?",
    chat,
  );
  assert.equal(saved?.messages, "[]");
});
