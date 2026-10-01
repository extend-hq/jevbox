import { ChatMessagePresentation } from "./chat-message-presentation";
import { ChatThinking } from "./loading-state";
import { ChatRegenerateMenu } from "./chat-regenerate-menu";
import { ChatQueue } from "./chat-queue";
import { JevboxIcon } from "./jevbox-icon";
import type { ChatTurn } from "../../shared/chat";
import { Collapsible } from "@base-ui/react/collapsible";
import { ShapeTriangle } from "./icons";
import {
  ChatPromptEditor,
  type ChatPromptEditorHandle,
} from "./chat-prompt-editor";
import { promptLimit } from "@/lib/chat-editor";
import {
  chatMessageId,
  emptyChatHistory,
  mergeChatSnapshot,
  mergeChatOutline,
  mergeChatRange,
  type ChatOutline,
  prependChatPage,
  type ChatSnapshot,
} from "@/lib/chat-history";
import { chatDebug } from "@/lib/chat-debug";
import { ChatTranscript, ChatJumpToLatest } from "./chat-transcript";
import {
  Message as ChatMessage,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "./ui/message";
import { Bubble, BubbleContent } from "./ui/bubble";
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
  AttachmentGroup,
} from "./ui/attachment";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
} from "./ui/message-scroller";
import { ResourceThumbnail } from "./resource-thumbnail";
import { RetrievalTree } from "./retrieval-tree";
import { DocumentView } from "./document";
import { PanelRight, X, Copy, Check, Square } from "./icons";
import { ProviderLogo } from "./provider-logo";
import { RouteLink } from "./route-link";
import { paths } from "@/lib/navigation";
import { ScrollArea } from "@/components/coss/scroll-area";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  FileText,
  IndexTreeIcon,
  BranchOut,
  LockKeyhole,
  Plus,
  Search,
  Send,
  Trash2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/coss/input";
