import type { ChatTurn } from "../../shared/chat";
import type { Message } from "./api";

export type ChatSnapshot = {
  id: string;
  title: string;
  messages: Message[];
  turns?: ChatTurn[];
  blocked: boolean;
  nextCursor?: number | null;
  messageCount?: number;
  revision?: string;
};

export type ChatOutline = {
  id: string;
  roles: string;
  messageCount: number;
  revision?: string;
  blocked: boolean;
};

export type ChatHistory = {
  chatId: string | null;
  messages: Message[];
  nextCursor: number | null;
  messageCount: number;
  loading: boolean;
  revision?: string;
  roles?: string;
  cacheCenter?: number;
};

export const chatCacheLimit = 400;
const fingerprints = new WeakMap<Message, string>();
function fingerprint(message: Message) {
  let value = fingerprints.get(message);
  if (value === undefined) {
    value = JSON.stringify(message);
    fingerprints.set(message, value);
  }
  return value;
}
function reuseMessages(current: Message[], next: Message[]) {
  const previous = new Map(
    current.map((message, index) => [message.position ?? index, message]),
  );
  const shared = next.map((message, index) => {
    const old = previous.get(message.position ?? index);
    return old && fingerprint(old) === fingerprint(message) ? old : message;
  });
  return shared.length === current.length &&
    shared.every((message, index) => message === current[index])
    ? current
    : shared;
}
function boundCache(messages: Message[], count: number, center: number) {
  if (messages.length <= chatCacheLimit) return messages;
  const recent = messages.filter(
    (message) => (message.position ?? 0) >= count - 50,
  );
  const nearby = messages
    .filter((message) => (message.position ?? 0) < count - 50)
    .sort(
      (a, b) =>
        Math.abs((a.position ?? 0) - center) -
        Math.abs((b.position ?? 0) - center),
    )
    .slice(0, chatCacheLimit - recent.length);
  return [...nearby, ...recent].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
}

export function emptyChatHistory(chatId: string | null): ChatHistory {
  return {
    chatId,
    messages: [],
    nextCursor: null,
    messageCount: 0,
    loading: !!chatId,
  };
}

export function mergeChatSnapshot(
  current: ChatHistory,
  snapshot: ChatSnapshot,
): ChatHistory {
  const first = snapshot.messages[0]?.position;
  const messageCount = snapshot.messageCount ?? snapshot.messages.length;
  const prefix =
    !snapshot.blocked &&
    current.chatId === snapshot.id &&
    first !== undefined &&
    (current.roles !== undefined ||
      (current.messages.at(-1)?.position ?? -1) >= first - 1)
      ? current.messages.filter(
          (message) =>
            message.position !== undefined &&
            message.position < first &&
            message.position < messageCount,
        )
      : [];
  const messages = reuseMessages(
    current.messages,
    snapshot.blocked
      ? []
      : current.roles !== undefined
        ? boundCache(
            [...prefix, ...snapshot.messages],
            messageCount,
            current.cacheCenter ?? messageCount,
          )
        : [...prefix, ...snapshot.messages],
  );
  let roles =
    !snapshot.blocked && current.chatId === snapshot.id
      ? current.roles
      : undefined;
  if (roles !== undefined) {
    if (first !== undefined && first > roles.length) roles = undefined;
    else {
      roles =
        roles.slice(0, first ?? messageCount) +
        snapshot.messages
          .map((message) =>
            message.role === "user"
              ? "u"
              : message.role === "assistant"
                ? "a"
                : "s",
          )
          .join("");
      if (roles.length !== messageCount) roles = undefined;
    }
  }
  const nextCursor = snapshot.blocked
    ? null
    : prefix.length
      ? current.nextCursor
      : (snapshot.nextCursor ?? null);
  if (
    current.chatId === snapshot.id &&
    !current.loading &&
    messages === current.messages &&
    nextCursor === current.nextCursor &&
    messageCount === current.messageCount &&
    roles === current.roles &&
    snapshot.revision === current.revision
  )
    return current;
  return {
    chatId: snapshot.id,
    messages,
    nextCursor,
    messageCount: snapshot.blocked ? 0 : messageCount,
    loading: false,
    revision: snapshot.revision,
    cacheCenter: current.cacheCenter,
    roles,
  };
}

export function mergeChatOutline(
  current: ChatHistory,
  outline: ChatOutline,
): ChatHistory {
  if (current.chatId !== outline.id || current.loading) return current;
  if (outline.blocked)
    return { ...emptyChatHistory(outline.id), loading: false };
  if (
    outline.messageCount !== current.messageCount ||
    outline.roles.length !== current.messageCount ||
    (current.revision && outline.revision !== current.revision)
  )
    return current;
  return outline.roles === current.roles
    ? current
    : { ...current, roles: outline.roles };
}

export function mergeChatRange(
  current: ChatHistory,
  page: ChatSnapshot,
  center: number,
): ChatHistory {
  if (current.chatId !== page.id || current.loading) return current;
  if (page.blocked) return mergeChatSnapshot(current, page);
  if (
    page.messageCount !== current.messageCount ||
    (current.revision && page.revision !== current.revision)
  )
    return current;
  const merged = new Map(
    current.messages.map((message) => [message.position, message]),
  );
  for (const message of page.messages)
    if (
      message.position !== undefined &&
      message.position < current.messageCount
    )
      merged.set(message.position, message);
  const bounded = boundCache(
    [...merged.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    current.messageCount,
    center,
  );
  return { ...current, messages: reuseMessages(current.messages, bounded) };
}

export function prependChatPage(
  current: ChatHistory,
  page: ChatSnapshot,
): ChatHistory {
  if (current.chatId !== page.id || current.loading) return current;
  if (page.blocked) return mergeChatSnapshot(current, page);
  const first = current.messages[0]?.position ?? current.messageCount;
  if ((page.messages.at(-1)?.position ?? -1) < first - 1) return current;
  return {
    ...current,
    messages: reuseMessages(current.messages, [
      ...page.messages.filter(
        (message) => message.position !== undefined && message.position < first,
      ),
      ...current.messages,
    ]),
    nextCursor: page.nextCursor ?? null,
  };
}

export function chatMessageId(message: Message, index: number) {
  return `${message.role === "user" ? (message.position ?? index) : (message.turnId ?? message.position ?? index)}-${message.role}`;
}
