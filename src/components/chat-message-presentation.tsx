import { useEffect, useRef, useState, type ReactNode } from "react";

export function ChatMessagePresentation({
  content,
  streaming,
  children,
}: {
  content: string;
  streaming: boolean;
  children: (text: string, ready: boolean, animate: boolean) => ReactNode;
}) {
  const animate = useRef(streaming).current;
  const [text, setText] = useState(content);
  const shown = useRef(content);
  const target = useRef(content);
  target.current = content;
  useEffect(() => {
    if (
      !animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !content.startsWith(shown.current)
    ) {
      shown.current = content;
      setText(content);
      return;
    }
    let frame = 0;
    let previous: number | null = null;
    let credit = 0;
    let committed = 0;
    const tick = (now: number) => {
      const remaining = target.current.length - shown.current.length;
      const elapsed =
        previous === null ? 16 : Math.max(0, Math.min(now - previous, 32));
      credit += elapsed * Math.max(0.12, remaining / 120);
      previous = now;
      const count = Math.floor(credit);
      if (count > 0 && now - committed >= 50) {
        committed = now;
        credit -= count;
        let end = Math.min(target.current.length, shown.current.length + count);
        if (
          end < target.current.length &&
          /[\uD800-\uDBFF]/.test(target.current[end - 1])
        )
          end++;
        shown.current = target.current.slice(0, end);
        setText(shown.current);
      }
      if (shown.current !== target.current) frame = requestAnimationFrame(tick);
    };
    if (shown.current !== content) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [content, animate]);
  return children(
    animate ? text : content,
    !streaming && (!animate || text === content),
    animate,
  );
}

type TreeNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: TreeNode[];
  properties?: Record<string, unknown>;
};

export function inlineCitations(count: number) {
  return () => (tree: TreeNode) => {
    const visit = (node: TreeNode) => {
      if (!node.children || ["pre", "code", "a"].includes(node.tagName ?? ""))
        return;
      node.children = node.children.flatMap((child): TreeNode[] => {
        if (child.type !== "text" || !child.value) {
          visit(child);
          return [child];
        }
        const parts: TreeNode[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(/\[(\d+)\]/g)) {
          const number = Number(match[1]);
          if (number < 1 || number > count) continue;
          if (match.index > offset)
            parts.push({
              type: "text",
              value: child.value.slice(offset, match.index),
            });
          parts.push({
            type: "element",
            tagName: "a",
            properties: { href: `#chat-source-${number}` },
            children: [{ type: "text", value: match[0] }],
          });
          offset = match.index + match[0].length;
        }
        if (!parts.length) return [child];
        if (offset < child.value.length)
          parts.push({ type: "text", value: child.value.slice(offset) });
        return parts;
      });
    };
    visit(tree);
  };
}

export function revealMarkdown() {
  return (tree: TreeNode) => {
    const visit = (node: TreeNode) => {
      if (!node.children || node.tagName === "pre" || node.tagName === "code")
        return;
      node.children = node.children.flatMap((child): TreeNode[] => {
        if (child.type === "text" && child.value?.trim()) {
          return (child.value.match(/\S+\s*|\s+/g) ?? []).map((value) => ({
            type: "element",
            tagName: "span",
            properties: { className: ["chat-stream-token"] },
            children: [{ type: "text", value }],
          }));
        }
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}

export function streamingCursor() {
  return (tree: TreeNode) => {
    const last = tree.children?.at(-1);
    const cursor: TreeNode = {
      type: "element",
      tagName: "span",
      properties: { className: ["chat-stream-cursor"], ariaHidden: "true" },
      children: [],
    };
    if (last?.tagName === "p") last.children?.push(cursor);
    else tree.children?.push(cursor);
  };
}
