import { isScoreRequest, scoreResponse } from "./model-tools";
import { runJobs, waitForJobs } from "./jobs";
import { authMailbox } from "./auth-mailbox";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { HttpError } from "../server/db";
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
let parallelQueries: string[] | undefined;
let onScore:
  ((body: any, signal?: AbortSignal | null) => Promise<void>) | undefined;
const calls: { body: any; release: () => void; aborted: boolean }[] = [];
const fetcher: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  if (String(_url).includes("typesafe")) {
    if (isScoreRequest(body)) {
      await onScore?.(body, init?.signal);
      return scoreResponse(body, 3);
    }
    return choiceResponse(body);
  }
  assert.equal(String(_url), "https://api.openai.com/v1/responses");
  assert.equal(body.store, false);
  const toolResponse = searchToolResponse(body, parallelQueries);
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
      "/auth/sign-up/email",
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
      "/auth/sign-up/email",
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
  const question = calls[0].body.input.findLast(
    (item: any) => item.role === "user",
  );
  assert.deepEqual(JSON.parse(question.content[0].text).attachedDocuments, [
    { id: documentId, name: "notes.md" },
  ]);
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
test("independent search tools overlap, identical in-flight queries share work, and citations stay stable", async () => {
  hold = false;
  parallelQueries = ["First question", "Second question", "First question"];
  const started = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  onScore = async (body) => {
    started.add(body.state.question);
    await gate;
  };
  const chat = await newChat();
  const firstCall = calls.length;
  try {
    await enqueue(chat, "Compare the documented processes");
    await waitFor(
      async () => started.size,
      (size) => size === 2,
    );
    assert.deepEqual([...started].sort(), [
      "First question",
      "Second question",
    ]);
    release();
    const completed = await waitFor(
      () => state(chat),
      (s) => s.messages.length === 2,
    );
    const generation = calls[firstCall].body;
    assert.equal(generation.parallel_tool_calls, true);
    const outputs = generation.input.filter(
      (item: any) => item.type === "function_call_output",
    );
    assert.equal(outputs.length, 3);
    const sources = outputs.map((item: any) => JSON.parse(item.output).sources);
    assert.deepEqual(sources[0], sources[2]);
    for (const result of sources)
      for (const source of result)
        assert.equal(
          completed.messages[1].sources[source.citation - 1].documentId,
          source.documentId,
        );
    assert.ok(completed.messages[1].retrievalDurationMs > 0);
  } finally {
    release();
    onScore = undefined;
    parallelQueries = undefined;
  }
});

