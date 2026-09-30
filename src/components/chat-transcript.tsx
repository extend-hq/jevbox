import {
  memo,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Message } from "@/lib/api";
import { chatDebug } from "@/lib/chat-debug";
import { ArrowDown } from "./icons";
import { Button } from "./coss/button";
import { MessageScrollerItem } from "./ui/message-scroller";

const TranscriptMessage = memo(function TranscriptMessage({
  message,
  index,
  renderer,
}: {
  message: Message;
  index: number;
  renderVersion: string;
  renderer: RefObject<(message: Message, index: number) => ReactNode>;
}) {
  return renderer.current(message, index);
});

export function ChatTranscript({
  messages,
  viewportRef,
  roles,
  messageCount,
  onLoadRange,
  renderVersion,
  scrollToEndRef,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  children,
}: {
  messages: Message[];
  roles?: string;
  messageCount: number;
  onLoadRange: (start: number, end: number) => Promise<void>;
  renderVersion: string;
  scrollToEndRef: RefObject<(() => void) | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<void>;
  children: (message: Message, index: number) => ReactNode;
}) {
  const outlined = roles !== undefined;
  const count = outlined
    ? Math.max(messageCount, (messages.at(-1)?.position ?? -1) + 1)
    : messages.length;
  const virtual = count >= 30;
  const header = !outlined && hasOlder ? 1 : 0;
  const latestMessages = useRef(messages);
  latestMessages.current = messages;
  const renderer = useRef(children);
  renderer.current = children;
  const roleMap = useRef(roles);
  roleMap.current = roles;
  const lookup = useMemo(
    () =>
      new Map(
        messages.map((message, index) => [
          message.position ?? index,
          { message, index },
        ]),
      ),
    [messages],
  );
  const firstPosition = messages[0]?.position ?? 0;
  const getItemKey = useCallback(
    (index: number) =>
      index < header
        ? "history"
        : outlined
          ? index
          : (latestMessages.current[index - header]?.position ??
            index - header),
    [outlined, header, firstPosition],
  );
  const virtualizer = useVirtualizer({
    count: count + header,
    getScrollElement: () => viewportRef.current,
    getItemKey,
    initialOffset: () =>
      virtual
        ? Math.max(0, count * 170 - (viewportRef.current?.clientHeight || 800))
        : 0,
    estimateSize: (index) =>
      index < header
        ? 48
        : (
              outlined
                ? roleMap.current?.[index] === "u"
                : latestMessages.current[index - header]?.role === "user"
            )
          ? 100
          : 240,
    overscan: 8,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    paddingStart: 35,
    paddingEnd: 20,
  });
  useLayoutEffect(() => {
    scrollToEndRef.current = () => {
      if (virtual) virtualizer.scrollToEnd();
      else if (viewportRef.current)
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    };
    return () => {
      scrollToEndRef.current = null;
    };
  }, [scrollToEndRef, virtual, virtualizer, viewportRef]);
  const virtualItems = virtualizer.getVirtualItems();
  const firstVisible = virtualItems.find(
    (item) => item.end > (virtualizer.scrollOffset ?? 0),
  );
  const anchor = useRef<{
    position: number;
    start: number;
    offset: number;
  } | null>(null);
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) =>
    item.index < (anchor.current?.position ?? firstVisible?.index ?? 0);
  const pinned = useRef(true);
  const previousOutline = useRef(outlined);
  useLayoutEffect(() => {
    if (outlined && !previousOutline.current && pinned.current)
      virtualizer.scrollToEnd();
    previousOutline.current = outlined;
    const item = virtualizer
      .getVirtualItems()
      .find(
        (item) =>
          item.end > (virtualizer.scrollOffset ?? 0) &&
          (!outlined || lookup.has(item.index)),
      );
    if (item) {
      const current = {
        position: item.index,
        start: item.start,
        offset: item.start - (virtualizer.scrollOffset ?? 0),
      };
      const prior = anchor.current;
      chatDebug("viewport", {
        total: count,
        cached: messages.length,
        mounted: virtualItems.length,
        visibleStart: firstVisible?.index,
        visibleEnd: virtualItems.at(-1)?.index,
        anchor: current.position,
        anchorOffset: current.offset,
        anchorDrift:
          prior?.position === current.position
            ? current.offset - prior.offset
            : 0,
        scrollTop: virtualizer.scrollOffset,
        totalHeight: virtualizer.getTotalSize(),
        bottomGap: viewportRef.current
          ? viewportRef.current.scrollHeight -
            viewportRef.current.clientHeight -
            viewportRef.current.scrollTop
          : 0,
      });
      anchor.current = current;
    }
  });
  const rangeLoader = useRef(onLoadRange);
  rangeLoader.current = onLoadRange;
  const rangeStart = virtualItems[0]?.index;
  const rangeEnd = virtualItems.at(-1)?.index;
  const lastAttempt = useRef({ start: -1, end: -1, time: 0 });
  useEffect(() => {
    if (
      !outlined ||
      loadingOlder ||
      rangeStart === undefined ||
      rangeEnd === undefined
    )
      return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const actualStart =
      virtualizer.getVirtualItemForOffset(viewport.scrollTop)?.index ??
      rangeStart;
    const actualEnd =
      virtualizer.getVirtualItemForOffset(
        viewport.scrollTop + viewport.clientHeight,
      )?.index ?? rangeEnd;
    let start = Math.max(0, Math.floor(actualStart / 64) * 64 - 32);
    let end = Math.min(
      messageCount,
      Math.max(start + 128, actualEnd + 16),
      start + 160,
    );
    if (end <= start) return;
    while (start < end && lookup.has(start)) start++;
    while (end > start && lookup.has(end - 1)) end--;
    if (end <= start) return;
    const prior = lastAttempt.current;
    if (
      prior.start === start &&
      prior.end === end &&
      performance.now() - prior.time < 2000
    )
      return;
    lastAttempt.current = { start, end, time: performance.now() };
    void rangeLoader.current(start, end);
  }, [outlined, loadingOlder, rangeStart, rangeEnd, messageCount, lookup]);
  const initial = useRef(true);
  useLayoutEffect(() => {
    if (!messages.length || !initial.current) return;
    initial.current = false;
    if (virtual) virtualizer.scrollToEnd();
  }, [messages.length, virtual, virtualizer]);
  const load = useRef(onLoadOlder);
  load.current = onLoadOlder;
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onPosition = () => {
      pinned.current =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <=
        80;
    };
    viewport.addEventListener("scroll", onPosition, { passive: true });
    if (outlined || !hasOlder || loadingOlder)
      return () => viewport.removeEventListener("scroll", onPosition);
    let previous = viewport.scrollTop;
    let scrollingUp = false;
    const onWheel = (event: WheelEvent) => {
      scrollingUp = event.deltaY < 0;
    };
    const onTouch = () => {
      scrollingUp = true;
    };
    const onPointer = () => {
      scrollingUp = true;
    };
    const onKey = (event: KeyboardEvent) => {
      scrollingUp = ["ArrowUp", "PageUp", "Home"].includes(event.key);
    };
    const onScroll = () => {
      const top = viewport.scrollTop;
      if (
        scrollingUp &&
        top < previous &&
        top < Math.max(600, viewport.clientHeight)
      ) {
        scrollingUp = false;
        void load.current();
      }
      previous = top;
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("touchmove", onTouch, { passive: true });
    viewport.addEventListener("pointerdown", onPointer, { passive: true });
    viewport.addEventListener("keydown", onKey);
    return () => {
      viewport.removeEventListener("scroll", onPosition);
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchmove", onTouch);
      viewport.removeEventListener("pointerdown", onPointer);
      viewport.removeEventListener("keydown", onKey);
    };
  }, [viewportRef, outlined, hasOlder, loadingOlder]);
  const rowAt = (index: number) =>
    outlined
      ? lookup.get(index)
      : { message: messages[index - header], index: index - header };
  const renderRow = (index: number) => {
    if (index < header)
      return (
        <MessageScrollerItem messageId="history" className="chat-load-history">
          <Button
            variant="ghost"
            size="sm"
            loading={loadingOlder}
            disabled={loadingOlder}
            onClick={() => void onLoadOlder()}
          >
            Load earlier messages
          </Button>
        </MessageScrollerItem>
      );
    const row = rowAt(index);
    return row?.message ? (
      <TranscriptMessage
        message={row.message}
        index={row.index}
        renderVersion={renderVersion}
        renderer={renderer}
      />
    ) : null;
  };
  return (
    <div
      className="chat-transcript"
      data-virtualized={virtual || undefined}
      style={
        virtual
          ? { position: "relative", height: virtualizer.getTotalSize() }
          : undefined
      }
    >
      {virtual
        ? virtualItems.map((item) => (
            <div
              key={item.key}
              ref={
                rowAt(item.index)?.message || item.index < header
                  ? virtualizer.measureElement
                  : undefined
              }
              data-index={item.index}
              data-placeholder={
                (!rowAt(item.index)?.message && item.index >= header) ||
                undefined
              }
              className="chat-transcript-row"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height:
                  !rowAt(item.index)?.message && item.index >= header
                    ? item.size
                    : undefined,
                transform: `translateY(${item.start}px)`,
              }}
            >
              {renderRow(item.index)}
            </div>
          ))
        : Array.from({ length: messages.length + header }, (_, index) => (
            <div
              key={getItemKey(index)}
              ref={virtualizer.measureElement}
              data-index={index}
              className="chat-transcript-row"
            >
              {renderRow(index)}
            </div>
          ))}
    </div>
  );
}

export function ChatJumpToLatest({
  viewportRef,
  scrollToEndRef,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  scrollToEndRef: RefObject<(() => void) | null>;
}) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () =>
      setActive(
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 80,
      );
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild)
      observer.observe(viewport.firstElementChild);
    update();
    return () => {
      viewport.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [viewportRef]);
  return active ? (
    <Button
      aria-label="Jump to latest"
      variant="outline"
      size="icon-sm"
      className="absolute bottom-4 inset-s-1/2 -translate-x-1/2 z-10"
      onClick={() => scrollToEndRef.current?.()}
    >
      <ArrowDown className="size-4" />
    </Button>
  ) : null;
}
