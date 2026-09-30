import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatMessageId,
  emptyChatHistory,
  mergeChatSnapshot,
  mergeChatOutline,
  mergeChatRange,
  chatCacheLimit,
  prependChatPage,
  type ChatSnapshot,
} from "../src/lib/chat-history";

function page(
  start: number,
  end: number,
  count = end,
  id = "chat",
): ChatSnapshot {
  return {
    id,
    title: "Conversation",
    blocked: false,
    messageCount: count,
    nextCursor: start || null,
    messages: Array.from({ length: end - start }, (_, index) => ({
      position: start + index,
      role: (start + index) % 2 ? "assistant" : "user",
      content: `Message ${start + index}`,
    })),
  };
}

test("recent snapshots retain loaded history and replace regenerated messages", () => {
  let history = mergeChatSnapshot(emptyChatHistory("chat"), page(100, 150));
  history = prependChatPage(history, page(50, 100, 150));
  const next = page(102, 152);
  next.messages.at(-1)!.content = "Updated answer";
  history = mergeChatSnapshot(history, next);
  assert.equal(history.messages.length, 102);
  assert.equal(history.messages[0].position, 50);
  assert.equal(history.messages.at(-1)?.content, "Updated answer");
  assert.equal(history.nextCursor, 50);
  history = prependChatPage(history, page(0, 50, 152));
  assert.equal(history.messages.length, 152);
  assert.equal(history.nextCursor, null);
  assert.equal(
    new Set(history.messages.map((message) => message.position)).size,
    152,
  );
});

test("late pages cannot populate another chat and blocked snapshots clear loaded history", () => {
  let history = mergeChatSnapshot(emptyChatHistory("chat"), page(100, 150));
  assert.equal(prependChatPage(history, page(50, 100, 150, "other")), history);
  history = mergeChatSnapshot(history, { ...page(0, 0), blocked: true });
  assert.deepEqual(history.messages, []);
  assert.equal(history.nextCursor, null);
});

test("reconnecting after many turns resets to contiguous recent history", () => {
  const history = mergeChatSnapshot(emptyChatHistory("chat"), page(100, 150));
  const refreshed = mergeChatSnapshot(history, page(200, 250));
  assert.equal(refreshed.messages.length, 50);
  assert.equal(refreshed.messages[0].position, 200);
  assert.equal(refreshed.nextCursor, 200);
  assert.equal(prependChatPage(refreshed, page(50, 100, 250)), refreshed);
});

test("message keys remain stable when history is prepended and a streamed turn finishes", () => {
  assert.equal(
    chatMessageId({ position: 100, role: "user", content: "Question" }, 0),
    chatMessageId({ position: 100, role: "user", content: "Question" }, 50),
  );
  assert.equal(
    chatMessageId({ role: "assistant", turnId: "turn", content: "Partial" }, 1),
    chatMessageId(
      { position: 101, role: "assistant", turnId: "turn", content: "Complete" },
      51,
    ),
  );
});

test("unchanged snapshots share completed rows and the history array", () => {
  const snapshot = page(9950, 10000);
  const history = mergeChatSnapshot(emptyChatHistory("chat"), snapshot);
  const next = mergeChatSnapshot(history, structuredClone(snapshot));
  assert.equal(next, history);
  const changed = structuredClone(snapshot);
  changed.messages.at(-1)!.content = "Replacement";
  const updated = mergeChatSnapshot(history, changed);
  assert.equal(updated.messages[0], history.messages[0]);
  assert.notEqual(updated.messages.at(-1), history.messages.at(-1));
});

test("outlines and sparse windows reject stale revisions and cap cached text", () => {
  let history = mergeChatSnapshot(emptyChatHistory("chat"), {
    ...page(9950, 10000),
    revision: "current",
  });
  const outline = {
    id: "chat",
    roles: "ua".repeat(5000),
    messageCount: 10000,
    revision: "current",
    blocked: false,
  };
  assert.equal(
    mergeChatOutline(history, { ...outline, revision: "old" }),
    history,
  );
  history = mergeChatOutline(history, outline);
  assert.equal(history.roles?.length, 10000);
  assert.equal(
    mergeChatRange(history, { ...page(0, 100, 10000), revision: "old" }, 50),
    history,
  );
  for (let start = 0; start < 1000; start += 100)
    history = mergeChatRange(
      history,
      { ...page(start, start + 100, 10000), revision: "current" },
      start + 50,
    );
  assert.equal(history.messages.length, chatCacheLimit);
  assert.ok(history.messages.some((message) => message.position === 950));
  assert.ok(history.messages.some((message) => message.position === 9999));
  const repeated = mergeChatSnapshot(history, {
    ...page(9950, 10000),
    revision: "current",
  });
  assert.equal(repeated.messages, history.messages);
  const truncated = mergeChatSnapshot(history, {
    ...page(0, 2),
    revision: "next",
  });
  assert.equal(truncated.roles, "ua");
  assert.equal(truncated.messages.length, 2);
  const blocked = mergeChatOutline(history, { ...outline, blocked: true });
  assert.deepEqual(blocked.messages, []);
  assert.equal(blocked.roles, undefined);
});
