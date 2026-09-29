import { JevboxIcon } from "./jevbox-icon";
import { ScrollArea } from "@/components/coss/scroll-area";
import { useState, type ReactNode } from "react";
import { LoadingState } from "./loading-state";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/coss/select";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  inlineCitations,
  revealMarkdown,
  streamingCursor,
} from "./chat-message-presentation";
import { ChatSourceChip } from "./chat-source-chip";
import type { Source } from "@/lib/api";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
const documentHtmlSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    td: [...(defaultSchema.attributes?.td ?? []), "colSpan", "rowSpan"],
    th: [
      ...(defaultSchema.attributes?.th ?? []),
      "colSpan",
      "rowSpan",
      "scope",
    ],
  },
};
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <JevboxIcon size={small ? 19 : 23} />
      </span>
      <span>
        jevbox<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export function Loading({
  label = "Loading",
  fullScreen = false,
}: {
  label?: string;
  fullScreen?: boolean;
}) {
  return (
    <div className={`loading${fullScreen ? " loading-fullscreen" : ""}`}>
      <LoadingState label={label} />
    </div>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
const markdownComponents: Components = {
  table: ({ node: _node, children, ...props }) => (
    <ScrollArea className="markdown-table-scroll" scrollFade>
      <table {...props}>{children}</table>
    </ScrollArea>
  ),
  pre: ({ node: _node, children, ...props }) => (
    <ScrollArea className="markdown-code-scroll" scrollFade>
      <pre {...props}>{children}</pre>
    </ScrollArea>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ alt }) => (
    <span className="image-placeholder">
      Image: {alt || "document illustration"}
    </span>
  ),
};

export function Markdown({
  children,
  allowHtml = false,
  animate = false,
  sources = [],
  onSourcePreview,
  streaming = false,
}: {
  children: string;
  allowHtml?: boolean;
  animate?: boolean;
  sources?: Source[];
  onSourcePreview?: (source: Source) => void;
  streaming?: boolean;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={
          allowHtml
            ? [rehypeRaw, [rehypeSanitize, documentHtmlSchema]]
            : [
                inlineCitations(sources.length),
                ...(animate ? [revealMarkdown] : []),
                ...(streaming ? [streamingCursor] : []),
              ]
        }
        components={{
          ...markdownComponents,
          a: ({ href, children }) => {
            const match = href?.match(/^#chat-source-(\d+)$/);
            const number = match ? Number(match[1]) : 0;
            const source = sources[number - 1];
            return source ? (
              <ChatSourceChip
                source={source}
                number={number}
                onPreview={onSourcePreview}
              />
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
export function plainTextPreview(value: string, title?: string) {
  const firstLine = value.trimStart().split("\n", 1)[0];
  if (
    title &&
    /^#{1,6}\s/.test(firstLine) &&
    firstLine.replace(/^#{1,6}\s+/, "").trim() === title.trim()
  ) {
    value = value.trimStart().slice(firstLine.length);
  }
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