test("one failed parallel lookup aborts its sibling and prevents answer generation", async () => {
  hold = false;
  parallelQueries = ["First question", "Second question"];
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  let siblingAborted = false;
  onScore = async (body, signal) => {
    if (++count === 2) entered();
    if (body.state.question === "First question") {
      await gate;
      throw new HttpError(502, "Scoring unavailable");
    }
    await new Promise<void>((resolve) => {
      const abort = () => {
        siblingAborted = true;
        resolve();
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  };
  const chat = await newChat();
  const firstCall = calls.length;
  try {
    await enqueue(chat, "Compare the documented processes");
    await ready;
    release();
    const failed = await waitFor(
      () => state(chat),
      (s) => s.turns[0]?.status === "failed",
    );
    assert.equal(siblingAborted, true);
    assert.equal(failed.messages.length, 0);
    assert.equal(calls.length, firstCall);
  } finally {
    release();
    onScore = undefined;
    parallelQueries = undefined;
  }
});

test("streaming consumes text while partial persistence is pending and completion flushes the write", async () => {
  const answer = runtime.providers.answer;
  const run = runtime.store.run.bind(runtime.store);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writing = false;
  let consumed = false;
  runtime.store.run = async (sql, ...values) => {
    if (sql.includes("SET partial_text=?")) {
      writing = true;
      await gate;
    }
    return run(sql, ...values);
  };
  runtime.providers.answer = async (...args) => {
    const execution = args[5]!;
    await execution.onText!("First text");
    await execution.onText!("Complete text");
    consumed = true;
    return "Complete text";
  };
  const chat = await newChat();
  try {
    await enqueue(chat, "Process question");
    await waitFor(
      async () => writing && consumed,
      (ready) => ready,
    );
    assert.equal((await state(chat)).messages.length, 0);
    release();
    const completed = await waitFor(
      () => state(chat),
      (s) => s.messages.length === 2,
    );
    assert.equal(completed.messages[1].content, "Complete text");
    assert.equal(completed.turns.length, 0);
  } finally {
    release();
    runtime.providers.answer = answer;
    runtime.store.run = run;
  }
});

test("failed partial persistence prevents committing the answer", async () => {
  const answer = runtime.providers.answer;
  const run = runtime.store.run.bind(runtime.store);
  runtime.store.run = async (sql, ...values) => {
    if (sql.includes("SET partial_text=?"))
      throw new HttpError(503, "Persistence unavailable");
    return run(sql, ...values);
  };
  runtime.providers.answer = async (...args) => {
    await args[5]!.onText!("Partial text");
    return "Complete text";
  };
  const chat = await newChat();
  try {
    await enqueue(chat, "Process question");
    const failed = await waitFor(
      () => state(chat),
      (s) => s.turns[0]?.status === "failed",
    );
    assert.equal(failed.messages.length, 0);
    assert.equal(failed.turns[0].error, "Persistence unavailable");
    assert.equal(
      (
        await runtime.store.one<{ error_status: number }>(
          "SELECT error_status FROM chat_turns WHERE chat_id=?",
          chat,
        )
      )?.error_status,
      503,
    );
  } finally {
    runtime.providers.answer = answer;
    runtime.store.run = run;
  }
});

test("retrieval latency survives reload and excludes time spent generating", async () => {
  hold = true;
  const start = calls.length;
  const chat = await newChat();
  const started = performance.now();
  await enqueue(chat, "Process question");
  await waitFor(
    () => state(chat),
    (s) => s.turns[0]?.partialText.length > 0,
  );
  const retrievalUpperBound = Math.ceil(performance.now() - started);
  await new Promise((resolve) => setTimeout(resolve, 200));
  hold = false;
  calls[start].release();
  const completed = await waitFor(
    () => state(chat),
    (s) => s.messages.length === 2,
  );
  const answer = completed.messages[1];
  assert.ok(answer.trace.length);
  assert.ok(Number.isInteger(answer.retrievalDurationMs));
  assert.ok(answer.retrievalDurationMs > 0);
  assert.ok(answer.retrievalDurationMs <= retrievalUpperBound);
  assert.equal(
    (await state(chat)).messages[1].retrievalDurationMs,
    answer.retrievalDurationMs,
  );
  const greeting = await newChat();
  await enqueue(greeting, "Hello");
  const withoutSearch = await waitFor(
    () => state(greeting),
    (s) => s.messages.length === 2,
  );
  assert.deepEqual(withoutSearch.messages[1].trace, []);
  assert.equal(withoutSearch.messages[1].retrievalDurationMs, undefined);
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
test("long histories use bounded recent-first pages and indexed cursors", async () => {
  const chat = await newChat();
  const messages = Array.from({ length: 10000 }, (_, position) => ({
    role: position % 2 ? "assistant" : "user",
    content: `Message ${position}`,
  }));
  await runtime.store.run(
    "UPDATE chats SET messages=? WHERE id=?",
    JSON.stringify(messages),
    chat,
  );
  const recent = await state(chat);
  assert.equal(recent.messageCount, 10000);
  assert.equal(recent.messages.length, 50);
  assert.equal(recent.messages[0].position, 9950);
  assert.equal(recent.messages.at(-1).position, 9999);
  assert.equal(recent.nextCursor, 9950);
  const older = (await req(`/chats/${chat}?before=${recent.nextCursor}`)).data;
  assert.equal(older.messages[0].position, 9900);
  assert.equal(older.messages.at(-1).position, 9949);
  assert.equal(older.nextCursor, 9900);
  const first = (await req(`/chats/${chat}?before=50`)).data;
  assert.equal(first.messages.length, 50);
  assert.equal(first.nextCursor, null);
  assert.equal((await req(`/chats/${chat}?before=invalid`)).status, 400);
  assert.equal(
    (await req(`/chats/${chat}?before=50`, "GET", undefined, other)).status,
    404,
  );
  const outline = (await req(`/chats/${chat}/outline`)).data;
  assert.equal(outline.roles, "ua".repeat(5000));
  assert.equal(outline.revision, recent.revision);
  assert.equal(JSON.stringify(outline).includes("Message"), false);
  const middle = (await req(`/chats/${chat}/history?start=4000&end=4100`)).data;
  assert.equal(middle.messages.length, 100);
  assert.equal(middle.messages[0].position, 4000);
  assert.equal(middle.messages.at(-1).position, 4099);
  assert.equal(
    (await req(`/chats/${chat}/history?start=0&end=161`)).status,
    400,
  );
  assert.equal(
    (await req(`/chats/${chat}/history?start=50&end=10`)).status,
    400,
  );
  assert.equal(
    (await req(`/chats/${chat}/outline`, "GET", undefined, other)).status,
    404,
  );
  assert.equal(
    (
      await req(
        `/chats/${chat}/history?start=0&end=100`,
        "GET",
        undefined,
        other,
      )
    ).status,
    404,
  );
  await runtime.store.all("VACUUM ANALYZE chat_messages");
  const outlinePlan = await runtime.store.all(
    "EXPLAIN (ANALYZE, FORMAT JSON) SELECT string_agg(role,'' ORDER BY position) FROM chat_messages WHERE chat_id=?",
    chat,
  );
  const outlineSerialized = JSON.stringify(outlinePlan);
  assert.ok(outlineSerialized.includes("chat_messages_outline"));
  assert.ok(outlineSerialized.includes("Index Only Scan"));
  await runtime.store.run("ANALYZE chat_messages");
  const plan = await runtime.store.all(
    "EXPLAIN (ANALYZE, FORMAT JSON) SELECT position,payload FROM chat_messages WHERE chat_id=? AND position<? ORDER BY position DESC LIMIT 51",
    chat,
    9950,
  );
  const serialized = JSON.stringify(plan);
  assert.ok(
    serialized.includes("chat_messages_pkey") ||
      serialized.includes("chat_messages_outline"),
  );
  assert.equal(serialized.includes("Seq Scan"), false);
  const abort = new AbortController();
  const stream = await fetch(base + `/api/chats/${chat}/events`, {
    headers: { Cookie: cookie },
    signal: abort.signal,
  });
  const reader = stream.body!.getReader();
  try {
    const frame = new TextDecoder().decode((await reader.read()).value);
    const snapshot = JSON.parse(frame.split("data: ")[1].split("\n")[0]);
    assert.equal(snapshot.messages.length, 50);
    assert.equal(snapshot.nextCursor, 9950);
    assert.ok(frame.length < JSON.stringify(messages).length / 50);
  } finally {
    abort.abort();
    await reader.cancel().catch(() => {});
  }
  const branch = (
    await req(`/chats/${chat}/branch`, "POST", { messageIndex: 9951 })
  ).data;
  assert.equal((await state(branch.id)).messageCount, 9952);
  assert.equal(
    (await state(branch.id)).messages.at(-1).content,
    "Message 9951",
  );
  await runtime.store.run(
    "UPDATE chats SET messages=? WHERE id=?",
    JSON.stringify(messages.slice(0, 2)),
    chat,
  );
  assert.equal((await state(chat)).messageCount, 2);
  assert.equal((await state(chat)).nextCursor, null);
});

test("inline references preserve the request and constrain evidence to attached documents", async () => {
  hold = false;
  const form = new FormData();
  form.append(
    "file",
    new Blob(["# Process\nThe process follows a different review policy."]),
    "alternative.md",
  );
  const otherDocument = (await req("/documents", "POST", form)).data.id;
  await runJobs(runtime);
  const chat = await newChat();
  const content = `How is the process reviewed in [notes.md](/library/documents/${documentId})?`;
  assert.equal((await enqueue(chat, content)).status, 202);
  const saved = await waitFor(
    () => state(chat),
    (snapshot) => snapshot.messages.length === 2,
  );
  assert.equal(saved.messages[0].content, content);
  assert.deepEqual(saved.messages[0].attachments, [
    { id: documentId, name: "notes.md" },
  ]);
  const question = calls
    .at(-1)!
    .body.input.findLast((item: any) => item.role === "user");
  const prompt = JSON.parse(question.content[0].text);
  assert.equal(prompt.question, content);
  assert.deepEqual(prompt.attachedDocuments, [
    { id: documentId, name: "notes.md" },
  ]);
  assert.ok(saved.messages[1].sources.length > 0);
  assert.ok(
    saved.messages[1].sources.every(
      (source: any) =>
        source.documentId === documentId && source.documentId !== otherDocument,
    ),
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