import { Form } from "@/components/coss/form";
import { Field, FieldLabel, FieldError } from "@/components/coss/field";
import { validateLength, validateRequiredText } from "@/lib/form-validation";
import {
  ChatComposerTools,
  ChatAttachments,
  type ChatComposerToolsHandle,
} from "./chat-composer-tools";
import { CursorTooltip } from "./cursor-tooltip";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "./ui/resizable";
import {
  api,
  type Me,
  type Message,
  type Source,
  type Resource,
} from "@/lib/api";
import { Loading, Markdown, plainTextPreview, useAction } from "./common";
export function Sources({
  sources,
  onOpen,
  onPreview,
}: {
  sources: Source[];
  onOpen: (id: string, node?: string) => void;
  onPreview?: (source: Source) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="sources-group"
    >
      <Collapsible.Trigger className="retrieval-trigger sources-trigger">
        <ShapeTriangle
          size={10}
          className="disclosure-triangle"
          data-open={open || undefined}
        />
        <span className="chat-source-stack" aria-hidden="true">
          {[
            ...new Map(
              sources.map((source) => [source.documentId, source]),
            ).values(),
          ]
            .slice(0, 3)
            .map((source) => (
              <ResourceThumbnail
                key={source.documentId}
                name={source.name}
                mime=""
                src={`/api/documents/${source.documentId}/content`}
                className="chat-source-avatar"
                square
              />
            ))}
        </span>
        <span className="chat-source-count">Sources {sources.length}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="retrieval-tree-panel">
        <ScrollArea
          className="h-auto max-h-32"
          orientation="vertical"
          scrollFade
        >
          <div className="source-cards">
            {sources.map((source, i) => (
              <Attachment
                key={`${source.documentId}-${source.nodeId}-${i}`}
                className="source-card"
                size="sm"
              >
                <AttachmentMedia
                  variant="image"
                  className="source-card-thumbnail"
                >
                  <ResourceThumbnail
                    name={source.name}
                    mime=""
                    src={`/api/documents/${source.documentId}/content`}
                    className="w-8 rounded-sm"
                    square
                  />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{source.name}</AttachmentTitle>
                  <AttachmentDescription>
                    [{i + 1}] {source.title} · p. {source.page}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentTrigger
                  aria-label={`Preview source ${i + 1}: ${source.name}`}
                  onClick={() =>
                    onPreview
                      ? onPreview(source)
                      : onOpen(source.documentId, source.nodeId)
                  }
                />
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Preview ${source.name} in sidebar`}
                    title="Preview in sidebar"
                    onClick={() =>
                      onPreview
                        ? onPreview(source)
                        : onOpen(source.documentId, source.nodeId)
                    }
                  >
                    <PanelRight size={15} />
                  </AttachmentAction>
                  <AttachmentAction
                    aria-label={`Open ${source.name} in new tab`}
                    title="Open in new tab"
                    render={
                      <a
                        href={paths.document(
                          source.documentId,
                          source.nodeId,
                          "parsed",
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    <ArrowUpRight size={15} />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </div>
        </ScrollArea>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
function CopyMessage({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "Copied answer" : "Copy answer"}
      onClick={() => {
        void navigator.clipboard
          .writeText(content)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  );
}
export function SearchView({
  me,
  onOpen,
  initialQuery = "",
  onSearch,
}: {
  me: Me;
  initialQuery?: string;
  onSearch: (query: string) => void;
  onOpen: (id: string, node?: string) => void;
}) {
  const [result, setResult] = useState<any>(null);
  const [query, setQuery] = useState(initialQuery);
  const action = useAction();
  useEffect(() => {
    if (initialQuery)
      void action.run(async () =>
        setResult(
          await api("/search", {
            method: "POST",
            body: JSON.stringify({ query: initialQuery }),
          }),
        ),
      );
  }, [initialQuery]);
  useEffect(() => {
    const clear = () => setResult(null);
    window.addEventListener("blur", clear);
    const timer = setInterval(clear, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return (
    <div className="search-page">
      <h1>Search results</h1>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          if (action.busy) return;
          if (query !== initialQuery) {
            onSearch(query);
            return;
          }
          setResult(null);
          void action.run(async () =>
            setResult(
              await api("/search", {
                method: "POST",
                body: JSON.stringify({ query }),
              }),
            ),
          );
        }}
      >
        <Field
          name="query"
          validate={(value) =>
            validateRequiredText(value, "a search query", 2000)
          }
        >
          <FieldLabel className="sr-only">Search your documents</FieldLabel>
          <div className="search-form">
            <Search size={19} />
            <Input
              name="query"
              type="search"
              unstyled
              className="min-w-0 flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What are you looking for?"
              required
              maxLength={2000}
            />
            <Button type="submit" disabled={action.busy || !query.trim()}>
              <ArrowRight size={18} />
              <span className="sr-only">Search</span>
            </Button>
          </div>
          <FieldError />
        </Field>
      </Form>
      {action.busy && <Loading label="Searching documents…" />}
      {action.error && (
        <div className="error" role="alert">
          {action.error}
        </div>
      )}
      {result && (
        <>
          <div className="result-heading">
            <h2>
              {result.results.length} source
              {result.results.length !== 1 ? "s" : ""} found
            </h2>
            <span>Ranked by JEV</span>
          </div>
          {result.results.map((s: Source, i: number) => (
            <button
              className="search-result"
              key={i}
              onClick={() => onOpen(s.documentId, s.nodeId)}
            >
              <ResourceThumbnail
                name={s.name}
                mime=""
                src={`/api/documents/${s.documentId}/content`}
                className="search-result-thumbnail"
                square
              />
              <div className="search-result-content">
                <div className="result-path">
                  {s.name}
                  <span>›</span>Page {s.page}
                </div>
                <h3>
                  {s.title}
                  <ArrowUpRight size={16} />
                </h3>
                <p>
                  {s.content &&
                    plainTextPreview(s.content, s.title).slice(0, 300)}
                </p>
              </div>
            </button>
          ))}
          {!result.results.length && (
            <div className="empty-inline">
              <Search size={25} />
              <h3>No matching sources yet</h3>
              <p>
                Try a more specific question, or check that your documents have
                finished indexing.
              </p>
            </div>
          )}
        </>
      )}
      {!result && !action.busy && (
        <div className="search-empty">
          <IndexTreeIcon size={38} />
          <h3>Search documents</h3>
          <p>Enter a query to search document contents.</p>
        </div>
      )}
    </div>
  );
}
export function ChatView({
  me,
  onOpen,
  onSettings,
  chatId,
  onChatChange,
  onTitleChange,
}: {
  me: Me;
  chatId: string | null;
  onTitleChange: (title: string) => void;
  onChatChange: (id: string | null, replace?: boolean) => void;
  onOpen: (id: string, node?: string) => void;
  onSettings: () => void;
}) {
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  const historyWidth = useRef(232);
  const [initialHistoryWidth] = useState(() => {
    try {
      const width = Number(localStorage.getItem("chat-sidebar-width"));
      return width >= 180 && width <= 420 ? width : 232;
    } catch {
      return 232;
    }
  });
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [attachments, setAttachments] = useState<Resource[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() =>
    me.defaultChatModel?.provider && me.defaultChatModel?.model
      ? `${me.defaultChatModel.provider}:${me.defaultChatModel.model}`
      : "",
  );
  const chosenModel =
    me.chatModels?.find(
      (model) => `${model.provider}:${model.model}` === selectedModel,
    ) ?? me.chatModels?.[0];
  const attachmentPending = attachments.some((a) => a.status !== "ready");
  const [chats, setChats] = useState<any[]>([]);
  const [history, setHistory] = useState(() => emptyChatHistory(chatId));
  const messageViewport = useRef<HTMLDivElement>(null);
  const scrollToEnd = useRef<(() => void) | null>(null);
  const messages = history.chatId === chatId ? history.messages : [];
  const loadingHistory =
    !!chatId && (history.chatId !== chatId || history.loading);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderRequest = useRef<AbortController | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [input, setInput] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const promptEditor = useRef<ChatPromptEditorHandle>(null);
  const composerTools = useRef<ChatComposerToolsHandle>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false);
  const submission = useRef<{ key: string; id: string } | null>(null);
  const [connection, setConnection] = useState<"live" | "reconnecting">("live");
  const activeTurn = loadingHistory
    ? undefined
    : turns.find((t) =>
        ["retrieving", "generating", "cancelling"].includes(t.status),
      );
  const visibleQueue = loadingHistory
    ? []
    : turns.filter(
        (t) => !["retrieving", "generating", "cancelling"].includes(t.status),
      );
  const pending =
    activeTurn && !activeTurn.regenerating ? activeTurn.content : "";
  const action = useAction();
  const [preview, setPreview] = useState<{
    source: Source;
    trace: NonNullable<Message["trace"]>;
    retrievalDurationMs?: number;
    focusRequest?: number;
  } | null>(null);
  const sourceFocusRequest = useRef(0);
  const [previewTab, setPreviewTab] = useState("parsed");
  const previewRetrievalPath = (
    trace: NonNullable<Message["trace"]>,
    documentId: string,
    nodeId?: string,
    onlyIfOpen = false,
    retrievalDurationMs?: number,
  ) => {
    if (onlyIfOpen && !preview) return;
    if (
      preview?.trace === trace &&
      preview.source.documentId === documentId &&
      preview.source.nodeId === (nodeId ?? "") &&
      !preview.source.blockIds?.length
    )
      return;
    const document = trace.find(
      (step) => step.stage === "document" && step.resourceId === documentId,
    );
    const section = nodeId
      ? trace.find(
          (step) => step.resourceId === documentId && step.nodeId === nodeId,
        )
      : undefined;
    setPreview({
      source: {
        documentId,
        nodeId: nodeId ?? "",
        name: document?.label ?? "",
        title: section?.label ?? "",
        page: section?.page ?? 1,
      },
      trace,
      retrievalDurationMs,
    });
    setPreviewTab("index");
  };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const activeChat = useRef(chatId);
  activeChat.current = chatId;
  const createdChat = useRef<string | null>(null);
  const applySnapshot = (chat: ChatSnapshot) => {
    if (!mounted.current || activeChat.current !== chat.id) return;
    setHistory((current) => mergeChatSnapshot(current, chat));
    setTurns(chat.turns ?? []);
    setBlocked(chat.blocked);
    setChats((current) =>
      current.some((c) => c.id === chat.id)
        ? current.map((c) =>
            c.id === chat.id ? { ...c, title: chat.title } : c,
          )
        : [{ id: chat.id, title: chat.title }, ...current],
    );
  };
  const refresh = async () => {
    const items = await api("/chats");
    if (mounted.current) setChats(items);
  };
  const refreshChat = async (id = activeChat.current) => {
    if (id) applySnapshot(await api(`/chats/${id}`));
  };
  const loadOlder = async () => {
    if (
      !chatId ||
      loadingHistory ||
      history.nextCursor === null ||
      olderRequest.current
    )
      return;
    const id = chatId;
    const controller = new AbortController();
    olderRequest.current = controller;
    setLoadingOlder(true);
    try {
      const page = await api<ChatSnapshot>(
        `/chats/${id}?before=${history.nextCursor}`,
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        activeChat.current !== id ||
        !mounted.current
      )
        return;
      if (page.blocked) applySnapshot(page);
      else setHistory((current) => prependChatPage(current, page));
    } catch (error) {
      if (
        !controller.signal.aborted &&
        mounted.current &&
        activeChat.current === id
      )
        action.setError((error as Error).message);
    } finally {
      if (olderRequest.current === controller) {
        olderRequest.current = null;
        if (mounted.current) setLoadingOlder(false);
      }
    }
  };
  const loadRange = async (start: number, end: number) => {
    if (!chatId || loadingHistory || olderRequest.current) return;
    const id = chatId;
    const controller = new AbortController();
    olderRequest.current = controller;
    setLoadingOlder(true);
    const started = performance.now();
    try {
      const page = await api<ChatSnapshot>(
        `/chats/${id}/history?start=${start}&end=${end}`,
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        activeChat.current !== id ||
        !mounted.current
      )
        return;
      if (page.blocked) applySnapshot(page);
      else
        setHistory((current) =>
          mergeChatRange(current, page, (start + end) / 2),
        );
      chatDebug("fetch", {
        start,
        end,
        durationMs: performance.now() - started,
        rows: page.messages.length,
      });
    } catch (error) {
      if (
        !controller.signal.aborted &&
        mounted.current &&
        activeChat.current === id
      )
        action.setError((error as Error).message);
    } finally {
      if (olderRequest.current === controller) {
        olderRequest.current = null;
        if (mounted.current) setLoadingOlder(false);
      }
    }
  };
  useEffect(() => {
    if (
      !chatId ||
      loadingHistory ||
      blocked ||
      history.messageCount < 100 ||
      history.roles !== undefined
    )
      return;
    const controller = new AbortController();
    void api<ChatOutline>(`/chats/${chatId}/outline`, {
      signal: controller.signal,
    })
      .then((outline) => {
        if (controller.signal.aborted || activeChat.current !== chatId) return;
        if (outline.blocked)
          applySnapshot({
            ...outline,
            title: "Sources no longer available",
            messages: [],
          });
        else setHistory((current) => mergeChatOutline(current, outline));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [
    chatId,
    loadingHistory,
    blocked,
    history.messageCount,
    history.revision,
    history.roles,
  ]);
  const updateTurn = async (
    id: string,
    change: { content?: string; action?: "retry" | "up" | "down" },
  ) => {
    await api(`/chats/${chatId}/turns/${id}`, {
      method: "PATCH",
      body: JSON.stringify(change),
    });
    await refreshChat();
  };
  const removeTurn = async (id: string) => {
    await api(`/chats/${chatId}/turns/${id}`, { method: "DELETE" });
    await refreshChat();
  };
  const submit = async () => {
    if (
      sending.current ||
      loadingHistory ||
      !input.trim() ||
      uploading ||
      attachmentPending ||
      blocked ||
      visibleQueue.length >= 10 ||
      !me.chatEnabled
    )
      return;
    const content = input.trim();
    const payload = {
      content,
      documentIds: attachments.map((a) => a.id),
      ...(chosenModel
        ? {
            selectedModel: {
              provider: chosenModel.provider,
              model: chosenModel.model,
            },
          }
        : {}),
    };
    const key = JSON.stringify({ chatId, ...payload });
    if (submission.current?.key !== key)
      submission.current = { key, id: crypto.randomUUID() };
    const requestId = submission.current.id;
    sending.current = true;
    setSubmitting(true);
    action.setError("");
    let current = chatId;
    try {
      if (!current) {
        const chat = await api<{ id: string }>("/chats", { method: "POST" });
        current = chat.id;
        submission.current = {
          key: JSON.stringify({ chatId: current, ...payload }),
          id: requestId,
        };
        if (mounted.current && activeChat.current === null) {
          createdChat.current = current;
          activeChat.current = current;
          onChatChange(current);
        }
      }
      await api(`/chats/${current}/turns`, {
        method: "POST",
        body: JSON.stringify({ id: requestId, ...payload }),
      });
      submission.current = null;
      if (mounted.current && activeChat.current === current)
        setInput((value) => (value.trim() === content ? "" : value));
      await refreshChat(current);
      void refresh().catch(() => {});
    } catch (error) {
      if (mounted.current && activeChat.current === current)
        action.setError(
          error instanceof Error
            ? error.message
            : "Could not send this message.",
        );
    } finally {
      sending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };
  useEffect(() => {
    onTitleChange(
      plainTextPreview(chats.find((chat) => chat.id === chatId)?.title ?? ""),
    );
  }, [chats, chatId, onTitleChange]);
  useEffect(() => {
    void action.run(refresh);
  }, []);
  useEffect(() => {
    let active = true;
    if (createdChat.current !== chatId || !chatId) {
      setHistory(emptyChatHistory(chatId));
      setAttachments([]);
      setInput("");
      setBlocked(false);
      action.setError("");
    }
    createdChat.current = null;
    setTurns([]);
    olderRequest.current?.abort();
    olderRequest.current = null;
    setLoadingOlder(false);
    const controller = new AbortController();
    setConnection("live");
    let stream: EventSource | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      if (!chatId) return;
      try {
        const chat = await api<ChatSnapshot>(`/chats/${chatId}`, {
          signal: controller.signal,
        });
        if (active) applySnapshot(chat);
      } catch (error) {
        if (active) {
          setHistory({ ...emptyChatHistory(chatId), loading: false });
          setTurns([]);
          action.setError((error as Error).message);
        }
      }
    };
    void load().then(() => {
      if (!active || !chatId) return;
      if (typeof EventSource === "undefined") {
        timer = setInterval(() => void load(), 1000);
        return;
      }
      stream = new EventSource(`/api/chats/${chatId}/events`);
      stream.addEventListener("snapshot", (event) => {
        if (!active) return;
        applySnapshot(JSON.parse((event as MessageEvent).data));
        setConnection("live");
      });
      stream.addEventListener("unavailable", (event) => {
        if (!active) return;
        const data = JSON.parse((event as MessageEvent).data);
        setHistory({ ...emptyChatHistory(chatId), loading: false });
        setTurns([]);
        setBlocked(true);
        action.setError(data.error);
        if (data.status === 401)
          window.dispatchEvent(new Event("session-expired"));
        stream?.close();
      });
      stream.onerror = () => {
        if (active) setConnection("reconnecting");
      };
    });
    return () => {
      active = false;
      controller.abort();
      olderRequest.current?.abort();
      stream?.close();
      clearInterval(timer);
    };
  }, [chatId]);
  useEffect(() => {
    setPreview(null);
  }, [chatId, blocked]);
  return (
    <ResizablePanelGroup
      key={compact ? "compact" : "wide"}
      className="chat-layout"
      orientation="horizontal"
      onLayoutChanged={(_layout, meta) => {
        if (!compact && meta.isUserInteraction) {
          try {
            localStorage.setItem(
              "chat-sidebar-width",
              String(Math.round(historyWidth.current)),
            );
          } catch {}
        }
      }}
    >
      <ResizablePanel
        id="chat-history"
        className="chat-history-panel"
        defaultSize={compact ? 48 : initialHistoryWidth}
        minSize={compact ? 48 : 180}
        maxSize={compact ? 48 : 420}
        disabled={compact}
        onResize={(size) => {
          if (!compact) historyWidth.current = size.inPixels;
        }}
      >
        <ScrollArea scrollFade contentProps={{ className: "min-h-full flex" }}>
          <aside className="chat-history">
            <div className="chat-history-heading">
              <span className="chat-list-title">Chats</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="New conversation"
                onClick={() => {
                  onChatChange(null);
                  setHistory(emptyChatHistory(null));
                  setAttachments([]);
                  setBlocked(false);
                  action.setError("");
                }}
              >
                <Plus size={16} />
              </Button>
            </div>
            {chats.map((c) => (
              <div
                className={`chat-history-row ${chatId === c.id ? "active" : ""}`}
                key={c.id}
              >
                <CursorTooltip label={plainTextPreview(c.title)}>
                  <RouteLink
                    href={paths.chat(c.id)}
                    aria-label={plainTextPreview(c.title)}
                  >
                    <span>{plainTextPreview(c.title)}</span>
                  </RouteLink>
                </CursorTooltip>
                <button
                  aria-label="Delete conversation"
                  onClick={() =>
                    void action.run(async () => {
                      await api(`/chats/${c.id}`, { method: "DELETE" });
                      if (activeChat.current === c.id && mounted.current) {
                        onChatChange(null, true);
                        setHistory(emptyChatHistory(null));
                      }
                      await refresh();
                    })
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {!chats.length && (
              <p className="muted text-xs p-4">
                Your conversations will appear here.
              </p>
            )}
          </aside>
        </ScrollArea>
      </ResizablePanel>
      {!compact && (
        <CursorTooltip label="Drag to resize · Arrow keys to adjust">
          <ResizableHandle
            className="chat-resize-handle"
            aria-label="Resize chat sidebar"
          />
        </CursorTooltip>
      )}
      <ResizablePanel
        id="chat-content"
        className="chat-content-panel"
        minSize={compact ? 0 : 280}
      >
        <section
          className={`chat-main ${!chatId && !messages.length && !pending && !visibleQueue.length ? "new-chat" : ""}`}
        >
          <div className="chat-toolbar">
            <span>
              {chatId
                ? plainTextPreview(
                    chats.find((c) => c.id === chatId)?.title ?? "New chat",
                  )
                : "New chat"}
            </span>
            <span>
              <LockKeyhole size={12} /> Only you
            </span>
          </div>
          <MessageScrollerProvider
            key={`${chatId ?? "new"}-${loadingHistory ? "loading" : "ready"}`}
            autoScroll={history.messageCount < 30}
            defaultScrollPosition={loadingHistory ? "start" : "end"}
          >
            <MessageScroller className="chat-scroll-area">
              <MessageScrollerViewport
                ref={messageViewport}
                preserveScrollOnPrepend={false}
              >
                <MessageScrollerContent
                  className={`chat-scroll ${!loadingHistory && chatId ? "chat-transcript-content" : ""}`}
                  aria-busy={loadingHistory || !!activeTurn}
                >
                  {loadingHistory ? null : !chatId &&
                    !messages.length &&
                    !pending &&
                    !visibleQueue.length ? (
                    <MessageScrollerItem
                      messageId="empty"
                      className="chat-empty"
                    >
                      <div className="chat-symbol">
                        <JevboxIcon size={38} />
                      </div>
                      <h1>What would you like to know?</h1>
                      <p>Ask a question or attach documents.</p>
                      {!me.chatEnabled && (
                        <Button
                          variant="outline"
                          className="connect-provider-button"
                          onClick={onSettings}
                        >
                          <span
                            className="provider-logo-stack"
                            aria-hidden="true"
                          >
                            {["openai", "anthropic", "huggingface"].map(
                              (provider) => (
                                <span key={provider}>
                                  <ProviderLogo provider={provider} size={16} />
                                </span>
                              ),
                            )}
                          </span>
                          Connect a chat provider
                          <ArrowRight size={14} />
                        </Button>
                      )}
                    </MessageScrollerItem>
                  ) : (
                    <ChatTranscript
                      key={chatId ?? "new"}
                      viewportRef={messageViewport}
                      scrollToEndRef={scrollToEnd}
                      roles={history.roles}
                      messageCount={history.messageCount}
                      onLoadRange={loadRange}
                      renderVersion={`${action.busy}-${!!turns.length}-${chosenModel?.provider}-${chosenModel?.model}-${preview?.source.documentId}-${preview?.source.nodeId}-${activeTurn?.status}`}
                      hasOlder={history.nextCursor !== null}
                      loadingOlder={loadingOlder}
                      onLoadOlder={loadOlder}
                      messages={[
                        ...(activeTurn?.regenerating
                          ? messages.slice(0, -1)
                          : messages),
                        ...(pending
                          ? [
                              {
                                role: "user",
                                content: pending,
                                turnId: activeTurn?.id,
                                position: history.messageCount,
                                attachments: activeTurn?.attachments,
                              } as Message,
                            ]
                          : []),
                        ...(activeTurn
                          ? [
                              {
                                role: "assistant",
                                position: activeTurn.regenerating
                                  ? history.messageCount - 1
                                  : history.messageCount + 1,
                                content: activeTurn.partialText,
                                turnId: activeTurn.id,
                                selectedModel:
                                  activeTurn.selectedModel ?? undefined,
                              } as Message,
                            ]
                          : []),
                      ]}
                    >
                      {(message, i) => (
                        <ChatMessagePresentation
                          key={chatMessageId(message, i)}
                          content={message.content}
                          streaming={
                            i >=
                            (activeTurn?.regenerating
                              ? messages.length - 1
                              : messages.length)
                          }
                        >
                          {(text, ready, animate) => (
                            <MessageScrollerItem
                              messageId={chatMessageId(message, i)}
                              scrollAnchor={message.role === "user"}
                            >
                              <ChatMessage
                                align={
                                  message.role === "user" ? "end" : "start"
                                }
                                className="chat-message"
                              >
                                {message.role === "assistant" && (
                                  <MessageAvatar className="self-start">
                                    <JevboxIcon size={18} />
                                  </MessageAvatar>
                                )}
                                <MessageContent>
                                  <Bubble
                                    variant={
                                      message.role === "assistant"
                                        ? "ghost"
                                        : "muted"
                                    }
                                    align={
                                      message.role === "user" ? "end" : "start"
                                    }
                                  >
                                    <BubbleContent
                                      className={
                                        message.role === "user"
                                          ? "user-bubble-content"
                                          : undefined
                                      }
                                    >
                                      {message.role === "assistant" &&
                                        !text &&
                                        activeTurn &&
                                        activeTurn.id === message.turnId && (
                                          <ChatThinking
                                            key={activeTurn.id}
                                            status={activeTurn.status}
                                          />
                                        )}
                                      <Markdown
                                        sources={
                                          message.role === "assistant"
                                            ? message.sources
                                            : undefined
                                        }
                                        onSourcePreview={(source) => {
                                          setPreview({
                                            source,
                                            trace: message.trace ?? [],
                                            retrievalDurationMs:
                                              message.retrievalDurationMs,
                                            focusRequest:
                                              ++sourceFocusRequest.current,
                                          });
                                          setPreviewTab("parsed");
                                        }}
                                        streaming={
                                          message.role === "assistant" &&
                                          !ready &&
                                          Boolean(text)
                                        }
                                        animate={
                                          animate &&
                                          message.role === "assistant"
                                        }
                                      >
                                        {text}
                                      </Markdown>
                                    </BubbleContent>
                                  </Bubble>
                                  {message.attachments?.length ? (
                                    <AttachmentGroup>
                                      {message.attachments.map((attachment) => (
                                        <Attachment
                                          key={attachment.id}
                                          size="sm"
                                        >
                                          <AttachmentMedia>
                                            <FileText size={16} />
                                          </AttachmentMedia>
                                          <AttachmentContent>
                                            <AttachmentTitle>
                                              {attachment.name}
                                            </AttachmentTitle>
                                          </AttachmentContent>
                                          <AttachmentTrigger
                                            aria-label={`Open ${attachment.name}`}
                                            onClick={() =>
                                              onOpen(attachment.id)
                                            }
                                          />
                                        </Attachment>
                                      ))}
                                    </AttachmentGroup>
                                  ) : null}
                                  {message.role === "assistant" && (
                                    <div
                                      className="chat-answer-details"
                                      data-pending={!ready || undefined}
                                      aria-hidden={!ready || undefined}
                                      inert={!ready}
                                    >
                                      <div className="chat-answer-detail-row">
                                        {message.sources?.length ? (
                                          <>
                                            <Sources
                                              sources={message.sources}
                                              onOpen={onOpen}
                                              onPreview={(source) => {
                                                setPreview({
                                                  source,
                                                  trace: message.trace ?? [],
                                                  retrievalDurationMs:
                                                    message.retrievalDurationMs,
                                                  focusRequest:
                                                    ++sourceFocusRequest.current,
                                                });
                                                setPreviewTab("parsed");
                                              }}
                                            />
                                          </>
                                        ) : null}
                                      </div>
                                      <div className="chat-answer-detail-row">
                                        {message.trace?.length ? (
                                          <RetrievalTree
                                            trace={message.trace}
                                            retrievalDurationMs={
                                              message.retrievalDurationMs
                                            }
                                            activeDocumentId={
                                              preview?.source.documentId
                                            }
                                            activeNodeId={
                                              preview?.source.nodeId
                                            }
                                            onSelect={(documentId, nodeId) =>
                                              previewRetrievalPath(
                                                message.trace ?? [],
                                                documentId,
                                                nodeId,
                                                false,
                                                message.retrievalDurationMs,
                                              )
                                            }
                                            onPreview={(documentId, nodeId) =>
                                              previewRetrievalPath(
                                                message.trace ?? [],
                                                documentId,
                                                nodeId,
                                                true,
                                                message.retrievalDurationMs,
                                              )
                                            }
                                          />
                                        ) : null}
                                      </div>
                                    </div>
                                  )}
                                  <MessageFooter
                                    className="chat-message-actions"
                                    data-pending={!ready || undefined}
                                    aria-hidden={!ready || undefined}
                                    inert={!ready}
                                  >
                                    <CopyMessage content={message.content} />
                                    <Tooltip>
                                      <TooltipTrigger asChild delay={450}>
                                        <Button
                                          variant="ghost"
                                          size="icon-xs"
                                          aria-label="Branch into a new chat"
                                          disabled={action.busy}
                                          onClick={() =>
                                            void action.run(async () => {
                                              const branch = await api<{
                                                id: string;
                                              }>(`/chats/${chatId}/branch`, {
                                                method: "POST",
                                                body: JSON.stringify({
                                                  messageIndex:
                                                    message.position ?? i,
                                                }),
                                              });
                                              onChatChange(branch.id);
                                              await refresh();
                                            })
                                          }
                                        >
                                          <BranchOut size={14} />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipPopup
                                        side="top"
                                        align="center"
                                        className="pointer-events-none max-w-72"
                                      >
                                        Branch into a new chat
                                      </TooltipPopup>
                                    </Tooltip>
                                    {message.role === "assistant" &&
                                      i === messages.length - 1 &&
                                      !turns.length && (
                                        <ChatRegenerateMenu
                                          models={me.chatModels ?? []}
                                          currentModel={
                                            message.selectedModel ?? chosenModel
                                          }
                                          disabled={
                                            action.busy || !me.chatEnabled
                                          }
                                          onRegenerate={(model) =>
                                            void action.run(async () => {
                                              await api(
                                                `/chats/${chatId}/regenerate`,
                                                {
                                                  method: "POST",
                                                  body: JSON.stringify({
                                                    id: crypto.randomUUID(),
                                                    selectedModel: model,
                                                  }),
                                                },
                                              );
                                              await refreshChat();
                                            })
                                          }
                                        />
                                      )}
                                    {message.role === "assistant" &&
                                      message.selectedModel && (
                                        <span className="chat-answer-model">
                                          {message.selectedModel.model}
                                        </span>
                                      )}
                                  </MessageFooter>
                                </MessageContent>
                              </ChatMessage>
                            </MessageScrollerItem>
                          )}
                        </ChatMessagePresentation>
                      )}
                    </ChatTranscript>
                  )}
                  {blocked && (
                    <MessageScrollerItem messageId="blocked" className="notice">
                      Access to one or more sources has changed. This
                      conversation is hidden. Start a new conversation to
                      continue.
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <ChatJumpToLatest
                key={`${chatId}-${loadingHistory}`}
                viewportRef={messageViewport}
                scrollToEndRef={scrollToEnd}
              />
            </MessageScroller>
          </MessageScrollerProvider>
          <div className="chat-compose">
            <ChatQueue
              turns={visibleQueue}
              busy={action.busy}
              onUpdate={updateTurn}
              onReorder={async (id, overId) => {
                try {
                  await api(`/chats/${chatId}/turns/reorder`, {
                    method: "POST",
                    body: JSON.stringify({ id, overId }),
                  });
                } finally {
                  await refreshChat();
                }
              }}
              onRemove={removeTurn}
            />
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <ChatAttachments
                attachments={attachments}
                onRemove={(id) =>
                  setAttachments((current) =>
                    current.filter((a) => a.id !== id),
                  )
                }
                disabled={uploading}
              />
              <ChatPromptEditor
                ref={promptEditor}
                onMentionChange={setMentionQuery}
                onMentionKeyDown={(event) =>
                  composerTools.current?.handleMentionKey(event) ?? false
                }
                value={input}
                onChange={setInput}
                disabled={loadingHistory || blocked || !me.chatEnabled}
                placeholder={
                  me.chatEnabled
                    ? activeTurn
                      ? "Add a follow-up to the queue…"
                      : "Ask a question about your documents…"
                    : "Connect a provider to start chatting"
                }
              />
              <div className="composer-tools">
                <ChatComposerTools
                  ref={composerTools}
                  mentionQuery={mentionQuery}
                  onMentionClose={() => promptEditor.current?.dismissMention()}
                  onMentionAttach={() =>
                    promptEditor.current?.completeMention()
                  }
                  me={me}
                  attachments={attachments}
                  setAttachments={setAttachments}
                  selectedModel={
                    chosenModel
                      ? `${chosenModel.provider}:${chosenModel.model}`
                      : ""
                  }
                  onModelChange={setSelectedModel}
                  onSettings={onSettings}
                  disabled={loadingHistory || blocked}
                  onBusyChange={setUploading}
                />
                {activeTurn && (
                  <CursorTooltip label="Stop answer">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="chat-stop"
                      aria-label="Stop answer"
                      loading={activeTurn.status === "cancelling"}
                      onClick={() =>
                        void action.run(() => removeTurn(activeTurn.id))
                      }
                    >
                      <Square size={14} />
                    </Button>
                  </CursorTooltip>
                )}
                <Button
                  type="submit"
                  aria-label={activeTurn ? "Queue message" : "Send message"}
                  loading={submitting}
                  disabled={
                    !input.trim() ||
                    loadingHistory ||
                    input.length > promptLimit ||
                    uploading ||
                    attachmentPending ||
                    blocked ||
                    visibleQueue.length >= 10 ||
                    !me.chatEnabled
                  }
                >
                  <ArrowUp size={18} />
                </Button>
              </div>
            </Form>
            {connection === "reconnecting" && chatId && (
              <p className="chat-connection" role="status">
                Reconnecting to your conversation…
              </p>
            )}
            {action.error && (
              <div className="error" role="alert">
                {action.error}
              </div>
            )}
          </div>
        </section>
      </ResizablePanel>
      {preview && !blocked && (
        <>
          <ResizableHandle aria-label="Resize source preview" />
          <ResizablePanel
            id="chat-source-preview"
            defaultSize="40%"
            minSize={compact ? 0 : 350}
            className={`chat-source-panel ${compact ? "compact" : ""}`}
          >
            <div className="source-preview-heading">
              <div className="source-preview-title">
                <ResourceThumbnail
                  name={
                    preview.source.name ||
                    preview.trace.find(
                      (step) =>
                        step.stage === "document" &&
                        step.resourceId === preview.source.documentId,
                    )?.label ||
                    "Document"
                  }
                  mime=""
                  src={`/api/documents/${preview.source.documentId}/content`}
                  className="w-6 rounded-sm"
                  square
                />
                <span>
                  {preview.source.name ||
                    preview.trace.find(
                      (step) =>
                        step.stage === "document" &&
                        step.resourceId === preview.source.documentId,
                    )?.label ||
                    "Document"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <CursorTooltip label="Open full document">
                  <a
                    href={paths.document(
                      preview.source.documentId,
                      preview.source.nodeId || undefined,
                      "index",
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="source-open-full"
                    aria-label="Open full document"
                  >
                    <ArrowUpRight size={16} />
                  </a>
                </CursorTooltip>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close source preview"
                  onClick={() => setPreview(null)}
                >
                  <X size={16} />
                </Button>
              </div>
            </div>
            <div className="source-preview-retrieval">
              <RetrievalTree
                trace={preview.trace}
                retrievalDurationMs={preview.retrievalDurationMs}
                activeDocumentId={preview.source.documentId}
                activeNodeId={preview.source.nodeId}
                defaultOpen
                onSelect={(documentId, nodeId) =>
                  previewRetrievalPath(
                    preview.trace,
                    documentId,
                    nodeId,
                    false,
                    preview.retrievalDurationMs,
                  )
                }
                onPreview={(documentId, nodeId) =>
                  previewRetrievalPath(
                    preview.trace,
                    documentId,
                    nodeId,
                    true,
                    preview.retrievalDurationMs,
                  )
                }
              />
            </div>
            <div className="source-preview-document">
              <DocumentView
                documentId={preview.source.documentId}
                initialNode={preview.source.nodeId}
                initialTab={previewTab}
                focusBlockIds={preview.source.blockIds}
                focusPage={preview.source.page}
                focusRequest={preview.focusRequest}
                embedded
                onBack={() => setPreview(null)}
                onShare={() => {}}
                onChange={() => {}}
                onNavigate={(nodeId, tab) => {
                  setPreviewTab(tab);
                  setPreview({
                    ...preview,
                    source: {
                      ...preview.source,
                      nodeId: nodeId ?? preview.source.nodeId,
                      blockIds:
                        nodeId === preview.source.nodeId
                          ? preview.source.blockIds
                          : undefined,
                    },
                  });
                }}
              />
            </div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
